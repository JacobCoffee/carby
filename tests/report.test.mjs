import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  readingsNearFood,
  foodEntriesForMeal,
  reportRangeIsValid,
  mealRatioAt,
} from "../lib/report-analysis.ts";

const at = (time) => `2026-09-24T${time}:00.000Z`;
const manual = (time, value) => ({ kind: "glucose", at: at(time), glucose: value });
const sensor = (time, value, status = null) => ({
  at: at(time),
  value,
  status,
  source: "Dexcom Clarity",
});

test("an explicitly logged 4:37 p.m. meal may show the later 4:51 p.m. reading as after food", () => {
  const observations = readingsNearFood(
    at("21:37"),
    [manual("21:51", 324)],
    [sensor("21:28", 340)],
  );
  assert.equal(observations.before, undefined);
  assert.equal(observations.after?.glucose, 324);
  assert.equal(observations.nearBefore?.value, 340);
});

test("pre-food reading takes priority and an old reading is never misrepresented as before food", () => {
  const readings = [manual("19:00", 302), manual("21:15", 330), manual("21:51", 324)];
  const matched = readingsNearFood(at("21:37"), readings, []);
  assert.equal(matched.before?.glucose, 330);
  assert.equal(matched.after, undefined);
  const oldOnly = readingsNearFood(at("21:37"), [readings[0], readings[2]], []);
  assert.equal(oldOnly.before, undefined);
  assert.equal(oldOnly.after?.glucose, 324);
});

test("out-of-range CGM status stays status-only around a meal", () => {
  const matched = readingsNearFood(
    at("21:37"),
    [],
    [sensor("21:25", null, "High"), sensor("21:45", 315)],
  );
  assert.equal(matched.nearBefore?.status, "High");
  assert.equal(matched.nearBefore?.value, null);
  assert.equal(matched.nearAfter, undefined);
});

test("explicit dinner at 4:37 p.m. belongs only to its logged day; legacy Meal uses the clock window", () => {
  const dinner = { kind: "food", meal: "Dinner", carbs: 54, at: at("21:37") };
  const priorDinner = { ...dinner, at: "2026-09-23T21:30:00.000Z" };
  const legacyMeal = { ...dinner, meal: "Meal" };
  const records = [dinner, priorDinner, legacyMeal];
  assert.deepEqual(foodEntriesForMeal("2026-09-24", "Dinner", records, "America/Chicago"), [
    dinner,
  ]);
  assert.deepEqual(foodEntriesForMeal("2026-09-23", "Dinner", records, "America/Chicago"), [
    priorDinner,
  ]);
});

test("report range stays inside loaded history and includes at most 30 calendar days", () => {
  const earliest = "2026-08-11",
    today = "2026-09-24";
  assert.equal(reportRangeIsValid("2026-08-11", "2026-08-11", earliest, today), true);
  assert.equal(reportRangeIsValid("2026-08-11", "2026-09-09", earliest, today), true);
  assert.equal(reportRangeIsValid("2026-08-11", "2026-09-10", earliest, today), false);
  assert.equal(reportRangeIsValid("2026-08-10", "2026-08-15", earliest, today), false);
  assert.equal(reportRangeIsValid("2026-09-24", "2026-09-25", earliest, today), false);
});

test("meal picker uses half-open local slots with snack in the gaps", () => {
  for (const [time, expected] of [
    ["05:59", "snack"],
    ["06:00", "breakfast"],
    ["09:59", "breakfast"],
    ["10:00", "snack"],
    ["11:00", "lunch"],
    ["15:00", "snack"],
    ["17:00", "dinner"],
    ["21:00", "snack"],
  ]) {
    assert.equal(mealRatioAt(new Date(at(time)), "UTC"), expected, time);
  }
});

test("meal picker uses the plan timezone across daylight saving changes", () => {
  assert.equal(mealRatioAt(new Date("2026-09-25T23:00:00Z"), "America/Chicago"), "dinner");
  assert.equal(mealRatioAt(new Date("2026-01-25T12:00:00Z"), "America/Chicago"), "breakfast");
  assert.equal(mealRatioAt(new Date("2026-09-25T11:00:00Z"), "America/Chicago"), "breakfast");
});
