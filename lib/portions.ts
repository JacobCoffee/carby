import { savedFoodSchema } from "./care";

/** Volume unit conversions to milliliters, for converting a portion typed in one
 * volume unit (say, cups) into a food's labeled serving unit (say, mL). */
export const volumeMl: Record<string, number> = {
  cup: 240,
  cups: 240,
  tbsp: 15,
  tsp: 5,
  "fl oz": 30,
  ml: 1,
};

const vulgarFractions: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
};

/**
 * Parses a portion amount typed by a caregiver: a plain number ("1.5"), a vulgar
 * fraction ("½"), a mixed vulgar fraction ("1½"), or a slash fraction ("1 1/4", "2/3").
 * Returns NaN for anything else, including empty input.
 */
export function parsePortion(value: string): number {
  const cleaned = value.trim().replaceAll("⁄", "/");
  if (cleaned in vulgarFractions) return vulgarFractions[cleaned];
  const mixed = /^(\d+)\s*([½¼¾⅓⅔])$/.exec(cleaned);
  if (mixed) return Number(mixed[1]) + vulgarFractions[mixed[2]];
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) return Number(cleaned);
  const match = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(cleaned);
  if (!match || Number(match[3]) === 0) return NaN;
  return Number(match[1] ?? 0) + Number(match[2]) / Number(match[3]);
}

/** Shape shared by anything expressing "how much of this food was eaten". */
export type Portioned = {
  /** Raw portion text: a serving count when byServing, else an amount in amountUnit. */
  servings: string;
  /** How much of `unit` makes up one labeled serving. */
  servingSize: string;
  /** The food's labeled serving unit (e.g. "cup", "slice"). */
  unit: string;
  /** The unit the typed amount is expressed in, when not measuring by servings. */
  amountUnit?: string;
  /** True when `servings` counts whole/fractional servings rather than a raw amount. */
  byServing?: boolean;
  /** What one serving weighs in grams, so an amount typed in grams works for a food labeled per cup. */
  servingGrams?: number;
};

export const isGrams = (unit: string) => unit.trim().toLowerCase() === "g";

/**
 * Converts a portion into an amount expressed in the food's labeled serving unit.
 * Handles a differing amount unit via volume conversion (e.g. typing cups for a
 * food labeled in mL), or via the serving's weight for grams; an unconvertible unit
 * pair is returned unconverted.
 */
export function amountInServingUnits(food: Portioned): number {
  if (food.byServing) return parsePortion(food.servings) * Number(food.servingSize);
  const amount = parsePortion(food.servings);
  const amountUnit = food.amountUnit ?? food.unit;
  if (isGrams(amountUnit) && !isGrams(food.unit) && food.servingGrams)
    return (amount / food.servingGrams) * Number(food.servingSize);
  const from = volumeMl[amountUnit];
  const to = volumeMl[food.unit];
  return from && to ? (amount * from) / to : amount;
}

/**
 * How much was eaten, in the unit it was measured in, for recording with its carbs: servings
 * become an amount of the food's unit; a typed amount stays in the unit it was typed in.
 */
export function amountEaten(food: Portioned): number {
  return food.byServing ? amountInServingUnits(food) : parsePortion(food.servings);
}

/** A food's label as typed into a form: what one serving is and how many carbs it holds. */
export type FoodBasisFields = {
  name: string;
  carbs: string;
  servingSize: string;
  unit: string;
  /** What one serving weighs in grams; optional, and ignored for a serving already in grams. */
  grams?: string;
};
export type FoodBasis = {
  name: string;
  carbs: number;
  servingSize: number;
  unit: string;
  grams?: number;
};

const foodBasisSchema = savedFoodSchema.pick({
  name: true,
  carbs: true,
  serving: true,
  unit: true,
  grams: true,
});

/** Reads typed label fields with the saved-food limits. Null when any field is out of range or
 * a required one is blank, so a food never gets a made-up carb count or serving. */
export function parseFoodBasis(fields: FoodBasisFields): FoodBasis | null {
  const number = (value: string) => (value.trim() === "" ? NaN : Number(value));
  const grams = fields.grams?.trim() && !isGrams(fields.unit) ? number(fields.grams) : undefined;
  const parsed = foodBasisSchema.safeParse({
    name: fields.name,
    carbs: number(fields.carbs),
    serving: number(fields.servingSize),
    unit: fields.unit,
    grams,
  });
  if (!parsed.success) return null;
  const { name, carbs, serving, unit } = parsed.data;
  return {
    name,
    carbs,
    servingSize: serving,
    unit,
    ...(parsed.data.grams ? { grams: parsed.data.grams } : {}),
  };
}
