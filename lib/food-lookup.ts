import { z } from "zod";
import { parsePortion } from "./portions";

/** Where a looked-up food came from. Shown with every match; the user checks it against the label. */
export const foodSources = ["off", "usda"] as const;
export type FoodSource = (typeof foodSources)[number];
export const foodSourceLabels: Record<FoodSource, string> = {
  off: "Open Food Facts",
  usda: "USDA FoodData Central",
};

const servingSchema = z.object({
  /** How the source describes this serving, such as "2 cookies (30 g)". */
  label: z.string().trim().min(1).max(100),
  servingSize: z.number().positive().max(1000),
  unit: z.string().trim().min(1).max(40),
  carbs: z.number().min(0).max(1000),
  /** What the serving weighs, when it is a measure like a cup and the label prints its grams. */
  grams: z.number().positive().max(1000).optional(),
});
export type FoodServing = z.infer<typeof servingSchema>;
const matchSchema = z.object({
  source: z.enum(foodSources),
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(100),
  brand: z.string().trim().min(1).max(100).nullable(),
  /** Carbs for each serving basis the source gives. Empty when it lists no carbohydrate value. */
  servings: z.array(servingSchema).max(3),
});
export type FoodMatch = z.infer<typeof matchSchema>;
export const foodLookupResultSchema = z.object({
  matches: z.array(matchSchema).max(20),
  /** Sources that were asked and did not answer, so "nothing found" is never claimed for them. */
  unavailable: z.array(z.enum(foodSources)),
});
export type FoodLookupResult = z.infer<typeof foodLookupResultSchema>;

export const FOOD_QUERY_MIN = 2;
export const FOOD_QUERY_MAX = 100;
const SEARCH_RESULTS = 6;

function gtinCheckDigitValid(digits: string): boolean {
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight)
    sum += Number(digits[i]) * weight;
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

/** UPC-E is a zero-suppressed UPC-A; the lookups only know the full 12 digits. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [s, d1, d2, d3, d4, d5, d6, check] = code;
  const body =
    d6 <= "2"
      ? `${d1}${d2}${d6}0000${d3}${d4}${d5}`
      : d6 === "3"
        ? `${d1}${d2}${d3}00000${d4}${d5}`
        : d6 === "4"
          ? `${d1}${d2}${d3}${d4}00000${d5}`
          : `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  const upcA = `${s}${body}${check}`;
  return gtinCheckDigitValid(upcA) ? upcA : null;
}

/**
 * A scanned or typed retail barcode as a GTIN: EAN-8, or 13 digits for UPC-A, EAN-13 and
 * GTIN-14 with a leading zero. Null when the check digit is wrong, which catches misreads
 * and typos before anything is sent.
 */
