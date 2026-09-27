import type { Entry, MealRatio, Plan } from "./care";

/**
 * After a new food entry, whether to point at the insulin calculator: only when the care plan
 * sets a snack cutoff and the entry reaches it. It repeats the plan's own rule and prefills the
 * calculator; it never works out or suggests a dose.
 */
export type FoodDosePrompt = {
  entryId: string;
  at: string;
  carbs: number;
  cutoff: number;
  /** The meal ratio the entry's own food type names, or null to go by the time of day. */
  ratioMeal: MealRatio | null;
  /** Carbs + correction while the current reading is above range; carbs only otherwise. */
  mode: "Carbs" | "Carbs + correction";
};

/** A food logged further from now than this is a record of the past, not a snack being eaten. */
const RECENT_MS = 60 * 60 * 1000;

export function foodDosePrompt({
  entry,
  plan,
  now,
  aboveRange,
}: {
  entry: Entry;
  plan: Pick<Plan, "snackInsulinFromCarbs">;
  now: number;
  aboveRange: boolean;
}): FoodDosePrompt | null {
  const cutoff = plan.snackInsulinFromCarbs;
  if (
    cutoff === undefined ||
    entry.kind !== "food" ||
    entry.meal === "Low treatment" ||
    entry.carbs === null ||
    entry.carbs < cutoff ||
    !(Math.abs(Date.parse(entry.at) - now) <= RECENT_MS)
  )
    return null;
  return {
    entryId: entry.id,
    at: entry.at,
    carbs: entry.carbs,
    cutoff,
    ratioMeal: /snack/i.test(entry.meal ?? "")
      ? "snack"
      : entry.meal === "Breakfast"
        ? "breakfast"
        : entry.meal === "Lunch"
          ? "lunch"
          : entry.meal === "Dinner"
            ? "dinner"
            : null,
    mode: aboveRange ? "Carbs + correction" : "Carbs",
  };
}
