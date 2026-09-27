import { fromLocal, localInput, type CgmReading } from "./care";
import { uniqueCgm } from "./cgm-metrics";
import { percentile, type AgpValue } from "./glucose-metrics";

/**
 * What followed a similar CGM reading at the same time of day on past days. It describes past
 * data only: it is not a forecast of what will happen and nothing here feeds dosing. The match
 * windows below are statistical settings, not clinical values.
 */
/** A past reading matches when it is this close to the current value (mg/dL)… */
export const SIMILAR_VALUE_MGDL = 30;
/** …and this close to the current clock time on its own day (minutes). */
export const SIMILAR_CLOCK_MINUTES = 30;
/** Fewer matching days than this give no estimate. */
export const SIMILAR_MIN_DAYS = 5;
export const ESTIMATE_HOURS = 6;
export const ESTIMATE_STEP_MINUTES = 15;
/** The current reading must be this recent to compare. */
const CURRENT_MINUTES = 15;
/** Trend is the change over this many minutes; less than STEADY_MGDL either way is steady. */
const TREND_MINUTES = 15;
const STEADY_MGDL = 15;
/** A reading stands for a moment when it is within this many minutes of it. */
const NEAR_MINUTES = 7;
const MINUTE = 60000;

export type Trend = "falling" | "steady" | "rising";
export type EstimatePoint = {
  at: string;
  /** How many matching days had a reading at this point. */
  days: number;
  p10: AgpValue | null;
  p50: AgpValue | null;
  p90: AgpValue | null;
};
export type SimilarDays =
  | { state: "no-reading" }
  | { state: "too-few"; at: string; value: number; trend: Trend | null; matched: number }
  | {
      state: "ready";
      at: string;
      value: number;
      trend: Trend | null;
      matched: number;
      points: EstimatePoint[];
      /** Each matching day's lowest and highest reading in the estimate window, as sort keys. */
      lows: number[];
      highs: number[];
    };

const key = (r: CgmReading) => r.value ?? (r.status === "Low" ? -Infinity : Infinity);

function nextDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function similarDays(cgm: CgmReading[], now: number, timezone: string): SimilarDays {
  if (!Number.isFinite(now)) return { state: "no-reading" };
  const readings = uniqueCgm(cgm);
  const times = readings.map((r) => Date.parse(r.at));
  /** Index of the last reading at or before `at`, or -1. */
  const atOrBefore = (at: number) => {
    let lo = 0,
      hi = times.length - 1,
      found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= at) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };
  const nearest = (at: number, tolerance = NEAR_MINUTES * MINUTE) => {
    const i = atOrBefore(at);
    let best: number | null = null;
    for (const j of [i, i + 1])
      if (
        j >= 0 &&
        j < times.length &&
        Math.abs(times[j] - at) <= tolerance &&
        (best === null || Math.abs(times[j] - at) < Math.abs(times[best] - at))
      )
        best = j;
    return best;
  };
  const trendAt = (index: number): Trend | null => {
    const value = readings[index].value;
    const earlier = nearest(times[index] - TREND_MINUTES * MINUTE, 5 * MINUTE);
    const before = earlier === null ? null : readings[earlier].value;
    if (value === null || before === null) return null;
    const change = value - before;
    return change <= -STEADY_MGDL ? "falling" : change >= STEADY_MGDL ? "rising" : "steady";
  };

  const current = atOrBefore(now);
  if (current < 0 || now - times[current] > CURRENT_MINUTES * MINUTE)
    return { state: "no-reading" };
  const value = readings[current].value;
  // A HIGH or LOW status has no exact value to compare against.
  if (value === null) return { state: "no-reading" };
  const from = times[current];
  const trend = trendAt(current);

  // Same local clock time on each earlier day, so a clock change doesn't shift the match.
  const local = localInput(new Date(from), timezone);
  const [today, clock] = local.split("T");
  const window = SIMILAR_CLOCK_MINUTES * MINUTE;
  const anchors: number[] = [];
  for (let offset = 1; ; offset++) {
    let target: number;
    try {
      target = Date.parse(fromLocal(`${nextDay(today, -offset)}T${clock}`, timezone));
    } catch {
      continue; // The clock change skipped this time on that day.
    }
    if (target + window < times[0]) break;
    // Closest value first, so the spread starts from tonight's reading; then closest time.
    let best: { at: number; gap: number } | null = null;
    for (let i = Math.max(0, atOrBefore(target - window)); i < times.length; i++) {
      if (times[i] > target + window) break;
      if (times[i] < target - window) continue;
      const candidate = readings[i].value;
      if (candidate === null || Math.abs(candidate - value) > SIMILAR_VALUE_MGDL) continue;
      if (trend !== null && trendAt(i) !== trend) continue;
      const gap = Math.abs(candidate - value);
      if (
        !best ||
        gap < best.gap ||
        (gap === best.gap && Math.abs(times[i] - target) < Math.abs(best.at - target))
      )
        best = { at: times[i], gap };
    }
    if (best) anchors.push(best.at);
  }

  const base = { at: new Date(from).toISOString(), value, trend, matched: anchors.length };
  if (anchors.length < SIMILAR_MIN_DAYS) return { state: "too-few", ...base };

  const points: EstimatePoint[] = [];
  const lows = anchors.map(() => Infinity),
    highs = anchors.map(() => -Infinity);
  for (let step = 0; step <= (ESTIMATE_HOURS * 60) / ESTIMATE_STEP_MINUTES; step++) {
    const offset = step * ESTIMATE_STEP_MINUTES * MINUTE;
    const keys: number[] = [];
    anchors.forEach((anchor, day) => {
      const index = nearest(anchor + offset);
      if (index === null) return;
      const k = key(readings[index]);
      keys.push(k);
      lows[day] = Math.min(lows[day], k);
      highs[day] = Math.max(highs[day], k);
    });
    // Too few days observed this far ahead: the estimate stops rather than thinning out.
    if (keys.length < SIMILAR_MIN_DAYS) break;
    keys.sort((a, b) => a - b);
    points.push({
      at: new Date(from + offset).toISOString(),
      days: keys.length,
      p10: percentile(keys, 10),
      p50: percentile(keys, 50),
      p90: percentile(keys, 90),
    });
  }
  return { state: "ready", ...base, points, lows, highs };
}

/** How many matching days went below `low` or above `high` at any point in the window. */
export function similarDaysOutside(estimate: SimilarDays, low: number, high: number) {
  if (estimate.state !== "ready") return null;
  return {
    below: estimate.lows.filter((k) => k < low).length,
    above: estimate.highs.filter((k) => k > high).length,
  };
}

/** A percentile as text: its mg/dL value, or the sensor's HIGH/LOW. */
export function estimateLabel(value: AgpValue | null) {
  return value === null ? "–" : typeof value === "number" ? String(value) : value.toUpperCase();
}
