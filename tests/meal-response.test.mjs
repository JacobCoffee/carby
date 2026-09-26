import { test } from "bun:test";
import assert from "node:assert/strict";
import { foodResponseRanking, mealResponses } from "../lib/meal-response.ts";

const base = Date.parse("2026-09-20T12:00:00Z");
const at = (minute) => new Date(base + minute * 60000).toISOString();
const later = base + 30 * 86400000;
let ids = 0;
const id = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

function meal(minute, carbs, foods = ["Toast"], extra = {}) {
  return {
    id: id(),
    kind: "food",
    at: at(minute),
    glucose: null,
    source: null,
    ketones: null,
    carbs,
    units: null,
    insulin: null,
    meal: "Breakfast",
    note: "",
    foodItems: foods.map((name) => ({
      name,
      carbs: carbs / foods.length,
      amount: 1,
      unit: "slice",
    })),
    ...extra,
  };
}
/** Five-minute CGM from `start` for each value; a string is a "High"/"Low" status. */
const cgm = (values, start = -10) =>
  values.map((v, i) => ({
    at: at(start + i * 5),
    value: typeof v === "number" ? v : null,
    status: typeof v === "string" ? v : null,
    source: "Dexcom Share",
  }));
/** 38 readings from 10 minutes before the meal to three hours after: rise, peak, fall. */
const curve = (baseline, peak) => {
  const up = Array.from({ length: 13 }, (_, i) =>
    Math.round(baseline + ((peak - baseline) * i) / 12),
  );
  const down = Array.from({ length: 23 }, (_, i) =>
    Math.round(peak - ((peak - baseline) * (i + 1)) / 23),
  );
  return [baseline, baseline, ...up, ...down];
};

test("a clean meal reports baseline, peak, rise, time to peak and return to baseline", () => {
  const [r] = mealResponses([meal(0, 45)], cgm(curve(110, 230)), later);
  assert.equal(r.status, "ok");
  assert.equal(r.baseline, 110);
  assert.equal(r.peak, 230);
  assert.equal(r.rise, 120);
  assert.equal(r.peakMinutes, 60);
  // Back within 20 of 110 (130 or below) when the fall passes 130.
  assert.equal(r.returnMinutes, 160);
  // The last reading is at 175 minutes, so the final five minutes are unobserved.
  assert.equal(r.coveragePercent, 97);
  assert.deepEqual(r.foods, ["Toast"]);
});

test("a peak past the sensor limit is a lower-bound rise", () => {
  const values = curve(150, 380).map((v) => (v > 360 ? "High" : v));
  const [r] = mealResponses([meal(0, 60)], cgm(values), later);
  assert.equal(r.peak, "High");
  assert.equal(r.riseCapped, true);
  assert.equal(r.rise, 250);
});

test("responses that can't be compared say why", () => {
  const readings = cgm(curve(110, 200));
  const status = (entries, points = readings, now = later) =>
    mealResponses(entries, points, now).map((r) => r.status);
  assert.deepEqual(status([meal(0, 30)], readings, base + 60 * 60000), ["in-progress"]);
  assert.deepEqual(status([meal(0, 30)], readings.slice(4)), ["no-baseline"]);
  assert.deepEqual(
    status(
      [meal(0, 30)],
      readings.filter((_, i) => i < 10 || i > 25),
    ),
    ["sparse"],
  );
  // Newest first: the later meal runs past the data (sparse), the earlier one overlaps it.
  assert.deepEqual(status([meal(0, 30), meal(60, 15, ["Cookie"])]), ["sparse", "overlapping"]);
  // A low treatment is not a meal of its own, but it still blurs the meal it follows.
  const lowTreatment = meal(90, 15, ["Juice"], { meal: "Low treatment" });
  assert.deepEqual(status([meal(0, 30), lowTreatment]), ["overlapping"]);
});

test("foods rank by median rise, only with three comparable meals", () => {
  const day = 1440;
  const entries = [],
    points = [];
  const add = (dayIndex, foods, peak) => {
    entries.push(meal(dayIndex * day, 40, foods));
    points.push(...cgm(curve(110, peak), dayIndex * day - 10));
  };
  add(0, ["Pasta", "Milk"], 260);
  add(1, ["Pasta"], 270);
  add(2, ["Pasta", "Milk"], 280);
  add(3, ["Eggs", "Milk"], 150);
  add(4, ["Eggs"], 140);
  const ranking = foodResponseRanking(mealResponses(entries, points, later));
  assert.deepEqual(
    ranking.map(({ name, meals, medianRise }) => ({ name, meals, medianRise })),
    [
      { name: "Pasta", meals: 3, medianRise: 160 },
      { name: "Milk", meals: 3, medianRise: 150 },
    ],
  );
});
