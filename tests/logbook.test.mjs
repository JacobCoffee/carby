import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildLogbook, logbookCallIn, logbookCellLabel } from "../lib/logbook.ts";

const TZ = "UTC";
const now = Date.parse("2027-01-16T23:00:00Z");
const finger = (at, glucose, status = null) => ({
  kind: "glucose",
  source: "Finger-stick",
  glucose,
  status,
  at,
});
const food = (at, meal, carbs) => ({ kind: "food", meal, carbs, at });
const dose = (at, units) => ({ kind: "insulin", insulin: "Rapid-acting", units, at });
const cgm = (at, value, status = null) => ({ at, value, status, source: "Dexcom Share" });

function logbookFor(day, entries, cgmReadings = [], illnesses = []) {
  return buildLogbook({
    days: [day],
    entries,
    cgm: cgmReadings,
    timezone: TZ,
    illnesses,
    now,
  })[0];
}

test("a finger-stick logged in the slot window wins over any nearby CGM", () => {
  const day = logbookFor("2027-01-14", [
    finger("2027-01-14T07:30:00Z", 140),
    cgm("2027-01-14T07:00:00Z", 120),
  ]);
  assert.equal(day.cells.Breakfast.value, 140);
  assert.equal(day.cells.Breakfast.source, "Finger-stick");
});

test("with no finger-stick, the nearest CGM reading before the first logged food is used", () => {
  const day = logbookFor(
    "2027-01-14",
    [food("2027-01-14T07:20:00Z", "Breakfast", 40)],
    [
      cgm("2027-01-14T07:10:00Z", 130),
      cgm("2027-01-14T07:00:00Z", 125),
      cgm("2027-01-14T07:25:00Z", 200),
    ],
  );
  assert.equal(day.cells.Breakfast.value, 130);
  assert.equal(day.cells.Breakfast.source, "CGM");
  assert.equal(day.cells.Breakfast.carbs, 40);
});

test("a slot with neither a finger-stick nor a logged food/dose has no cell", () => {
  const day = logbookFor("2027-01-14", []);
  assert.equal(day.cells.Breakfast, null);
  assert.equal(day.cells.Bedtime, null);
});

test("a CGM reading after the anchor food is never used, and a slot with only a later reading is empty", () => {
  const day = logbookFor(
    "2027-01-14",
    [food("2027-01-14T07:20:00Z", "Breakfast", 40)],
    [cgm("2027-01-14T07:30:00Z", 130)],
  );
  assert.equal(day.cells.Breakfast, null);
});

test("Bedtime uses a rapid-acting dose as its anchor when there is no finger-stick", () => {
  const day = logbookFor(
    "2027-01-14",
    [dose("2027-01-14T21:10:00Z", 2)],
    [cgm("2027-01-14T21:00:00Z", 160)],
  );
  assert.equal(day.cells.Bedtime.value, 160);
  assert.equal(day.cells.Bedtime.units, 2);
});

test("a meter HI/LO finger-stick keeps its status without inventing a numeric value", () => {
  const day = logbookFor("2027-01-14", [finger("2027-01-14T07:30:00Z", null, "High")]);
  assert.equal(day.cells.Breakfast.value, null);
  assert.equal(day.cells.Breakfast.status, "High");
});

test("a sick day is marked sick; a non-illness context period is listed separately and never marks sick", () => {
  const illnessWindow = {
    id: "11111111-1111-1111-1111-111111111111",
    startDate: "2027-01-14",
    endDate: "2027-01-14",
    timezone: TZ,
    note: "",
  };
  const sickDay = logbookFor("2027-01-14", [], [], [illnessWindow]);
  assert.equal(sickDay.sick, true);
  assert.deepEqual(sickDay.periods, []);

  const stressWindow = {
    ...illnessWindow,
    id: "22222222-2222-2222-2222-222222222222",
    kind: "stress",
  };
  const contextDay = logbookFor("2027-01-14", [], [], [stressWindow]);
  assert.equal(contextDay.sick, false);
  assert.deepEqual(contextDay.periods, ["stress"]);
});

test("logbookCellLabel and logbookCallIn render HI/LO with meter thresholds when set", () => {
  const cell = { at: "2027-01-14T07:30:00Z", value: null, status: "Low", source: "Finger-stick" };
  assert.equal(logbookCellLabel(cell, {}), "LO");
  assert.equal(logbookCellLabel(cell, { meter: { hi: 600, lo: 20 } }), "LO (below 20)");
  assert.equal(logbookCellLabel(null, {}), "—");

  const days = [
    {
      day: "2027-01-14",
      sick: false,
      periods: [],
      cells: {
        Breakfast: { at: "2027-01-14T07:30:00Z", value: 143, status: null, source: "Finger-stick" },
        Lunch: { at: "2027-01-14T12:00:00Z", value: 211, status: null, source: "Finger-stick" },
        Dinner: { at: "2027-01-14T18:00:00Z", value: 134, status: null, source: "Finger-stick" },
        Bedtime: { at: "2027-01-14T21:00:00Z", value: 156, status: null, source: "Finger-stick" },
      },
    },
  ];
  assert.equal(
    logbookCallIn(days, {}),
    "Jan 14 — Breakfast 143, Lunch 211, Dinner 134, Bedtime 156",
  );
});
