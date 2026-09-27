import { servingsOf, type FoodServing } from "./food-lookup";
import { parsePortion } from "./portions";

/** One line of text read from a photo, with the reader's 0–100 confidence in it. */
export type OcrLine = { text: string; confidence: number };

/** Below this, a line the value came from is shown as uncertain. */
export const LOW_CONFIDENCE = 75;

export type LabelField = {
  /** The line as it was read, so the user can compare it with the photo. */
  read: string;
  uncertain: boolean;
};

export type LabelReading = {
  serving: LabelField | null;
  carbs: (LabelField & { grams: number | null }) | null;
  /** Serving bases with their carbs; empty when the carbs couldn't be read. */
  servings: FoodServing[];
};

const tenth = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => String(tenth(n));
const decimal = (s: string) => Number(s.replace(",", "."));

type Amount = { value: number; unit: "g" | "ml"; guessed: boolean };

/**
 * A metric amount such as "55g" or "240 mL". A lone trailing 9 where a unit belongs ("559)")
 * is how "g" is often misread, so it is taken as grams but marked as guessed.
 */
function metricAmount(text: string, closing: boolean): Amount | null {
  const unit = /([\d]+(?:[.,]\d+)?)\s*(m\s*l|g|gr|grams?)\b/i.exec(text);
  if (unit)
    return {
      value: decimal(unit[1]),
      unit: /^m/i.test(unit[2]) ? "ml" : "g",
      guessed: false,
    };
  const misread = closing ? /(\d+(?:[.,]\d+)?)9\s*\)/.exec(text) : null;
  return misread ? { value: decimal(misread[1]), unit: "g", guessed: true } : null;
}

type Serving = { household: { size: number; unit: string } | null; metric: Amount | null };

