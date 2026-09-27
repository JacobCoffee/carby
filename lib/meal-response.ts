import type { CgmReading, Entry } from "./care";
import { uniqueCgm } from "./cgm-metrics";
import { identifiedFoodNames } from "./insights";

/**
 * How CGM glucose moved after each logged meal. Descriptive only: it says what happened after
 * food, never what to eat or dose. A response is compared across meals only when the window is
 * complete, well covered, and free of other food that would blur it.
 */
export const RESPONSE_MINUTES = 180;
/** The CGM reading used as the starting point must be at most this old at the meal. */
const BASELINE_MINUTES = 20;
/** Other food this close before a meal, or inside its window, blurs the response. */
const OVERLAP_BEFORE_MINUTES = 90;
const MAX_GAP_MINUTES = 10;
const MIN_COVERAGE_PERCENT = 70;
/** "Back to baseline" means within this much of the starting reading. */
const RETURN_MARGIN = 20;
export const MIN_MEALS_FOR_RANKING = 3;

export type MealResponseStatus =
  /** A complete, comparable response. */
  | "ok"
  /** No numeric CGM reading in the 20 minutes before the meal. */
  | "no-baseline"
  /** Less than 70% of the three hours after the meal was recorded. */
  | "sparse"
  /** Other food near the meal, so the rise is not this meal's alone. */
  | "overlapping"
  /** Three hours have not passed yet. */
  | "in-progress";

export type MealResponse = {
  entryId: string;
  at: string;
  meal: Entry["meal"];
  carbs: number;
  foods: string[];
  /** Rapid-acting units logged from an hour before to 30 minutes after the meal. */
  rapidUnits: number;
  baseline: number | null;
  /** Highest reading in the window, or "High" when the sensor was past its upper limit. */
  peak: number | "High" | null;
  /** Peak minus baseline; a lower bound when `riseCapped`. */
  rise: number | null;
  riseCapped: boolean;
  peakMinutes: number | null;
  /** Minutes until glucose came back within 20 mg/dL of the baseline after the peak. */
  returnMinutes: number | null;
  coveragePercent: number;
  status: MealResponseStatus;
};

export type FoodResponse = {
  name: string;
  meals: number;
  /** Median rise across comparable meals; a lower bound when `riseCapped`. */
  medianRise: number;
  medianPeakMinutes: number;
  riseCapped: boolean;
};

function foodNames(entry: Entry): string[] {
  if (entry.foodItems === undefined) return identifiedFoodNames(entry.note);
  const names = new Map<string, string>();
  for (const item of entry.foodItems) {
    const name = item.name.trim().replace(/\s+/g, " ");
    const key = name.toLocaleLowerCase("en-US");
    if (name && key !== "unspecified food") names.set(key, name);
  }
  return [...names.values()];
}

