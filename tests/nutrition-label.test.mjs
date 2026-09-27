import { test } from "bun:test";
import assert from "node:assert/strict";
import { readNutritionLabel } from "../lib/nutrition-label.ts";

const read = (texts, confidence = 92) =>
  readNutritionLabel(texts.map((text) => (typeof text === "string" ? { text, confidence } : text)));

const usPanel = [
  "Nutrition Facts",
  "8 servings per container",
  "Serving size 2/3 cup (55g)",
  "Amount per serving",
  "Calories 230",
  "Total Fat 8g 10%",
  "Sodium 160mg 7%",
  "Total Carbohydrate 37g 13%",
  "Dietary Fiber 4g 14%",
  "Total Sugars 12g",
  "Includes 10g Added Sugars 20%",
];

test("a clear US panel gives carbs per household serving and per gram weight", () => {
  const reading = read(usPanel);
  assert.deepEqual(reading.serving, { read: "2/3 cup (55g)", uncertain: false });
  assert.deepEqual(reading.carbs, {
    read: "Total Carbohydrate 37g 13%",
    uncertain: false,
    grams: 37,
  });
  assert.deepEqual(reading.servings, [
    { label: "2/3 cup (55g)", servingSize: 0.667, unit: "cup", carbs: 37 },
    { label: "55 g", servingSize: 55, unit: "g", carbs: 37 },
  ]);
});

test("a g misread as 9 is corrected only as a flagged guess", () => {
  const reading = read(usPanel.map((l) => l.replace("37g", "379").replace("(55g)", "(559)")));
  assert.equal(reading.carbs.grams, 37);
  assert.equal(reading.carbs.uncertain, true);
  assert.equal(reading.serving.uncertain, true);
  assert.deepEqual(
    reading.servings.map((s) => [s.servingSize, s.unit]),
    [
      [0.667, "cup"],
      [55, "g"],
    ],
  );
});

test("carbs heavier than the serving are flagged", () => {
  const reading = read(["Serving size 1 bar (40g)", "Total Carbohydrate 45g 16%"]);
  assert.equal(reading.carbs.grams, 45);
  assert.equal(reading.carbs.uncertain, true);
});

test("a hard-to-read line is flagged even when it parses", () => {
  const reading = read([
    { text: "Serving size 1 cup (240mL)", confidence: 95 },
    { text: "Total Carb. 26g 9%", confidence: 48 },
  ]);
  assert.equal(reading.serving.uncertain, false);
  assert.deepEqual(reading.carbs, { read: "Total Carb. 26g 9%", uncertain: true, grams: 26 });
  assert.deepEqual(reading.servings[1], {
    label: "240 ml",
    servingSize: 240,
    unit: "ml",
    carbs: 26,
  });
});

test("less than 1 g is left for the user rather than turned into a number", () => {
  const reading = read(["Serving size 1 tbsp (15mL)", "Total Carbohydrate <1g 0%"]);
  assert.equal(reading.carbs.grams, null);
  assert.equal(reading.carbs.uncertain, true);
  assert.deepEqual(reading.servings, []);
});

test("a serving size printed below its heading is still read", () => {
  const reading = read(["Serving size", "About 2 cookies (30g)", "Total Carbohydrates 21g"]);
  assert.deepEqual(reading.servings[0], {
    label: "About 2 cookies (30g)",
    servingSize: 2,
    unit: "cookies",
    carbs: 21,
  });
});

test("an EU panel gives carbs per 100 g, and per portion from the column heading", () => {
  const reading = read([
    "Nutrition",
    "Typical values Per 100g Per 30g serving",
    "Energy 1580kJ 474kJ",
    "Fat 2.1g 0.6g",
    "Carbohydrate 67g 20g",
    "of which sugars 5g 1.5g",
  ]);
  assert.equal(reading.serving, null);
  assert.deepEqual(reading.servings, [
    { label: "100 g", servingSize: 100, unit: "g", carbs: 67 },
    { label: "30 g", servingSize: 30, unit: "g", carbs: 20 },
  ]);
});

test("a photo with no carbohydrate line offers nothing to fill in", () => {
  const reading = read(["Ingredients: oats, sugar", "Serving size 1 cup (40g)"]);
  assert.equal(reading.carbs, null);
  assert.deepEqual(reading.servings, []);
});

test("a per-100 heading split up by the reader is still recognised", () => {
  // Real reader output for a UK panel: "Per 100g Per 30g serving" came back as "100g Per".
  const reading = read([
    "Nutrition",
    "100g Per",
    "1580kJ 474kJ",
    "Carbohydrate 67g 20g",
    "of which 5.0g 1.59",
  ]);
  assert.deepEqual(reading.servings, [{ label: "100 g", servingSize: 100, unit: "g", carbs: 67 }]);
});

test("carbs without a serving or heading are read but tied to no amount of food", () => {
  const reading = read(["Nutrition", "Carbohydrate 67g 20g"]);
  assert.equal(reading.carbs.grams, 67);
  assert.deepEqual(reading.servings, []);
});