/** "2/3 cup (55g)", "About 2 cookies (30 g)", "1 bar (40g)" or "30g". */
function parseServing(value: string): Serving | null {
  const text = value.replace(/^about\s+/i, "").trim();
  const paren = /\(([^)]*)\)?/.exec(text);
  const metric = paren ? metricAmount(`${paren[1]})`, true) : metricAmount(text, false);
  const before = (paren ? text.slice(0, paren.index) : text).trim();
  const household = /^([\d.,/½¼¾⅓⅔ ]+?)\s*([a-z][a-z .'-]*)$/i.exec(before);
  let parsed: Serving["household"] = null;
  if (household && !/^(g|gr|grams?|m\s*l)$/i.test(household[2].trim())) {
    const size = parsePortion(household[1].replace(",", ".").trim());
    const unit = household[2].trim().toLowerCase();
    if (Number.isFinite(size) && size > 0 && unit.length <= 40 && !/^servings?$/.test(unit))
      parsed = { size, unit };
  }
  return parsed || metric ? { household: parsed, metric } : null;
}

const SERVING = /serving\s*size\s*[:.]?\s*(.*)$/i;
// "Total Carbohydrate", "Total Carb.", "Total Carbs"; EU and UK panels say just "Carbohydrate".
const TOTAL_CARBS = /total\s*carb(?:ohydrates?|s)?\.?/i;
const CARBS = /\bcarbohydrates?\b/i;
const HUNDRED = /\b100\s*(g|m\s*l)\b/i;

/**
 * Reads the serving size and carbohydrate amount from the text of a nutrition label photo.
 * US panels give carbs per serving; panels with a "per 100 g" column give them per 100 g or ml.
 * Nothing is guessed silently: a value from a hard-to-read line, a misread unit, or carbs heavier
 * than the serving they are in is returned as uncertain for the user to check against the photo.
 */
export function readNutritionLabel(lines: OcrLine[]): LabelReading {
  const clean = lines
    .map((l) => ({ text: l.text.replace(/\s+/g, " ").trim(), confidence: l.confidence }))
    .filter((l) => l.text);

  let serving: LabelField | null = null,
    parsedServing: Serving | null = null;
  const servingAt = clean.findIndex((l) => SERVING.test(l.text));
  if (servingAt >= 0) {
    const line = clean[servingAt];
    let value = SERVING.exec(line.text)?.[1].trim() ?? "";
    let confidence = line.confidence;
    // Some panels print the value on the line below the heading.
    if (!value && clean[servingAt + 1]) {
      value = clean[servingAt + 1].text;
      confidence = Math.min(confidence, clean[servingAt + 1].confidence);
    }
    parsedServing = value ? parseServing(value) : null;
    serving = {
      read: value || line.text,
      uncertain: !parsedServing || confidence < LOW_CONFIDENCE || !!parsedServing.metric?.guessed,
    };
  }

  // The column heading ("Per 100g"); reading can split or reorder it ("100g Per").
  const per100 = clean.find(
    (l) => HUNDRED.test(l.text) && /\bper\b/i.test(l.text) && !CARBS.test(l.text),
  );
  const per100Unit = per100 && /m/i.test(HUNDRED.exec(per100.text)?.[1] ?? "") ? "ml" : "g";
  const carbsLine =
    clean.find((l) => TOTAL_CARBS.test(l.text)) ??
    clean.find((l) => CARBS.test(l.text) && !/of which|sugars/i.test(l.text));
  let carbs: LabelReading["carbs"] = null;
  const servings: FoodServing[] = [];
  if (carbsLine) {
    const keyword = TOTAL_CARBS.exec(carbsLine.text) ?? CARBS.exec(carbsLine.text);
    const after = carbsLine.text.slice(keyword?.index ?? 0);
    // A hard-to-read heading makes what the amount is per uncertain too.
    let uncertain =
      carbsLine.confidence < LOW_CONFIDENCE || (!!per100 && per100.confidence < LOW_CONFIDENCE);
    // "Less than 1g" is not an amount to enter; the user decides from the label.
    const lessThan = /(<|less than)\s*1\s*g/i.test(after);
    // The % daily value follows the grams and is not an amount.
    const amounts = [
      ...after.replace(/\d+(?:[.,]\d+)?\s*%/g, " ").matchAll(/(\d+(?:[.,]\d+)?)\s*(mg|g)?\b/gi),
    ]
      .filter((m) => m[2]?.toLowerCase() !== "mg")
      .map((m) => {
        if (m[2]) return decimal(m[1]);
        // No unit: "379" is usually "37g" with the g misread. Either way it is only a guess.
        uncertain = true;
        return m[1].length > 1 && m[1].endsWith("9") ? decimal(m[1].slice(0, -1)) : decimal(m[1]);
      });
    const grams = lessThan ? null : (amounts[0] ?? null);
    // EU and UK panels name the portion in the column heading: "Per 100g   Per 30g serving".
    const headingPortion = per100
      ? [...per100.text.matchAll(/per\s*([\d.,]+)\s*(g|m\s*l)\b/gi)]
          .map(
            (m) =>
              ({
                value: decimal(m[1]),
                unit: /m/i.test(m[2]) ? "ml" : "g",
                guessed: false,
              }) as Amount,
          )
          .find((a) => a.value !== 100)
      : undefined;
    const metric = parsedServing?.metric ?? headingPortion;
    // Carbs can't weigh more than the food they are in.
    const limit = per100 ? 100 : metric?.unit === "g" ? metric.value : Infinity;
    if (grams === null || grams > limit) uncertain = true;
    carbs = { read: carbsLine.text, uncertain, grams };

    if (grams !== null && per100) {
      servings.push({
        label: `100 ${per100Unit}`,
        servingSize: 100,
        unit: per100Unit,
        carbs: grams,
      });
      // A second column, when the panel also has one, is per portion.
      const perPortion = amounts[1];
      if (perPortion !== undefined && metric)
        servings.push({
          label: `${fmt(metric.value)} ${metric.unit}`,
          servingSize: metric.value,
          unit: metric.unit,
          carbs: perPortion,
        });
    } else if (grams !== null && parsedServing) {
      const { household, metric: m } = parsedServing;
      if (household)
        servings.push({
          label: (serving?.read ?? "").slice(0, 100),
          servingSize: household.size,
          unit: household.unit,
          carbs: grams,
        });
      if (m)
        servings.push({
          label: `${fmt(m.value)} ${m.unit}`,
          servingSize: m.value,
          unit: m.unit,
          carbs: grams,
        });
    }
  }
  return {
    serving,
    carbs,
    servings: servingsOf(servings),
  };
}