/** Index of the first reading at or after `at`. */
export function firstAtOrAfter(times: number[], at: number) {
  let lo = 0,
    hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Glucose after every logged meal, newest first. Low treatments are left out. */
export function mealResponses(entries: Entry[], cgm: CgmReading[], now: number): MealResponse[] {
  const points = uniqueCgm(cgm);
  const times = points.map((r) => Date.parse(r.at));
  const food = entries
    .filter((e) => e.kind === "food")
    .map((e) => ({ entry: e, at: Date.parse(e.at) }))
    .sort((a, b) => a.at - b.at);
  const rapid = entries
    .filter((e) => e.kind === "insulin" && e.insulin === "Rapid-acting")
    .map((e) => ({ at: Date.parse(e.at), units: e.units ?? 0 }));
  const window = RESPONSE_MINUTES * 60000;
  const responses: MealResponse[] = [];
  for (const { entry, at } of food) {
    if (entry.meal === "Low treatment" || !entry.carbs) continue;
    const end = at + window;
    const overlapping = food.some(
      (other) =>
        other.entry.id !== entry.id &&
        other.at >= at - OVERLAP_BEFORE_MINUTES * 60000 &&
        other.at <= end,
    );
    const rapidUnits = rapid
      .filter((dose) => dose.at >= at - 3600000 && dose.at <= at + 1800000)
      .reduce((sum, dose) => sum + dose.units, 0);

    const startIndex = firstAtOrAfter(times, at);
    const before = points[startIndex - 1] as CgmReading | undefined;
    const exact = times[startIndex] === at ? points[startIndex] : undefined;
    const base = exact ?? before;
    const baseAt = exact ? at : before ? times[startIndex - 1] : -Infinity;
    const baseline =
      base && base.value !== null && at - baseAt <= BASELINE_MINUTES * 60000 ? base.value : null;

    let observed = 0,
      peakKey = -Infinity,
      peakAt = 0;
    const inWindow: { at: number; reading: CgmReading }[] = [];
    for (let i = Math.max(0, startIndex - 1); i < points.length && times[i] <= end; i++) {
      const from = Math.max(times[i], at),
        to = Math.min(times[i + 1] ?? times[i], end);
      if (i + 1 < points.length && times[i + 1] - times[i] <= MAX_GAP_MINUTES * 60000 && to > from)
        observed += to - from;
      if (times[i] < at) continue;
      inWindow.push({ at: times[i], reading: points[i] });
      const key = points[i].value ?? (points[i].status === "High" ? Infinity : -Infinity);
      if (key > peakKey) {
        peakKey = key;
        peakAt = times[i];
      }
    }
    const coveragePercent = Math.min(100, Math.round((observed / window) * 100));
    const peak: MealResponse["peak"] =
      peakKey === Infinity ? "High" : peakKey === -Infinity ? null : peakKey;
    const riseCapped = peak === "High";
    let rise: number | null = null,
      returnMinutes: number | null = null;
    if (baseline !== null && peak !== null) {
      rise = (peak === "High" ? 400 : peak) - baseline;
      // Only a rise past the margin can come back down to baseline.
      const back =
        rise > RETURN_MARGIN
          ? inWindow.find(
              (p) =>
                p.at > peakAt &&
                p.reading.value !== null &&
                p.reading.value <= baseline + RETURN_MARGIN,
            )
          : undefined;
      if (back) returnMinutes = Math.round((back.at - at) / 60000);
    }
    const status: MealResponseStatus =
      end > now
        ? "in-progress"
        : baseline === null
          ? "no-baseline"
          : coveragePercent < MIN_COVERAGE_PERCENT
            ? "sparse"
            : overlapping
              ? "overlapping"
              : "ok";
    responses.push({
      entryId: entry.id,
      at: entry.at,
      meal: entry.meal,
      carbs: entry.carbs,
      foods: foodNames(entry),
      rapidUnits,
      baseline,
      peak,
      rise,
      riseCapped,
      peakMinutes: peak === null ? null : Math.round((peakAt - at) / 60000),
      returnMinutes,
      coveragePercent,
      status,
    });
  }
  return responses.reverse();
}

/** The middle value, rounded to a whole number when it falls between two. */
export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export type UncoveredMeals = {
  meals: number;
  medianCarbs: number;
  /** A lower bound when `riseCapped`. */
  medianRise: number;
  medianPeakMinutes: number;
  riseCapped: boolean;
};

/**
 * Complete, comparable meals with no rapid-acting insulin logged from an hour before to 30
 * minutes after: how far glucose rose with nothing logged to bring it down. Null with fewer than
 * three such meals.
 */
export function mealsWithoutInsulin(
  responses: MealResponse[],
  minMeals = MIN_MEALS_FOR_RANKING,
): UncoveredMeals | null {
  const meals = responses.filter((r) => r.status === "ok" && r.rise !== null && r.rapidUnits === 0);
  if (meals.length < minMeals) return null;
  return {
    meals: meals.length,
    medianCarbs: median(meals.map((r) => r.carbs)),
    medianRise: median(meals.map((r) => r.rise!)),
    medianPeakMinutes: median(meals.map((r) => r.peakMinutes!)),
    riseCapped: meals.some((r) => r.riseCapped),
  };
}

/**
 * Foods ranked by the median rise after meals that included them. Only complete, comparable
 * meals count, and a food needs at least three of them.
 */
export function foodResponseRanking(
  responses: MealResponse[],
  minMeals = MIN_MEALS_FOR_RANKING,
): FoodResponse[] {
  const byFood = new Map<string, { name: string; items: MealResponse[] }>();
  for (const response of responses) {
    if (response.status !== "ok" || response.rise === null) continue;
    for (const name of response.foods) {
      const key = name.toLocaleLowerCase("en-US");
      const group = byFood.get(key) ?? { name, items: [] };
      group.items.push(response);
      byFood.set(key, group);
    }
  }
  return [...byFood.values()]
    .filter((group) => group.items.length >= minMeals)
    .map(({ name, items }) => ({
      name,
      meals: items.length,
      medianRise: median(items.map((r) => r.rise!)),
      medianPeakMinutes: median(items.map((r) => r.peakMinutes!)),
      riseCapped: items.some((r) => r.riseCapped),
    }))
    .sort((a, b) => b.medianRise - a.medianRise || a.name.localeCompare(b.name));
}
