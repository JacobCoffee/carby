import type { CgmReading, Entry } from "./care";
import { uniqueCgm } from "./cgm-metrics";
import { firstAtOrAfter, median } from "./meal-response";

/**
 * How CGM glucose moved after logged insulin. Descriptive only: it says what happened after a
 * dose, never how much to give. A dose is compared with others only when nothing else logged
 * nearby could have moved glucose: no food from an hour before to the end of the window, and no
 * other rapid-acting dose still in the three hours before it. The windows below are how long to
 * watch, not insulin action times.
 */
export const DOSE_WINDOW_MINUTES: Record<DoseInsulin, number> = {
  "Rapid-acting": 180,
  "Long-acting": 480,
};
/** When to read the change from the reading at the dose. */
export const DOSE_MARKS: Record<DoseInsulin, number[]> = {
  "Rapid-acting": [30, 60, 90, 120, 180],
  "Long-acting": [60, 120, 240, 360, 480],
};
export const MIN_DOSES_FOR_TIMING = 3;
/** The CGM reading used as the starting point must be at most this old at the dose. */
const BASELINE_MINUTES = 20;
const FOOD_BEFORE_MINUTES = 60;
const RAPID_BEFORE_MINUTES = 180;
const MAX_GAP_MINUTES = 10;
const MIN_COVERAGE_PERCENT = 70;
/** A reading counts for a mark, or for the end of a 15-minute step, when it is this close. */
const MATCH_MINUTES = 5;
const FALL_STEP_MINUTES = 15;
const MINUTE = 60000;

export type DoseInsulin = NonNullable<Entry["insulin"]>;
export type DoseResponseStatus =
  /** A complete, comparable response. */
  | "ok"
  /** No numeric CGM reading in the 20 minutes before the dose. */
  | "no-baseline"
  /** Less than 70% of the window was recorded. */
  | "sparse"
  /** Food logged nearby, so the change isn't the dose's alone. */
  | "food-nearby"
  /** Another rapid-acting dose was still nearby. */
  | "other-insulin"
  /** The window hasn't passed yet. */
  | "in-progress";

export type DoseResponse = {
  entryId: string;
  at: string;
  insulin: DoseInsulin;
  units: number;
  baseline: number | null;
  /** Change from the baseline at each mark; null where no reading was close enough. */
  changes: { minutes: number; change: number | null }[];
  /** Lowest reading in the window, or "Low" past the sensor's lower limit. */
  lowest: number | "Low" | null;
  lowestMinutes: number | null;
  /** The 15 minutes in which glucose fell the most, starting at `from` minutes after the dose
   * (to the nearest 5, the CGM's step); null when it never fell. */
  fastestFall: { from: number; change: number } | null;
  coveragePercent: number;
  status: DoseResponseStatus;
};

