import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  expandUpcE,
  foodLookupResultSchema,
  lookupBarcode,
  normalizeBarcode,
  parseOpenFoodFactsProduct,
  parseUsdaFood,
  searchFoods,
} from "../lib/food-lookup.ts";

// Trimmed from real responses for UPC 038000138416 (Pringles Original).
const pringlesOff = {
  code: "0038000138416",
  product_name: "Original Potato Crisps",
  brands: "Pringles",
  serving_size: "1 serving (28 g)",
  serving_quantity: 28,
  serving_quantity_unit: "g",
  nutriments: { carbohydrates_100g: 57, carbohydrates_serving: 16, carbohydrates_unit: "g" },
};
const pringlesUsda = {
  fdcId: 2775576,
  description: "Pringles Crisps Original 5.2oz",
  gtinUpc: "00038000138416",
  brandName: "Pringles",
  servingSize: 28,
  servingSizeUnit: "GRM",
  householdServingFullText: "About 15 Crisps",
  foodNutrients: [
    { nutrientId: 1005, nutrientName: "Carbohydrate, by difference", value: 60.71, unitName: "G" },
  ],
};

test("normalizeBarcode accepts retail barcodes with a valid check digit only", () => {
  assert.equal(normalizeBarcode("038000138416"), "0038000138416");
  assert.equal(normalizeBarcode("0038000138416"), "0038000138416");
  assert.equal(normalizeBarcode("00038000138416"), "0038000138416");
  assert.equal(normalizeBarcode(" 0-38000-13841-6 "), "0038000138416");
  assert.equal(normalizeBarcode("96385074"), "96385074");
  for (const bad of ["038000138417", "12345", "abc", "", "0380001384166"])
    assert.equal(normalizeBarcode(bad), null, `expected null for ${JSON.stringify(bad)}`);
});

test("UPC-E barcodes expand to the full UPC-A the databases use", () => {
  assert.equal(expandUpcE("04252614"), "042100005264");
  assert.equal(normalizeBarcode("04252614", "upc_e"), "0042100005264");
  // Not a valid EAN-8, so a typed eight-digit code is read as UPC-E.
  assert.equal(normalizeBarcode("04252614"), "0042100005264");
  assert.equal(expandUpcE("24252614"), null);
});

test("an Open Food Facts product offers the label serving, not a duplicate per 100 g", () => {
  const match = parseOpenFoodFactsProduct(pringlesOff);
  assert.deepEqual(match, {
    source: "off",
    id: "0038000138416",
    name: "Original Potato Crisps",
    brand: "Pringles",
    servings: [{ label: "28 g", servingSize: 28, unit: "g", carbs: 16 }],
  });
});

test("a household serving on the label becomes its own option", () => {
  const match = parseOpenFoodFactsProduct({
    ...pringlesOff,
    serving_size: "2 cookies (30 g)",
    serving_quantity: "30",
    nutriments: { carbohydrates_serving: 21, carbohydrates_100g: 70 },
  });
  assert.deepEqual(match.servings, [
    { label: "2 cookies (30 g)", servingSize: 2, unit: "cookies", carbs: 21 },
    { label: "30 g", servingSize: 30, unit: "g", carbs: 21 },
  ]);
});

test("without a serving, Open Food Facts carbs are per 100 g, or per 100 ml for drinks", () => {
  const solid = parseOpenFoodFactsProduct({
    code: "3017620422003",
    product_name: "Nutella",
    brands: ["Ferrero", "Nutella"],
    nutriments: { carbohydrates_100g: 57.5 },
  });
  assert.equal(solid.brand, "Ferrero");
  assert.deepEqual(solid.servings, [{ label: "100 g", servingSize: 100, unit: "g", carbs: 57.5 }]);
  const drink = parseOpenFoodFactsProduct({
    code: "5449000000996",
    product_name: "Coca-Cola",
    product_quantity_unit: "ml",
    nutriments: { carbohydrates_100g: 10.6 },
  });
  assert.deepEqual(drink.servings, [
    { label: "100 ml", servingSize: 100, unit: "ml", carbs: 10.6 },
  ]);
});

