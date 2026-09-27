import type { CgmReading } from "./care";
import { uniqueCgm } from "./cgm-metrics";

/**
 * Where CGM glucose is likely to be over the next two hours, from CGM readings alone: a damped
 * trend fitted on the person's own history. For each horizon it learns how much of the last 15,
 * 30 and 60 minutes' change carried on (with no pull toward an average, which misleads when days
 * shift, as during illness). The range is how far that fit missed on the most recent day, which
 * it was not fitted on, so it reflects misses the fit didn't already account for. It starts at
 * the current reading, can't see food, insulin or activity, and nothing here feeds dosing.
 * The settings below are statistical, not clinical values.
 */
export const ESTIMATE_MINUTES = 120;
export const ESTIMATE_STEP_MINUTES = 15;
/** The range spans the middle 80% of past misses. */
const RANGE_PERCENTILES = [10, 50, 90] as const;
/** Fewer past examples than this at any horizon give no estimate: about 17 hours of readings. */
export const MIN_EXAMPLES = 200;
/** The range comes from misses in this last stretch, predicted by a fit on the history before it… */
const CALIBRATION_MINUTES = 24 * 60;
/** …when it holds at least this many; otherwise from the fit's own misses on all history. */
const MIN_CALIBRATION = 100;
const GRID_MINUTES = 5;
const LAG_MINUTES = [15, 30, 60];
/** The current reading must be this recent. */
const CURRENT_MINUTES = 15;
/** HIGH and LOW are known only to be past these sensor limits, so they count as the limit. */
const SENSOR_LOW = 40;
const SENSOR_HIGH = 400;
const MINUTE = 60000;

export type EstimatePoint = {
  at: string;
  minutes: number;
  low: number;
  median: number;
  high: number;
};
export type GlucoseEstimate =
  | { state: "no-reading" }
  | { state: "learning"; examples: number }
  | { state: "ready"; at: string; value: number; examples: number; points: EstimatePoint[] };

/** Solves the small square system `a·x = b` in place by Gaussian elimination. */
function solve(a: number[][], b: number[]) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    [b[c], b[pivot]] = [b[pivot], b[c]];
    if (a[c][c] === 0) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const m = a[r][c] / a[c][c];
      for (let k = c; k < n; k++) a[r][k] -= m * a[c][k];
      b[r] -= m * b[c];
    }
  }
  return b.map((value, i) => value / a[i][i]);
}

export function glucoseEstimate(cgm: CgmReading[], now: number): GlucoseEstimate {
  if (!Number.isFinite(now)) return { state: "no-reading" };
  const readings = uniqueCgm(cgm)
    .map((r) => ({
      t: Date.parse(r.at),
      value: r.value ?? (r.status === "Low" ? SENSOR_LOW : SENSOR_HIGH),
      exact: r.value !== null,
    }))
    .filter((r) => r.t <= now)
    .sort((a, b) => a.t - b.t);
  const current = readings.at(-1);
  // A HIGH or LOW status is only a bound, so it can't be the starting point.
  if (!current || now - current.t > CURRENT_MINUTES * MINUTE || !current.exact)
    return { state: "no-reading" };

  // A 5-minute grid ending at the current reading; each slot takes the reading within half a step.
  const step = GRID_MINUTES * MINUTE;
  const size = Math.floor((current.t - readings[0].t) / step) + 1;
  const grid: (number | null)[] = Array.from({ length: size }, () => null);
  const first = current.t - (size - 1) * step;
  for (let i = 0, j = 0; i < size; i++) {
    const t = first + i * step;
    while (
      j + 1 < readings.length &&
      Math.abs(readings[j + 1].t - t) <= Math.abs(readings[j].t - t)
    )
      j++;
    if (Math.abs(readings[j].t - t) <= step / 2) grid[i] = readings[j].value;
  }
  const lags = LAG_MINUTES.map((m) => m / GRID_MINUTES);
  const changes = (i: number) => {
    const value = grid[i];
    if (value === null || i < lags[lags.length - 1]) return null;
    const out: number[] = [];
    for (const lag of lags) {
      const before = grid[i - lag];
      if (before === null) return null;
      out.push(value - before);
    }
    return out;
  };
  const recent = changes(size - 1);
  if (!recent) return { state: "no-reading" };

  const points: EstimatePoint[] = [
    {
      at: new Date(current.t).toISOString(),
      minutes: 0,
      low: current.value,
      median: current.value,
      high: current.value,
    },
  ];
  let examples = Infinity;
  for (
    let minutes = ESTIMATE_STEP_MINUTES;
    minutes <= ESTIMATE_MINUTES;
    minutes += ESTIMATE_STEP_MINUTES
  ) {
    const ahead = minutes / GRID_MINUTES;
    const xs: number[][] = [];
    const ys: number[] = [];
    /** Whether each example's outcome falls in the calibration stretch. */
    const recentOutcome: boolean[] = [];
    const calibrationStart = size - CALIBRATION_MINUTES / GRID_MINUTES;
    for (let i = 0; i + ahead < size; i++) {
      const x = changes(i);
      const [value, later] = [grid[i], grid[i + ahead]];
      if (!x || value === null || later === null) continue;
      xs.push(x);
      ys.push(later - value);
      recentOutcome.push(i + ahead >= calibrationStart);
    }
    examples = Math.min(examples, xs.length);
    if (xs.length < MIN_EXAMPLES) return { state: "learning", examples: xs.length };
    const calibration = recentOutcome.filter(Boolean).length;
    const split = calibration >= MIN_CALIBRATION && xs.length - calibration >= MIN_EXAMPLES;
    // Least squares with no intercept, lightly regularized so near-duplicate lags stay stable.
    const a = lags.map(() => lags.map(() => 0));
    const b = lags.map(() => 0);
    for (let r = 0; r < xs.length; r++) {
      if (split && recentOutcome[r]) continue;
      for (let p = 0; p < lags.length; p++) {
        b[p] += xs[r][p] * ys[r];
        for (let q = 0; q < lags.length; q++) a[p][q] += xs[r][p] * xs[r][q];
      }
    }
    const ridge = (1e-6 * a.reduce((sum, row, p) => sum + row[p], 0)) / lags.length;
    a.forEach((row, p) => (row[p] += ridge));
    const weights = solve(a, b);
    if (!weights) return { state: "learning", examples: xs.length };
    const fit = (x: number[]) => x.reduce((sum, v, p) => sum + v * weights[p], 0);
    const misses = xs
      .flatMap((x, r) => (!split || recentOutcome[r] ? [ys[r] - fit(x)] : []))
      .sort((m, n) => m - n);
    const [low, median, high] = RANGE_PERCENTILES.map((p) => {
      const miss =
        misses[Math.min(misses.length - 1, Math.max(0, Math.ceil((p / 100) * misses.length) - 1))];
      return Math.round(
        Math.min(SENSOR_HIGH, Math.max(SENSOR_LOW, current.value + fit(recent) + miss)),
      );
    });
    points.push({
      at: new Date(current.t + minutes * MINUTE).toISOString(),
      minutes,
      low,
      median,
      high,
    });
  }
  return { state: "ready", at: points[0].at, value: current.value, examples, points };
}

/** An estimate value as text: mg/dL, or the sensor's HIGH/LOW at its limits. */
export function estimateLabel(value: number) {
  return value >= SENSOR_HIGH ? "HIGH" : value <= SENSOR_LOW ? "LOW" : String(value);
}
