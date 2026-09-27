import { test } from "bun:test";
import assert from "node:assert/strict";
import { doseResponses, doseTiming } from "../lib/dose-response.ts";
import { mealResponses, mealsWithoutInsulin } from "../lib/meal-response.ts";

const base = Date.parse("2026-09-20T12:00:00Z");
const at = (minute) => new Date(base + minute * 60000).toISOString();
const later = base + 30 * 86400000;
let ids = 0;
const id = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

const entry = (minute, fields) => ({
  id: id(),
  at: at(minute),
  glucose: null,
  source: null,
  ketones: null,
  carbs: null,
  units: null,
  insulin: null,
  meal: null,
  note: "",
  ...fields,
});
const dose = (minute, units, insulin = "Rapid-acting") =>
  entry(minute, { kind: "insulin", units, insulin, purpose: "Correction only" });
const food = (minute, carbs, meal = "Snack") => entry(minute, { kind: "food", carbs, meal });
/** Five-minute CGM from `from` to `to` minutes after the dose, from a function of the minute. */
const cgm = (valueAt, from = -10, to = 180, offset = 0) =>
  Array.from({ length: (to - from) / 5 + 1 }, (_, i) => {
    const minute = from + i * 5 + offset;
    const value = valueAt(minute);
    return {
      at: at(minute),
      value: typeof value === "number" ? value : null,
      status: typeof value === "string" ? value : null,
      source: "Dexcom Share",
    };
  });
/** Flat at 300 for 20 minutes, falls 2 a minute until 90, fastest (4 a minute) from 40 to 55. */
const fall = (m) =>
  m <= 20
    ? 300
    : m <= 40
      ? 300 - 2 * (m - 20)
      : m <= 55
        ? 260 - 4 * (m - 40)
        : Math.max(200 - 2 * (m - 55), 150);

test("a dose with nothing else nearby reports its changes, fastest fall and lowest point", () => {
  const [r] = doseResponses([dose(0, 1.5)], cgm(fall), later);
  assert.equal(r.status, "ok");
  assert.equal(r.baseline, 300);
  assert.deepEqual(r.changes, [
    { minutes: 30, change: -20 },
    { minutes: 60, change: -110 },
    { minutes: 90, change: -150 },
    { minutes: 120, change: -150 },
    { minutes: 180, change: -150 },
  ]);
  assert.deepEqual(r.fastestFall, { from: 40, change: -60 });
  assert.equal(r.lowest, 150);
  assert.equal(r.lowestMinutes, 80);
});

test("food, a low treatment or another rapid-acting dose nearby keeps a dose out of comparisons", () => {
  const readings = cgm(fall, -200, 180);
  for (const [other, status] of [
    [food(-45, 20), "food-nearby"],
    [food(150, 15, "Low treatment"), "food-nearby"],
    [dose(-150, 1), "other-insulin"],
    [dose(90, 1), "other-insulin"],
  ]) {
    const target = dose(0, 1.5);
    const r = doseResponses([target, other], readings, later).find((x) => x.entryId === target.id);
    assert.equal(r.status, status, JSON.stringify(other));
  }
  // Food more than an hour before, or a long-acting dose, doesn't count against it.
  const target = dose(0, 1.5);
  const clean = doseResponses(
    [target, food(-75, 30), dose(-30, 7, "Long-acting")],
    readings,
    later,
  );
  assert.equal(clean.find((x) => x.entryId === target.id).status, "ok");
});

test("a dose without a recent reading, with gaps, or still in its window isn't compared", () => {
  assert.equal(doseResponses([dose(0, 1)], cgm(fall, 30), later)[0].status, "no-baseline");
  const gappy = cgm(fall).filter((_, i) => i % 3 === 0);
  assert.equal(doseResponses([dose(0, 1)], gappy, later)[0].status, "sparse");
  assert.equal(doseResponses([dose(0, 1)], cgm(fall), base + 100 * 60000)[0].status, "in-progress");
});

test("a sensor LOW is the lowest point, and a dose that never fell has no fastest fall", () => {
  const [low] = doseResponses(
    [dose(0, 2)],
    cgm((m) => (m >= 120 ? "Low" : fall(m))),
    later,
  );
  assert.equal(low.lowest, "Low");
  assert.equal(low.lowestMinutes, 120);
  const [flat] = doseResponses(
    [dose(0, 1)],
    cgm((m) => 200 + m / 10),
    later,
  );
  assert.equal(flat.fastestFall, null);
});

test("timing needs three comparable doses and gives medians across them", () => {
  const day = 86400000 / 60000;
  const days = [0, 1, 2].map((d) => d * day);
  const readings = days.flatMap((start, d) =>
    cgm((m) => fall(m - start - 5 * d), start - 10, start + 180),
  );
  const three = doseResponses(
    days.map((start) => dose(start, 1.5)),
    readings,
    later,
  );
  assert.equal(doseTiming(three.slice(0, 2), "Rapid-acting"), null);
  const timing = doseTiming(three, "Rapid-acting");
  assert.equal(timing.doses, 3);
  assert.equal(timing.fastestFallFrom, 45);
  assert.equal(timing.medianLowestMinutes, 85);
  assert.equal(timing.changes.find((c) => c.minutes === 60).change, -100);
  assert.equal(doseTiming(three, "Long-acting"), null);
});

test("meals without insulin leave out meals with rapid-acting insulin around them", () => {
  const day = 86400000 / 60000;
  const rise = (m) => (m <= 0 ? 120 : m <= 60 ? 120 + m : Math.max(180 - (m - 60), 120));
  const starts = [0, 1, 2, 3].map((d) => d * day);
  const readings = starts.flatMap((start) => cgm((m) => rise(m - start), start - 10, start + 180));
  const entries = [
    ...starts.map((start, i) => food(start, 20 + i * 10, "Snack")),
    dose(starts[3] - 10, 2),
  ];
  const summary = mealsWithoutInsulin(mealResponses(entries, readings, later));
  assert.equal(summary.meals, 3);
  assert.equal(summary.medianCarbs, 30);
  assert.equal(summary.medianRise, 60);
  assert.equal(summary.medianPeakMinutes, 60);
  assert.equal(mealsWithoutInsulin(mealResponses(entries.slice(0, 2), readings, later)), null);
});
