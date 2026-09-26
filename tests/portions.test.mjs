import { test } from "bun:test";
import assert from "node:assert/strict";
import { parsePortion, amountInServingUnits, volumeMl } from "../lib/portions.ts";

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
