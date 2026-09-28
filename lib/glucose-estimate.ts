import type { CgmReading, Entry } from "./care";
import { formatGlucose, type GlucoseUnit } from "./glucose-units";
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

/** Extra inputs the fit can learn from, beyond the CGM trend. */
type Extras = {
  /** More predictors at time `t`, computed only from what was known at `t`. */
  features: (t: number) => number[];
  /** Pull toward zero for the extra weights, so thin evidence leaves the CGM-only fit alone. */
  ridge: number;
  /** Whether the history at `t` is like the moment being estimated; unlike moments aren't fitted. */
  like: (t: number) => boolean;
};

export function glucoseEstimate(cgm: CgmReading[], now: number): GlucoseEstimate {
  return fitEstimate(cgm, now, null);
}

function fitEstimate(cgm: CgmReading[], now: number, extras: Extras | null): GlucoseEstimate {
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
  const inputs = (i: number) => {
    const value = grid[i];
    if (value === null || i < lags[lags.length - 1]) return null;
    const out: number[] = [];
    for (const lag of lags) {
      const before = grid[i - lag];
      if (before === null) return null;
      out.push(value - before);
    }
    return extras ? [...out, ...extras.features(first + i * step)] : out;
  };
  const recent = inputs(size - 1);
  if (!recent) return { state: "no-reading" };
  const width = recent.length;
  const like = extras
    ? Array.from({ length: size }, (_, i) => extras.like(first + i * step))
    : null;

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
      if (like && !(like[i] && like[i + ahead])) continue;
      const x = inputs(i);
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
    const a = recent.map(() => recent.map(() => 0));
    const b = recent.map(() => 0);
    for (let r = 0; r < xs.length; r++) {
      if (split && recentOutcome[r]) continue;
      for (let p = 0; p < width; p++) {
        b[p] += xs[r][p] * ys[r];
        for (let q = 0; q < width; q++) a[p][q] += xs[r][p] * xs[r][q];
      }
    }
    const ridge = (1e-6 * lags.reduce((sum, _, p) => sum + a[p][p], 0)) / lags.length;
    a.forEach((row, p) => (row[p] += p < lags.length ? ridge : (extras?.ridge ?? ridge)));
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

/**
 * Food and rapid-acting insulin count by how long ago they were logged, in these spans of
 * minutes, so a meal just eaten (still to rise) and one two hours ago (coming back down) are told
 * apart. Statistical buckets, not insulin action times.
 */
export const LOGGED_AGE_MINUTES = [0, 30, 60, 120, 180];
/** How strongly the logged weights are pulled toward zero (no effect), in the units below. */
const LOGGED_RIDGE = 50;

/**
 * The same estimate, also learning from the person's own history how glucose moved in the three
 * hours after logged carbs (per 10 g) and rapid-acting insulin (per unit). There is no built-in
 * food or insulin curve: with little history the weights stay near zero and the estimate is the
 * CGM-only one. Moments inside `excluded` spans (such as sick periods) are learned only from each
 * other, and moments outside only from moments outside. Not shown in the app: kept for comparing
 * with the CGM-only estimate in `scripts/estimate-backtest.ts` until it proves more accurate.
 */
export function loggedEstimate(
  cgm: CgmReading[],
  now: number,
  logged: { entries: Entry[]; excluded?: { start: number; end: number }[] },
): GlucoseEstimate {
  const events = logged.entries
    .map((e) => ({
      t: Date.parse(e.at),
      carbs: e.kind === "food" ? (e.carbs ?? 0) / 10 : 0,
      rapid: e.kind === "insulin" && e.insulin === "Rapid-acting" ? (e.units ?? 0) : 0,
    }))
    .filter((e) => (e.carbs || e.rapid) && e.t <= now)
    .sort((a, b) => a.t - b.t);
  const excluded = logged.excluded ?? [];
  const inExcluded = (t: number) => excluded.some((span) => t >= span.start && t < span.end);
  const nowExcluded = inExcluded(now);
  return fitEstimate(cgm, now, {
    features: (t) => {
      const spans = LOGGED_AGE_MINUTES.length - 1;
      const out = Array.from({ length: 2 * spans }, () => 0);
      for (const e of events) {
        if (e.t > t) break;
        const age = (t - e.t) / MINUTE;
        for (let s = 0; s < spans; s++)
          if (age >= LOGGED_AGE_MINUTES[s] && age < LOGGED_AGE_MINUTES[s + 1]) {
            out[s] += e.carbs;
            out[spans + s] += e.rapid;
          }
      }
      return out;
    },
    ridge: LOGGED_RIDGE,
    like: (t) => inExcluded(t) === nowExcluded,
  });
}

/** An estimate value as text in the unit, or the sensor's HIGH/LOW at its limits. */
export function estimateLabel(value: number, unit: GlucoseUnit) {
  return value >= SENSOR_HIGH ? "HIGH" : value <= SENSOR_LOW ? "LOW" : formatGlucose(value, unit);
}
