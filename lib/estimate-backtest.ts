import type { CgmReading, Entry } from "./care";
import { uniqueCgm } from "./cgm-metrics";
import { LOGGED_AGE_MINUTES, type GlucoseEstimate } from "./glucose-estimate";

/**
 * Replays an estimator over past CGM readings the way the app runs it: at each test time it sees
 * only readings up to that moment, and its range is scored against what the CGM read later. Used
 * to decide whether a change to the estimate actually makes it more accurate.
 */
export type Estimator = (cgm: CgmReading[], now: number) => GlucoseEstimate;
export type Trend = "falling" | "steady" | "rising";
export type HorizonScore = {
  minutes: number;
  /** Test times with an estimate and an exact reading at this horizon. */
  cases: number;
  /** Median absolute miss of the middle line, and of "stays where it is" at the same times. */
  medianMiss: number;
  stayMiss: number;
  /** Share of later readings inside the range; the range aims for 0.8. */
  covered: number;
  medianWidth: number;
};

const MINUTE = 60000;
/** A later reading counts for a horizon when it is this close to it. */
const MATCH_MINUTES = 2.5;
/** Trend groups use the change over 15 minutes; less than this either way is steady. */
const STEADY_MGDL = 15;

const median = (values: number[]) => {
  if (!values.length) return NaN;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** What was logged in the three hours before `now`, as a backtest group. */
export function loggedGroup(entries: Entry[], now: number) {
  const since = now - LOGGED_AGE_MINUTES[LOGGED_AGE_MINUTES.length - 1] * MINUTE;
  const recent = entries.filter((e) => {
    const at = Date.parse(e.at);
    return at <= now && at > since;
  });
  const food = recent.some((e) => e.kind === "food" && e.carbs);
  const insulin = recent.some((e) => e.kind === "insulin" && e.insulin === "Rapid-acting");
  return food && insulin
    ? "Food and insulin"
    : food
      ? "Food only"
      : insulin
        ? "Insulin only"
        : "Nothing logged";
}

export function backtestEstimate(
  cgm: CgmReading[],
  estimator: Estimator,
  /** Test every `everyMinutes`, from `from` on, so different estimators can share test times. */
  {
    everyMinutes = 15,
    from = -Infinity,
    group,
  }: {
    everyMinutes?: number;
    from?: number;
    /** Also score each test time's group separately, such as what was logged before it. */
    group?: (now: number) => string;
  } = {},
) {
  const readings = uniqueCgm(cgm).toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const times = readings.map((r) => Date.parse(r.at));
  /** The exact reading closest to `at` within `tolerance`, or null. */
  const exactNear = (at: number, tolerance: number) => {
    let lo = 0,
      hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < at) lo = mid + 1;
      else hi = mid;
    }
    let best: number | null = null;
    for (const j of [lo - 1, lo])
      if (
        j >= 0 &&
        j < times.length &&
        readings[j].value !== null &&
        Math.abs(times[j] - at) <= tolerance &&
        (best === null || Math.abs(times[j] - at) < Math.abs(times[best] - at))
      )
        best = j;
    return best === null ? null : readings[best].value;
  };

  type Case = {
    minutes: number;
    trend: Trend | null;
    group: string | null;
    miss: number;
    stay: number;
    inside: boolean;
    width: number;
  };
  const cases: Case[] = [];
  let last = -Infinity;
  for (let i = 0; i < readings.length; i++) {
    if (times[i] < from || times[i] - last < everyMinutes * MINUTE) continue;
    last = times[i];
    const estimate = estimator(readings.slice(0, i + 1), times[i]);
    if (estimate.state !== "ready") continue;
    const before = exactNear(times[i] - 15 * MINUTE, MATCH_MINUTES * MINUTE);
    const change = before === null ? null : estimate.value - before;
    const trend: Trend | null =
      change === null
        ? null
        : change <= -STEADY_MGDL
          ? "falling"
          : change >= STEADY_MGDL
            ? "rising"
            : "steady";
    const named = group ? group(times[i]) : null;
    for (const point of estimate.points) {
      if (point.minutes === 0) continue;
      const actual = exactNear(Date.parse(point.at), MATCH_MINUTES * MINUTE);
      if (actual === null) continue;
      cases.push({
        minutes: point.minutes,
        trend,
        group: named,
        miss: Math.abs(point.median - actual),
        stay: Math.abs(estimate.value - actual),
        inside: actual >= point.low && actual <= point.high,
        width: point.high - point.low,
      });
    }
  }

  const score = (group: Case[]) =>
    [...new Set(group.map((c) => c.minutes))]
      .toSorted((a, b) => a - b)
      .map((minutes): HorizonScore => {
        const at = group.filter((c) => c.minutes === minutes);
        return {
          minutes,
          cases: at.length,
          medianMiss: median(at.map((c) => c.miss)),
          stayMiss: median(at.map((c) => c.stay)),
          covered: at.filter((c) => c.inside).length / at.length,
          medianWidth: median(at.map((c) => c.width)),
        };
      });
  return {
    all: score(cases),
    byTrend: Object.fromEntries(
      (["falling", "steady", "rising"] as const).map((trend) => [
        trend,
        score(cases.filter((c) => c.trend === trend)),
      ]),
    ) as Record<Trend, HorizonScore[]>,
    byGroup: Object.fromEntries(
      [...new Set(cases.flatMap((c) => (c.group === null ? [] : [c.group])))].map((name) => [
        name,
        score(cases.filter((c) => c.group === name)),
      ]),
    ) as Record<string, HorizonScore[]>,
  };
}