test("the printed serving unit wins over a conflicting unit field", () => {
  // Real Open Food Facts data for 0041196910759 (Progresso soup).
  const match = parseOpenFoodFactsProduct({
    code: "0041196910759",
    product_name: "Beef & Vegetable Soup",
    serving_size: "1 cup (249 g)",
    serving_quantity: 249,
    serving_quantity_unit: "ml",
    nutriments: { carbohydrates_serving: 17, carbohydrates_100g: 6.83 },
  });
  assert.deepEqual(match.servings, [
    { label: "1 cup (249 g)", servingSize: 1, unit: "cup", carbs: 17 },
    { label: "249 g", servingSize: 249, unit: "g", carbs: 17 },
  ]);
});

test("a product with no carbohydrate value keeps its name but offers no carbs", () => {
  const match = parseOpenFoodFactsProduct({ code: "2000000151418", product_name: "Fresh Banana" });
  assert.equal(match.name, "Fresh Banana");
  assert.deepEqual(match.servings, []);
  assert.equal(
    parseOpenFoodFactsProduct({ code: "1", nutriments: { carbohydrates_100g: 5 } }),
    null,
  );
});

test("a branded FoodData Central food recovers the label's carbs per serving", () => {
  assert.deepEqual(parseUsdaFood(pringlesUsda), {
    source: "usda",
    id: "2775576",
    name: "Pringles Crisps Original 5.2oz",
    brand: "Pringles",
    servings: [{ label: "28 g (About 15 Crisps)", servingSize: 28, unit: "g", carbs: 17 }],
  });
});

test("a plain FoodData Central food is per 100 g, falling back to carbs by summation", () => {
  const banana = parseUsdaFood({
    fdcId: 1105073,
    description: "Bananas, overripe, raw",
    foodNutrients: [{ nutrientId: 1050, value: 18, unitName: "G" }],
  });
  assert.deepEqual(banana.servings, [{ label: "100 g", servingSize: 100, unit: "g", carbs: 18 }]);
  const both = parseUsdaFood({
    fdcId: 1,
    description: "Bananas, raw",
    foodNutrients: [
      { nutrientId: 1050, value: 18, unitName: "G" },
      { nutrientId: 1005, value: 22.8, unitName: "G" },
    ],
  });
  assert.equal(both.servings[0].carbs, 22.8);
});

function stubFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    for (const [prefix, reply] of routes)
      if (url.startsWith(prefix)) {
        if (reply === "fail") throw new TypeError("fetch failed");
        if (typeof reply === "number") return new Response("", { status: reply });
        return Response.json(reply);
      }
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, calls };
}
const OFF_PRODUCT = "https://world.openfoodfacts.org/api/v2/product/";
const OFF_SEARCH = "https://search.openfoodfacts.org/search";
const USDA = "https://api.nal.usda.gov/fdc/v1/foods/search";
const deps = (fetch, usdaKey = "key") => ({ fetch, usdaKey, userAgent: "Carby/test" });

test("a barcode Open Food Facts knows never reaches FoodData Central", async () => {
  const { fetch, calls } = stubFetch([[OFF_PRODUCT, { status: 1, product: pringlesOff }]]);
  const result = await lookupBarcode("0038000138416", deps(fetch));
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].source, "off");
  assert.deepEqual(result.unavailable, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["User-Agent"], "Carby/test");
});

