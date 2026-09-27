import { test } from "bun:test";
import assert from "node:assert/strict";
import { foodDosePrompt } from "../lib/food-dose-prompt.ts";

// Synthetic entries; the 21 g cutoff stands in for a value from a care plan.
const now = Date.parse("2026-09-27T14:40:00Z");
const food = (carbs, extra = {}) => ({
  id: "0b5a3f8e-9f5a-4b8e-8a7f-1c2d3e4f5a6b",
  at: new Date(now - 5 * 60000).toISOString(),
  kind: "food",
  carbs,
  meal: "Snack",
  note: "",
  ...extra,
});
const plan = { snackInsulinFromCarbs: 21 };
const ask = (entry, o = {}) => foodDosePrompt({ entry, plan, now, aboveRange: false, ...o });

test("a food at or over the plan's snack cutoff points at the calculator", () => {
  assert.deepEqual(ask(food(42)), {
    entryId: food(42).id,
    at: food(42).at,
    carbs: 42,
    cutoff: 21,
    ratioMeal: "snack",
    mode: "Carbs",
  });
  // The entry's food type picks the ratio; "Meal" leaves it to the time of day.
  assert.equal(ask(food(42, { meal: "Afternoon snack" }))?.ratioMeal, "snack");
  assert.equal(ask(food(42, { meal: "Lunch" }))?.ratioMeal, "lunch");
  assert.equal(ask(food(42, { meal: "Meal" }))?.ratioMeal, null);
  // The plan gives no insulin under the cutoff, so the cutoff itself counts.
  assert.equal(ask(food(21))?.carbs, 21);
  assert.equal(ask(food(20.9)), null);
});

test("an above-range reading opens carbs plus correction", () => {
  assert.equal(ask(food(42), { aboveRange: true })?.mode, "Carbs + correction");
});

test("no cutoff in the plan, a low treatment, a past record, or non-food never prompts", () => {
  assert.equal(foodDosePrompt({ entry: food(42), plan: {}, now, aboveRange: true }), null);
  assert.equal(ask(food(42, { meal: "Low treatment" })), null);
  assert.equal(ask(food(42, { at: new Date(now - 61 * 60000).toISOString() })), null);
  assert.equal(ask({ ...food(42), kind: "insulin", carbs: null }), null);
  assert.equal(ask(food(null)), null);
});
