import type { CgmReading, Entry, MealRatio } from "./care";

export type MealWindow = "Breakfast" | "Lunch" | "Dinner";
export const mealHours: Record<MealWindow, [number, number]> = {
  Breakfast: [6, 10],
  Lunch: [11, 15],
  Dinner: [17, 21],
};

/** Initial picker choice only; keep a user's choice stable while calculating. */
export function mealRatioAt(at: Date, timezone: string): MealRatio {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at),
  );
  for (const name of ["Breakfast", "Lunch", "Dinner"] as const) {
    const [start, end] = mealHours[name];
    if (hour >= start && hour < end) return name.toLowerCase() as MealRatio;
  }
  return "snack";
}

/** Keep report dates within the loaded window and at most 30 calendar days. */
export function reportRangeIsValid(
  from: string,
  to: string,
  earliestLoadedDay: string,
  today: string,
): boolean {
  const daysApart = (Date.parse(to) - Date.parse(from)) / 86400000;
  return (
    !!from &&
    !!to &&
    from >= earliestLoadedDay &&
    from <= to &&
    to <= today &&
    Number.isFinite(daysApart) &&
    daysApart < 30
  );
}

/** Group explicit meals by their logged label; use clock windows only for legacy "Meal" entries. */
export function foodEntriesForMeal(
  day: string,
  name: MealWindow,
  entries: Entry[],
  timezone: string,
): Entry[] {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const [from, to] = mealHours[name];
  return entries
    .filter((e) => {
      if (e.kind !== "food") return false;
      const parts = formatter.formatToParts(new Date(e.at));
      const get = (part: string) => parts.find((p) => p.type === part)?.value ?? "";
      const localDay = get("year") + "-" + get("month") + "-" + get("day");
      return (
        localDay === day &&
        (e.meal === name ||
          (e.meal === "Meal" && Number(get("hour")) >= from && Number(get("hour")) < to))
      );
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Find observations around an actual food event rather than a clock window.
 * A post-food fallback is labeled as such; it is never presented as premeal.
 */
export function readingsNearFood(at: string, entries: Entry[], cgm: CgmReading[]) {
  const anchor = Date.parse(at);
  const manual = entries
    .filter((e) => e.kind === "glucose")
    .sort((a, b) => a.at.localeCompare(b.at));
  const orderedCgm = [...cgm].sort((a, b) => a.at.localeCompare(b.at));
  const before = manual
    .filter((e) => Date.parse(e.at) <= anchor && Date.parse(e.at) >= anchor - 90 * 60000)
    .at(-1);
  const after = before
    ? undefined
    : manual.find((e) => Date.parse(e.at) > anchor && Date.parse(e.at) <= anchor + 30 * 60000);
  const nearBefore = orderedCgm
    .filter((e) => Date.parse(e.at) <= anchor && Date.parse(e.at) >= anchor - 20 * 60000)
    .at(-1);
  const nearAfter = nearBefore
    ? undefined
    : orderedCgm.find((e) => Date.parse(e.at) > anchor && Date.parse(e.at) <= anchor + 20 * 60000);
  return { before, after, nearBefore, nearAfter };
}