test("FoodData Central is the fallback for unknown, carb-less or unreachable products", async () => {
  const usda = { foods: [{ ...pringlesUsda, gtinUpc: "00038000999999" }, pringlesUsda] };
  for (const [offReply, unavailable, fromOff] of [
    [404, [], 0],
    [{ status: 1, product: { code: "0038000138416", product_name: "Crisps" } }, [], 1],
    ["fail", ["off"], 0],
    [503, ["off"], 0],
  ]) {
    const { fetch, calls } = stubFetch([
      [OFF_PRODUCT, offReply],
      [USDA, usda],
    ]);
    const result = await lookupBarcode("0038000138416", deps(fetch));
    assert.deepEqual(
      result.matches.map((m) => [m.source, m.id]),
      [["usda", "2775576"], ...(fromOff ? [["off", "0038000138416"]] : [])],
    );
    assert.deepEqual(result.unavailable, unavailable);
    const usdaCall = calls.find((c) => c.url.startsWith(USDA));
    assert.equal(
      new URL(usdaCall.url).searchParams.get("query"),
      "00038000138416 0038000138416 038000138416",
    );
    assert.equal(usdaCall.headers["X-Api-Key"], "key");
    assert.ok(!usdaCall.url.includes("key="), "the key stays out of the URL");
  }
});

test("without a USDA key only Open Food Facts is asked", async () => {
  const { fetch, calls } = stubFetch([[OFF_PRODUCT, 404]]);
  assert.deepEqual(await lookupBarcode("0038000138416", deps(fetch, null)), {
    matches: [],
    unavailable: [],
  });
  assert.equal(calls.length, 1);
});

test("a name search lists usable Open Food Facts hits, then FoodData Central", async () => {
  const { fetch } = stubFetch([
    [OFF_SEARCH, { hits: [{ code: "1", product_name: "Banana chips" }, pringlesOff] }],
    [USDA, { foods: [pringlesUsda] }],
  ]);
  const result = await searchFoods("crisps", deps(fetch));
  assert.deepEqual(
    result.matches.map((m) => m.source),
    ["off", "usda"],
  );
  assert.ok(foodLookupResultSchema.safeParse(result).success);
});

test("a name search still answers when one source is down", async () => {
  const { fetch } = stubFetch([
    [OFF_SEARCH, 429],
    [USDA, { foods: [pringlesUsda] }],
  ]);
  const result = await searchFoods("crisps", deps(fetch));
  assert.deepEqual(result.unavailable, ["off"]);
  assert.deepEqual(
    result.matches.map((m) => m.source),
    ["usda"],
  );
});

test("a name search shows one row for identical copies of a product", async () => {
  const cheerios = (code, carbs) => ({
    code,
    product_name: "Cheerios",
    nutriments: { carbohydrates_100g: carbs },
  });
  const { fetch } = stubFetch([
    [
      OFF_SEARCH,
      {
        hits: [
          cheerios("95693231", 74.358974),
          cheerios("0003625341118", 74.3589743589744),
          cheerios("1", 81.1),
        ],
      },
    ],
  ]);
  const result = await searchFoods("cheerios", deps(fetch, null));
  assert.deepEqual(
    result.matches.map((m) => [m.id, m.servings[0].carbs]),
    [
      ["95693231", 74.4],
      ["1", 81.1],
    ],
  );
});

test("a per-100 g search hit takes the label serving from its product record", async () => {
  const coco = { code: "4830040867419", product_name: "Magic Spoon Coco cereal" };
  const hit = (code, carbs) => ({ ...coco, code, nutriments: { carbohydrates_100g: carbs } });
  const { fetch, calls } = stubFetch([
    [OFF_SEARCH, { hits: [hit(coco.code, 40.5405405405405), hit("123", 36.8)] }],
    [
      `${OFF_PRODUCT}${coco.code}`,
      {
        status: 1,
        product: {
          ...coco,
          serving_size: "37.0g",
          serving_quantity: 37,
          nutriments: { carbohydrates_100g: 40.5405405405405, carbohydrates_serving: 15 },
        },
      },
    ],
    [OFF_PRODUCT, "fail"],
  ]);
  const result = await searchFoods("magic spoon coco", deps(fetch, null));
  assert.deepEqual(
    result.matches.map((m) => [m.id, m.servings.map((s) => [s.carbs, s.servingSize, s.unit])]),
    [
      [coco.code, [[15, 37, "g"]]],
      // The product record didn't answer, so the per-100 g row stays.
      ["123", [[36.8, 100, "g"]]],
    ],
  );
  assert.equal(calls.filter((c) => c.url.startsWith(OFF_PRODUCT)).length, 2);
});
