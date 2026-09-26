import { entrySchema, type Entry, type FoodItem, type MealRatio } from "./care";

const mealLabels: Record<MealRatio, NonNullable<Entry["meal"]>> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};
export function mealLabel(ratio?: MealRatio): NonNullable<Entry["meal"]> {
  return ratio ? mealLabels[ratio] : "Meal";
}

/** The note a food record gets from its picked items, e.g. "Milk: 1 cup; Toast: 2 slice". */
export function foodItemsNote(items: FoodItem[]): string {
  return items
    .map((item) => `${item.name}: ${Number(item.amount.toFixed(2))} ${item.unit}`)
    .join("; ");
}

export type DoseFood = { id: string; at: string; carbs: number; description: string; dose: Entry };
/** Display older food details at their dose's time, without inventing a meal record. */
export function mealDoseFoods(entries: Entry[]): DoseFood[] {
  return entries.flatMap((dose) => {
    const calc = dose.calculation;
    if (
      dose.kind !== "insulin" ||
      !calc ||
      calc.mode === "Correction" ||
      calc.carbs <= 0 ||
      calc.foodEntryIds.length ||
      calc.foodLog === "dose-only"
    )
      return [];
    return [
      {
        id: `dose-food:${dose.id}`,
        at: dose.at,
        carbs: calc.carbs,
        description: calc.foodDescription ?? "",
        dose,
      },
    ];
  });
}

export function foodFromCalculation(
  id: string,
  at: string,
  calculation: NonNullable<Entry["calculation"]>,
  meal: Entry["meal"],
  items?: FoodItem[],
): Entry {
  if (calculation.mode === "Correction" || calculation.carbs <= 0)
    throw new Error("This calculation has no food to log.");
  return entrySchema.parse({
    id,
    kind: "food",
    at,
    carbs: calculation.carbs,
    meal,
    foodItems: items?.length ? items : undefined,
    note: (calculation.foodDescription ?? "Food recorded with insulin calculation").slice(0, 1000),
    glucose: null,
    source: null,
    ketones: null,
    units: null,
    insulin: null,
  });
}

/** Only explicit record IDs establish a link; matching times alone never do. */
export function mealLinks(entries: Entry[]): { food: Entry; dose: Entry }[] {
  const foods = new Map(
    entries.filter((entry) => entry.kind === "food").map((entry) => [entry.id, entry]),
  );
  return entries
    .filter((entry) => entry.kind === "insulin")
    .flatMap((dose) =>
      [...new Set(dose.calculation?.foodEntryIds ?? [])].flatMap((id) => {
        const food = foods.get(id);
        return food ? [{ food, dose }] : [];
      }),
    );
}
export function relatedMealRecords(entry: Entry, entries: Entry[]): Entry[] {
  return mealLinks(entries).flatMap((pair) =>
    pair.dose.id === entry.id ? [pair.food] : pair.food.id === entry.id ? [pair.dose] : [],
  );
}

export function attachMealFood(dose: Entry, food: Entry): Entry {
  const calc = dose.calculation;
  if (
    dose.kind !== "insulin" ||
    !calc ||
    calc.mode === "Correction" ||
    calc.carbs <= 0 ||
    calc.foodEntryIds.length
  )
    throw new Error("This dose has no unlinked food calculation.");
  if (
    food.kind !== "food" ||
    food.id === dose.id ||
    food.carbs === null ||
    Math.abs(food.carbs - calc.carbs) > 0.02
  )
    throw new Error("Food must match the carbohydrate total used for this dose.");
  return { ...dose, calculation: { ...calc, foodEntryIds: [food.id] } };
}

/** Validate new entries together before they are committed in one transaction. */
export function calculationRecords(
  dose: Entry,
  glucose: Entry | null,
  food: Entry | null,
): Entry[] {
  const records = [dose, ...(glucose ? [glucose] : []), ...(food ? [food] : [])];
  if (new Set(records.map((record) => record.id)).size !== records.length)
    throw new Error("Each record needs a different ID.");
  if (food) {
    const calc = dose.calculation;
    if (
      !calc ||
      calc.mode === "Correction" ||
      food.kind !== "food" ||
      food.carbs === null ||
      food.carbs <= 0 ||
      Math.abs(food.carbs - calc.carbs) > 0.02 ||
      calc.foodEntryIds.length !== 1 ||
      calc.foodEntryIds[0] !== food.id
    )
      throw new Error("Food does not match the linked meal calculation.");
  }
  return records;
}

// Both statements run in the same batch transaction. The identical source-record guard
// prevents a stale confirmation from inserting food without attaching its dose.
export const insertMealFoodSql =
  "INSERT INTO entries (id, owner, at, data, plan, updated) SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (SELECT 1 FROM entries WHERE id = $7 AND owner = $8 AND data = $9 AND updated = $10)";
export const attachMealFoodSql =
  "UPDATE entries SET data = $1, updated = $2 WHERE id = $3 AND owner = $4 AND data = $5 AND updated = $6 AND EXISTS (SELECT 1 FROM entries WHERE id = $7 AND owner = $8 AND data = $9)";