export function normalizeBarcode(input: string, format?: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  if (format === "upc_e" || (digits.length === 8 && !gtinCheckDigitValid(digits))) {
    const upcA = expandUpcE(digits);
    return upcA ? `0${upcA}` : null;
  }
  if (![8, 12, 13, 14].includes(digits.length) || !gtinCheckDigitValid(digits)) return null;
  if (digits.length === 12) return `0${digits}`;
  if (digits.length === 14 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

const tenth = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => String(tenth(n));

function num(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

function text(value: unknown, max = 100): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max).trim() : null;
}

function metricUnit(value: unknown): "g" | "ml" | null {
  const unit = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (unit === "g" || unit === "grm") return "g";
  if (unit === "ml" || unit === "mlt") return "ml";
  return null;
}

/** Keeps only servings a saved food can hold, rounded for the form without changing their meaning. */
export function servingsOf(candidates: FoodServing[]): FoodServing[] {
  return candidates
    .map((s) => ({
      ...s,
      carbs: tenth(s.carbs),
      // Kept to three places: "2/3 cup" rounded to 0.7 would be 5% off.
      servingSize: Math.round(s.servingSize * 1000) / 1000,
    }))
    .filter((s) => servingSchema.safeParse(s).success);
}

function match(value: FoodMatch): FoodMatch | null {
  const parsed = matchSchema.safeParse({ ...value, servings: servingsOf(value.servings) });
  return parsed.success ? parsed.data : null;
}

/** "2 cookies (30 g)" → 2 cookies. A bare "1 serving (28 g)" says nothing the grams don't. */
function householdServing(label: string | null): { size: number; unit: string } | null {
  const found =
    label && /^([\d.,/½¼¾⅓⅔ ]+?)\s*([a-z][a-z .'-]*?)\s*\(\s*[\d.,]+\s*(?:g|ml)\s*\)$/i.exec(label);
  if (!found) return null;
  const size = parsePortion(found[1].replace(",", ".").trim());
  const unit = found[2].trim().toLowerCase();
  if (!Number.isFinite(size) || size <= 0 || /^(servings?|portions?)$/.test(unit)) return null;
  return { size, unit };
}

/** One Open Food Facts product, from the product API or a search hit. Carbs are the label's. */
export function parseOpenFoodFactsProduct(product: unknown): FoodMatch | null {
  if (typeof product !== "object" || product === null) return null;
  const p = product as Record<string, unknown>;
  const nutriments = (typeof p.nutriments === "object" && p.nutriments) || {};
  const n = nutriments as Record<string, unknown>;
  const perServing = num(n.carbohydrates_serving),
    per100 = num(n.carbohydrates_100g),
    label = text(p.serving_size),
    // The printed unit wins: "1 cup (249 g)" has been filed with a unit of ml. The amount field
    // wins over the print, which can be per piece ("2 x 15 g").
    printed = label ? /([\d.,]+)\s*(g|ml)\b[^\d]*$/i.exec(label) : null,
    quantity = num(p.serving_quantity) ?? (printed ? num(printed[1].replace(",", ".")) : null),
    quantityUnit = metricUnit(printed?.[2] ?? p.serving_quantity_unit);
  const servings: FoodServing[] = [];
  if (perServing !== null) {
    const household = label && householdServing(label);
    if (household && label)
      servings.push({
        label,
        servingSize: household.size,
        unit: household.unit,
        carbs: perServing,
        ...(quantity && quantityUnit === "g" ? { grams: quantity } : {}),
      });
    if (quantity && quantityUnit)
      servings.push({
        label: `${fmt(quantity)} ${quantityUnit}`,
        servingSize: quantity,
        unit: quantityUnit,
        carbs: perServing,
      });
  }
  // Open Food Facts gives drinks per 100 ml in the same field.
  const per100Unit = quantityUnit ?? metricUnit(p.product_quantity_unit) ?? "g";
  if (per100 !== null && !servings.some((s) => s.unit === per100Unit))
    servings.push({
      label: `100 ${per100Unit}`,
      servingSize: 100,
      unit: per100Unit,
      carbs: per100,
    });
  const brands = Array.isArray(p.brands) ? p.brands[0] : p.brands;
  return match({
    source: "off",
    id: text(p.code, 40) ?? "",
    name: text(p.product_name) ?? text(p.product_name_en) ?? text(p.generic_name) ?? "",
    brand: text(typeof brands === "string" ? brands.split(",")[0] : null),
    servings,
  });
}

// "Carbohydrate, by difference" is the labeled total; "by summation" only fills in where it is missing.
const USDA_CARBS = [1005, 1050];

/** One FoodData Central search result. Its nutrients are per 100 g (per 100 ml for drinks). */
export function parseUsdaFood(food: unknown): FoodMatch | null {
  if (typeof food !== "object" || food === null) return null;
  const f = food as Record<string, unknown>;
  const nutrients = Array.isArray(f.foodNutrients) ? (f.foodNutrients as unknown[]) : [];
  const carbsBy = (id: number) => {
    for (const item of nutrients) {
      const n = item as { nutrientId?: unknown; value?: unknown; unitName?: unknown };
      if (n.nutrientId === id && String(n.unitName).toUpperCase() === "G") return num(n.value);
    }
    return null;
  };
  const per100 = USDA_CARBS.map(carbsBy).find((v) => v !== null) ?? null;
  const size = num(f.servingSize),
    unit = metricUnit(f.servingSizeUnit),
    household = text(f.householdServingFullText, 60);
  const servings: FoodServing[] = [];
  if (per100 !== null) {
    // Branded rows are the label's per-serving values scaled to 100 g, so this recovers them.
    if (size && unit)
      servings.push({
        label: `${fmt(size)} ${unit}${household ? ` (${household})` : ""}`,
        servingSize: size,
        unit,
        carbs: (per100 * size) / 100,
      });
    else {
      const per100Unit = unit ?? "g";
      servings.push({
        label: `100 ${per100Unit}`,
        servingSize: 100,
        unit: per100Unit,
        carbs: per100,
      });
    }
  }
  return match({
    source: "usda",
    id: String(num(f.fdcId) ?? ""),
    name: text(f.description) ?? "",
    brand: text(f.brandName) ?? text(f.brandOwner),
    servings,
  });
}

export type LookupDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** FoodData Central is only asked when a key is configured. */
  usdaKey: string | null;
  /** Open Food Facts asks every app to name itself. */
  userAgent: string;
};

const OFF_FIELDS =
  "code,product_name,product_name_en,generic_name,brands,serving_size,serving_quantity,serving_quantity_unit,product_quantity_unit,nutriments";
const TIMEOUT_MS = 8000;

async function getJson(deps: LookupDeps, url: string, headers: Record<string, string>) {
  const response = await deps.fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return (await response.json()) as unknown;
}

const offGet = (deps: LookupDeps, url: string) =>
  getJson(deps, url, { "User-Agent": deps.userAgent, Accept: "application/json" });

async function offProduct(deps: LookupDeps, code: string): Promise<FoodMatch | null> {
  const json = await offGet(
    deps,
    `https://world.openfoodfacts.org/api/v2/product/${code}?fields=${OFF_FIELDS}`,
  );
  const found = json as { status?: unknown; product?: unknown } | null;
  return found?.status === 1
    ? parseOpenFoodFactsProduct({ code, ...(found.product as object) })
    : null;
}

/**
 * The search index keeps only per-100 g values. The product record has the label's serving, so a
 * hit with nothing else is filled from it; if that fails, the per-100 g row still stands.
 */
async function withLabelServing(deps: LookupDeps, hit: FoodMatch): Promise<FoodMatch> {
  if (!/^\d{1,14}$/.test(hit.id) || hit.servings.some((s) => s.label !== `100 ${s.unit}`))
    return hit;
  try {
    const product = await offProduct(deps, hit.id);
    return product?.servings.length ? product : hit;
  } catch {
    return hit;
  }
}

function usdaSearch(deps: LookupDeps, query: string, dataType: string) {
  const params = new URLSearchParams({ query, dataType, pageSize: String(SEARCH_RESULTS) });
  return getJson(deps, `https://api.nal.usda.gov/fdc/v1/foods/search?${params}`, {
    "X-Api-Key": deps.usdaKey ?? "",
    Accept: "application/json",
  });
}

function usdaFoods(json: unknown): unknown[] {
  const foods = (json as { foods?: unknown } | null)?.foods;
  return Array.isArray(foods) ? foods : [];
}

/**
 * Looks a normalized barcode up in Open Food Facts first. FoodData Central is the fallback
 * when Open Food Facts doesn't know the product, has no carbs for it, or doesn't answer.
 */
export async function lookupBarcode(gtin: string, deps: LookupDeps): Promise<FoodLookupResult> {
  const unavailable: FoodSource[] = [];
  let off: FoodMatch | null = null;
  try {
    off = await offProduct(deps, gtin);
  } catch {
    unavailable.push("off");
  }
  if (off?.servings.length || !deps.usdaKey) return { matches: off ? [off] : [], unavailable };
  const matches: FoodMatch[] = [];
  try {
    // FoodData Central stores UPCs as 12, 13 or 14 digits and matches whole terms only.
    const gtin14 = gtin.padStart(14, "0");
    const forms = [gtin14, gtin14.slice(1), gtin14.slice(2)].filter((f) => f.length >= 8);
    const json = await usdaSearch(deps, forms.join(" "), "Branded");
    for (const food of usdaFoods(json)) {
      const upc = (food as { gtinUpc?: unknown }).gtinUpc;
      if (typeof upc !== "string" || upc.padStart(14, "0") !== gtin14) continue;
      const parsed = parseUsdaFood(food);
      if (parsed?.servings.length) {
        matches.push(parsed);
        break;
      }
    }
  } catch {
    unavailable.push("usda");
  }
  if (off) matches.push(off);
  return { matches, unavailable };
}

/**
 * Searches both sources by name. Open Food Facts is mostly packaged foods; FoodData Central also
 * covers plain foods such as fruit and rice, so it is asked alongside rather than only after.
 * Results without a carbohydrate value can't be used and are left out.
 */
export async function searchFoods(query: string, deps: LookupDeps): Promise<FoodLookupResult> {
  const offParams = new URLSearchParams({
    q: query,
    page_size: String(SEARCH_RESULTS * 2),
    fields: OFF_FIELDS,
  });
  const [off, usda] = await Promise.allSettled([
    offGet(deps, `https://search.openfoodfacts.org/search?${offParams}`),
    deps.usdaKey ? usdaSearch(deps, query, "Foundation,SR Legacy,Branded") : Promise.resolve(null),
  ]);
  const unavailable: FoodSource[] = [];
  const usable = (list: (FoodMatch | null)[]) => {
    // Search indexes hold many copies of one product; identical rows would only crowd the list.
    const seen = new Set<string>();
    return list
      .filter((m): m is FoodMatch => {
        if (!m?.servings.length) return false;
        const key = JSON.stringify([m.name.toLowerCase(), m.brand?.toLowerCase(), m.servings]);
        return !seen.has(key) && !!seen.add(key);
      })
      .slice(0, SEARCH_RESULTS);
  };
  const hits = (json: unknown) => {
    const list = (json as { hits?: unknown } | null)?.hits;
    return Array.isArray(list) ? list : [];
  };
  if (off.status === "rejected") unavailable.push("off");
  if (usda.status === "rejected") unavailable.push("usda");
  const offHits = usable(
    off.status === "fulfilled" ? hits(off.value).map(parseOpenFoodFactsProduct) : [],
  );
  return {
    matches: [
      ...usable(await Promise.all(offHits.map((hit) => withLabelServing(deps, hit)))),
      ...usable(usda.status === "fulfilled" ? usdaFoods(usda.value).map(parseUsdaFood) : []),
    ],
    unavailable,
  };
}
