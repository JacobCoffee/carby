import { test } from "bun:test";
import assert from "node:assert/strict";
import { entrySchema } from "../lib/care.ts";
import { chartDayWindow, chartDaysWindow } from "../lib/chart-window.ts";
import { preserveEntryContext, sameEntry } from "../lib/entry-integrity.ts";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  at: "2026-09-22T20:00:00.000Z",
  glucose: null,
  source: null,
  ketones: null,
  carbs: null,
  units: null,
  insulin: null,
  meal: null,
  note: "",
};
test("editing a food note keeps itemization and changing a total does not reuse incorrect portions", () => {
  const previous = {
    ...base,
    kind: "food",
    carbs: 10,
    meal: "Snack",
    foodItems: [{ name: "Example snack", carbs: 10, amount: 2, unit: "pieces" }],
  };
  assert.deepEqual(
    preserveEntryContext({ ...previous, foodItems: undefined, note: "Ate slowly" }, previous)
      .foodItems,
    previous.foodItems,
  );
  assert.equal(
    preserveEntryContext({ ...previous, foodItems: undefined, carbs: 12 }, previous).foodItems,
    undefined,
  );
});
test("actual dose edits preserve the original calculation including measured time and rounding", () => {
  const calculation = {
    mode: "Carbs + correction",
    carbs: 25,
    glucose: 200,
    source: "Finger-stick",
    measuredAt: "2026-09-22T19:55:00.000Z",
    foodDescription: "Example snack",
    foodEntryIds: [],
    calculatedUnits: 1,
    target: 140,
    factor: 80,
    ratio: 40,
    increment: 0.5,
    rounding: "down",
  };
  const previous = entrySchema.parse({
    ...base,
    kind: "insulin",
    insulin: "Rapid-acting",
    units: 1,
    calculation,
  });
  const edited = entrySchema.parse(
    preserveEntryContext(
      { ...previous, calculation: undefined, units: 0.5, note: "Corrected actual amount" },
      previous,
    ),
  );
  assert.deepEqual(edited.calculation, calculation);
  assert.equal(edited.units, 0.5);
  assert.equal(
    preserveEntryContext({ ...previous, calculation: undefined, insulin: "Long-acting" }, previous)
      .calculation,
    undefined,
  );
});
test("retry identity ignores revision and key order but never treats a different administered dose as replay", () => {
  const first = { ...base, kind: "insulin", insulin: "Rapid-acting", units: 1 };
  const reordered = Object.fromEntries(Object.entries(first).reverse());
  assert.equal(sameEntry({ ...first, revision: "old" }, { ...reordered, revision: "new" }), true);
  assert.equal(sameEntry(first, { ...first, units: 2 }), false);
  assert.equal(sameEntry(first, { ...first, at: "2026-09-22T20:10:00.000Z" }), false);
});

test("chart bounds preserve the 23-hour and 25-hour local days", () => {
  const spring = chartDayWindow("2026-03-08", "America/Chicago");
  const fall = chartDayWindow("2026-11-01", "America/Chicago");
  assert.equal((spring.end - spring.start) / 3600000, 23);
  assert.equal((fall.end - fall.start) / 3600000, 25);
  assert.equal(
    Date.parse("2026-11-01T07:30:00Z") -
      fall.start -
      (Date.parse("2026-11-01T06:30:00Z") - fall.start),
    3600000,
  );
});

test("multi-day chart periods end at the next local midnight across DST, year and leap-day edges", () => {
  const spring = chartDaysWindow("2026-03-09", 3, "America/Chicago");
  assert.equal(spring.start, Date.parse("2026-03-07T06:00:00Z"));
  assert.equal(spring.end, Date.parse("2026-03-10T05:00:00Z"));
  assert.equal((spring.end - spring.start) / 3600000, 71);
  assert.deepEqual(
    spring.days.map((d) => new Date(d.start).toISOString()),
    ["2026-03-07T06:00:00.000Z", "2026-03-08T06:00:00.000Z", "2026-03-09T05:00:00.000Z"],
  );
  const newYear = chartDaysWindow("2027-01-02", 7, "America/Chicago");
  assert.equal(newYear.days[0].day, "2026-12-27");
  assert.equal(newYear.days.length, 7);
  assert.deepEqual(
    chartDaysWindow("2028-03-01", 3, "America/Chicago").days.map((d) => d.day),
    ["2028-02-28", "2028-02-29", "2028-03-01"],
  );
  const autumn = chartDaysWindow("2026-11-15", 30, "America/Chicago");
  assert.equal(autumn.days[0].day, "2026-10-17");
  assert.equal((autumn.end - autumn.start) / 3600000, 30 * 24 + 1);
});
