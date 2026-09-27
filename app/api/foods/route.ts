import { personAccess } from "@/app/access";
import {
  FOOD_QUERY_MAX,
  FOOD_QUERY_MIN,
  lookupBarcode,
  normalizeBarcode,
  searchFoods,
  type FoodLookupResult,
  type LookupDeps,
} from "@/lib/food-lookup";

export const dynamic = "force-dynamic";

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

// Product data is public and changes rarely; reusing it spares the sources' rate limits.
const cache = new Map<string, { at: number; result: FoodLookupResult }>();
const CACHE_MS = 60 * 60 * 1000;
const CACHE_ENTRIES = 500;

function remember(key: string, result: FoodLookupResult) {
  if (result.unavailable.length) return;
  cache.delete(key);
  cache.set(key, { at: Date.now(), result });
  if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
}

/**
 * Food label lookup: GET /api/foods?barcode=… or ?q=…. Only the barcode or the search words
 * leave Carby; nothing about the person is sent. Anyone who can log for this person may ask.
 */
export async function GET(request: Request) {
  const access = await personAccess(request, "log");
  if (access instanceof Response) return access;
  const params = new URL(request.url).searchParams;
  const barcode = params.get("barcode"),
    query = params.get("q")?.replace(/\s+/g, " ").trim() ?? "";
  const gtin =
    barcode === null ? null : normalizeBarcode(barcode, params.get("format") ?? undefined);
  if (barcode !== null && !gtin)
    return reply({ error: "That barcode isn’t valid. Check the digits and try again." }, 400);
  if (!gtin && (query.length < FOOD_QUERY_MIN || query.length > FOOD_QUERY_MAX))
    return reply(
      { error: `Enter ${FOOD_QUERY_MIN} to ${FOOD_QUERY_MAX} characters to search.` },
      400,
    );
  const key = gtin ? `barcode:${gtin}` : `q:${query.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return reply(cached.result);
  const deps: LookupDeps = {
    fetch: (url, init) => fetch(url, init),
    usdaKey: process.env.USDA_API_KEY?.trim() || null,
    userAgent: `Carby/1.0 (${process.env.APP_URL || "self-hosted"})`,
  };
  const result = gtin ? await lookupBarcode(gtin, deps) : await searchFoods(query, deps);
  remember(key, result);
  return reply(result);
}
