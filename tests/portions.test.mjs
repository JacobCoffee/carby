import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  amountEaten,
  amountInServingUnits,
  parseFoodBasis,
  parsePortion,
  volumeMl,
} from "../lib/portions.ts";

test("parsePortion reads vulgar fractions, mixed fractions, decimals, and slash fractions", () => {
  assert.equal(parsePortion("½"), 0.5);
  assert.equal(parsePortion("⅓"), 1 / 3);
  assert.equal(parsePortion("2/3"), 2 / 3);
  assert.equal(parsePortion("1 1/4"), 1.25);
  assert.equal(parsePortion("1¼"), 1.25);
  assert.equal(parsePortion("1"), 1);
  assert.equal(parsePortion("2.5"), 2.5);
  assert.equal(parsePortion("  1 "), 1);
});

test("parsePortion rejects malformed or empty input", () => {
  for (const bad of ["", " ", "abc", "1/0", "1//2", "-1", "1.2.3", "1 2/3/4"])
    assert.ok(Number.isNaN(parsePortion(bad)), `expected NaN for ${JSON.stringify(bad)}`);
});

test("amountInServingUnits scales a fractional serving count by the serving size", () => {
  const food = { servings: "1¼", servingSize: "2", unit: "slice", byServing: true };
  assert.equal(amountInServingUnits(food), 2.5);
});

test("amountInServingUnits converts a typed amount between volume units", () => {
  const cupToMl = {
    servings: "1",
    servingSize: "240",
    unit: "ml",
    amountUnit: "cup",
    byServing: false,
  };
  assert.equal(amountInServingUnits(cupToMl), volumeMl.cup);

  const tbspToCup = {
    servings: "16",
    servingSize: "1",
    unit: "cup",
    amountUnit: "tbsp",
    byServing: false,
  };
  assert.equal(amountInServingUnits(tbspToCup), 1);

  const mlToTbsp = {
    servings: "45",
    servingSize: "1",
    unit: "tbsp",
    amountUnit: "ml",
    byServing: false,
  };
  assert.equal(amountInServingUnits(mlToTbsp), 3);
});

test("amountInServingUnits leaves an unconvertible unit pair as a raw amount", () => {
  const food = { servings: "3", servingSize: "1", unit: "slice", amountUnit: "slice" };
  assert.equal(amountInServingUnits(food), 3);
});

test("amountEaten keeps a typed amount in the unit it was typed in", () => {
  // 16 tbsp of a food labeled per cup is a whole cup's carbs, recorded as 16 tbsp, not 1 tbsp.
  const tbsp = { servings: "16", servingSize: "1", unit: "cup", amountUnit: "tbsp" };
  assert.equal(amountEaten({ ...tbsp, byServing: false }), 16);
  assert.equal(amountInServingUnits({ ...tbsp, byServing: false }), 1);
  // Servings are recorded as an amount of the food's own unit.
  assert.equal(
    amountEaten({ servings: "2/3", servingSize: "37", unit: "g", byServing: true }),
    37 * (2 / 3),
  );
});

test("grams work for a food labeled per cup once the serving's weight is known", () => {
  // Magic Spoon: 15 g carbs per 1 cup, which weighs 37 g.
  const cup = { servingSize: "1", unit: "cup", amountUnit: "g", byServing: false };
  assert.equal(amountInServingUnits({ ...cup, servings: "37", servingGrams: 37 }), 1);
  assert.equal(amountInServingUnits({ ...cup, servings: "18.5", servingGrams: 37 }), 0.5);
  // Without the weight, grams can't be turned into cups.
  assert.equal(amountInServingUnits({ ...cup, servings: "37" }), 37);
  // Servings still count servings.
  assert.equal(
    amountInServingUnits({ ...cup, servings: "2/3", servingGrams: 37, byServing: true }),
    2 / 3,
  );
});

test("parseFoodBasis keeps an optional serving weight only for a serving not already in grams", () => {
  const cereal = { name: "Cereal", carbs: "15", servingSize: "1", unit: "cup" };
  assert.equal(parseFoodBasis({ ...cereal, grams: "37" }).grams, 37);
  assert.equal("grams" in parseFoodBasis({ ...cereal, grams: " " }), false);
  assert.equal("grams" in parseFoodBasis({ ...cereal, unit: "g", grams: "37" }), false);
  for (const bad of ["0", "-1", "1001", "abc"])
    assert.equal(parseFoodBasis({ ...cereal, grams: bad }), null, bad);
});

test("parseFoodBasis reads a food label and never turns a blank into a number", () => {
  assert.deepEqual(
    parseFoodBasis({ name: " Cinnamon bread ", carbs: "21", servingSize: "1", unit: " slice " }),
    { name: "Cinnamon bread", carbs: 21, servingSize: 1, unit: "slice" },
  );
  const food = { name: "Bread", carbs: "21", servingSize: "1", unit: "slice" };
  for (const [field, value] of [
    ["carbs", ""],
    ["carbs", "1001"],
    ["carbs", "-1"],
    ["servingSize", ""],
    ["servingSize", "0"],
    ["unit", " "],
    ["name", ""],
  ])
    assert.equal(
      parseFoodBasis({ ...food, [field]: value }),
      null,
      `${field}=${JSON.stringify(value)}`,
    );
});
