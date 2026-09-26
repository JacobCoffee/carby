import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  currentDoseOverride,
  doseAmount,
  doseAdjustment,
  stepDose,
} from "../lib/dose-adjustment.ts";
import { entrySchema } from "../lib/care.ts";
import { preserveEntryContext } from "../lib/entry-integrity.ts";

test("half-unit controls adjust manual amounts within valid bounds", () => {
  assert.equal(stepDose("3", -1, 0.5), "2.5");
  assert.equal(stepDose("2.5", 1, 0.5), "3");
  assert.equal(stepDose("0.2", -1, 0.5), "0");
  assert.equal(stepDose("100", 1, 0.5), "100");
  assert.equal(stepDose("", 1, 0.5), "");
  assert.equal(stepDose("2", 1, 1), "3");
  for (const value of ["", " ", "NaN", "Infinity", "-0.5", "101"])
    assert.equal(doseAmount(value), null);
});

test("an adjustment is cleared when its inputs change even if the formula total is unchanged", () => {
  const override = {
    context: "reading-1",
    units: "2.5",
    reason: "Care instructions",
    acknowledgedAt: "2026-09-25T17:00:00.000Z",
  };
  assert.equal(currentDoseOverride(override, "reading-1"), override);
  assert.equal(currentDoseOverride(override, "reading-2"), null);
  assert.equal(currentDoseOverride(null, "reading-1"), null);
});

test("save uses the final actual amount and requires acknowledgement for a different amount", () => {
  const at = "2026-09-25T17:00:00.000Z";
  assert.deepEqual(doseAdjustment(3, "2", at, "  Care instructions  "), {
    actualUnits: 2,
    acknowledgedAt: at,
    reason: "Care instructions",
  });
  assert.throws(() => doseAdjustment(3, "2.5", null, ""), /Acknowledge/);
  assert.throws(() => doseAdjustment(3, "0", at, ""), /positive/);
  assert.equal(doseAdjustment(3, "3", null, "Earlier adjustment"), undefined);
});

test("an adjusted dose retains formula, acknowledgement, and reason through validation and later edits", () => {
  const calculation = {
    mode: "Correction",
    carbs: 0,
    glucose: 450,
    source: "Finger-stick",
    foodEntryIds: [],
    calculatedUnits: 3,
    target: 140,
    factor: 80,
    ratio: 40,
    adjustment: doseAdjustment(3, "2.5", "2026-09-25T17:00:00.000Z", "Care instructions"),
  };
  const entry = entrySchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    kind: "insulin",
    at: "2026-09-25T17:00:00.000Z",
    glucose: null,
    source: null,
    ketones: null,
    carbs: null,
    units: 2.5,
    insulin: "Rapid-acting",
    purpose: "Correction only",
    meal: null,
    note: "",
    calculation,
  });
  assert.equal(entry.units, 2.5);
  assert.deepEqual(entry.calculation, calculation);
  const edited = preserveEntryContext(
    { ...entry, units: 2, note: "Corrected actual amount", calculation: undefined },
    entry,
  );
  assert.equal(edited.units, 2);
  assert.deepEqual(edited.calculation, calculation);
});