/** Glucose after every logged insulin dose, newest first. */
export function doseResponses(entries: Entry[], cgm: CgmReading[], now: number): DoseResponse[] {
  const points = uniqueCgm(cgm);
  const times = points.map((r) => Date.parse(r.at));
  const food = entries.filter((e) => e.kind === "food").map((e) => Date.parse(e.at));
  const doses = entries
    .filter((e) => e.kind === "insulin" && e.insulin && e.units)
    .map((e) => ({ entry: e, at: Date.parse(e.at) }))
    .sort((a, b) => a.at - b.at);
  const rapid = doses.filter((d) => d.entry.insulin === "Rapid-acting");

  /** The numeric reading closest to `at`, within the match distance. */
  const valueNear = (at: number) => {
    const i = firstAtOrAfter(times, at);
    let best: number | null = null;
    for (const j of [i - 1, i])
      if (
        j >= 0 &&
        j < points.length &&
        points[j].value !== null &&
        Math.abs(times[j] - at) <= MATCH_MINUTES * MINUTE &&
        (best === null || Math.abs(times[j] - at) < Math.abs(times[best] - at))
      )
        best = j;
    return best === null ? null : points[best].value;
  };

  const responses: DoseResponse[] = [];
  for (const { entry, at } of doses) {
    const insulin = entry.insulin!;
    const window = DOSE_WINDOW_MINUTES[insulin] * MINUTE;
    const end = at + window;

    const startIndex = firstAtOrAfter(times, at);
    const exact = times[startIndex] === at ? startIndex : startIndex - 1;
    const base = exact >= 0 ? points[exact] : undefined;
    const baseline =
      base && base.value !== null && at - times[exact] <= BASELINE_MINUTES * MINUTE
        ? base.value
        : null;

    let observed = 0,
      lowestKey = Infinity,
      lowestAt = 0;
    for (let i = Math.max(0, startIndex - 1); i < points.length && times[i] <= end; i++) {
      const from = Math.max(times[i], at),
        to = Math.min(times[i + 1] ?? times[i], end);
      if (i + 1 < points.length && times[i + 1] - times[i] <= MAX_GAP_MINUTES * MINUTE && to > from)
        observed += to - from;
      if (times[i] < at) continue;
      const key = points[i].value ?? (points[i].status === "Low" ? -Infinity : Infinity);
      if (key < lowestKey) {
        lowestKey = key;
        lowestAt = times[i];
      }
    }
    const coveragePercent = Math.min(100, Math.round((observed / window) * 100));
    const lowest: DoseResponse["lowest"] =
      lowestKey === -Infinity ? "Low" : lowestKey === Infinity ? null : lowestKey;

    let fastestFall: DoseResponse["fastestFall"] = null;
    for (
      let i = startIndex;
      i < points.length && times[i] + FALL_STEP_MINUTES * MINUTE <= end;
      i++
    ) {
      const [before, after] = [points[i].value, valueNear(times[i] + FALL_STEP_MINUTES * MINUTE)];
      if (before === null || after === null || after - before >= 0) continue;
      if (!fastestFall || after - before < fastestFall.change)
        fastestFall = {
          from: Math.round((times[i] - at) / (5 * MINUTE)) * 5,
          change: after - before,
        };
    }

    const foodNearby = food.some((t) => t >= at - FOOD_BEFORE_MINUTES * MINUTE && t <= end);
    const otherRapid = rapid.some(
      (d) => d.entry.id !== entry.id && d.at >= at - RAPID_BEFORE_MINUTES * MINUTE && d.at <= end,
    );
    const status: DoseResponseStatus =
      end > now
        ? "in-progress"
        : baseline === null
          ? "no-baseline"
          : coveragePercent < MIN_COVERAGE_PERCENT
            ? "sparse"
            : foodNearby
              ? "food-nearby"
              : otherRapid
                ? "other-insulin"
                : "ok";
    responses.push({
      entryId: entry.id,
      at: entry.at,
      insulin,
      units: entry.units!,
      baseline,
      changes: DOSE_MARKS[insulin].map((minutes) => {
        const value = valueNear(at + minutes * MINUTE);
        return { minutes, change: value === null || baseline === null ? null : value - baseline };
      }),
      lowest,
      lowestMinutes: lowest === null ? null : Math.round((lowestAt - at) / MINUTE),
      fastestFall,
      coveragePercent,
      status,
    });
  }
  return responses.reverse();
}

export type DoseTiming = {
  insulin: DoseInsulin;
  /** Comparable doses behind the medians. */
  doses: number;
  /** Median change from the reading at the dose, at each mark. */
  changes: { minutes: number; change: number | null }[];
  /** Median start of the 15 minutes with the biggest fall; null when too few doses fell. */
  fastestFallFrom: number | null;
  medianLowestMinutes: number | null;
};

/** Medians over comparable doses of one insulin, or null with fewer than three of them. */
export function doseTiming(
  responses: DoseResponse[],
  insulin: DoseInsulin,
  minDoses = MIN_DOSES_FOR_TIMING,
): DoseTiming | null {
  const ok = responses.filter((r) => r.insulin === insulin && r.status === "ok");
  if (ok.length < minDoses) return null;
  const falls = ok.flatMap((r) => (r.fastestFall ? [r.fastestFall.from] : []));
  const lows = ok.flatMap((r) => (r.lowestMinutes === null ? [] : [r.lowestMinutes]));
  return {
    insulin,
    doses: ok.length,
    changes: DOSE_MARKS[insulin].map((minutes, i) => {
      const values = ok.flatMap((r) => {
        const change = r.changes[i].change;
        return change === null ? [] : [change];
      });
      return { minutes, change: values.length >= minDoses ? median(values) : null };
    }),
    fastestFallFrom: falls.length >= minDoses ? median(falls) : null,
    medianLowestMinutes: lows.length >= minDoses ? median(lows) : null,
  };
}
