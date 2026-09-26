import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildPatternFlags, patternFlagLabel } from "../lib/patterns.ts";

const TZ = "America/Chicago";
// 2027-01-10..16 is deep winter (standard time throughout) for boundary/count tests.
const NOW = Date.parse("2027-01-16T23:30:00-06:00");
const PLAN = { lowThreshold: 70, patternRule: { highDays: 3, lowDays: 2 } };

function iso(day, hour, minute, offset) {
  return new Date(
    `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offset}`,
  ).toISOString();
}
function fingerstick(day, hour, minute, glucose, status = null, offset = "-06:00") {
  return {
    kind: "glucose",
    at: iso(day, hour, minute, offset),
    glucose,
    status,
    source: "Finger-stick",
  };
}
function breakfastReadings(days, value, status = null) {
  return days.map((day) => fingerstick(day, 7, 0, value, status));
}
function flagsFor(entries, plan = PLAN, lookbackDays = 7) {
  return buildPatternFlags({ entries, cgm: [], timezone: TZ, now: NOW, lookbackDays, plan });
}

test("180 mg/dL is not a high reading but 181 mg/dL is (three Breakfast days in a row)", () => {
  const days = ["2027-01-14", "2027-01-15", "2027-01-16"];
  assert.equal(
    flagsFor(breakfastReadings(days, 180)).find((f) => f.kind === "high" && f.slot === "Breakfast"),
    undefined,
  );
  const flag = flagsFor(breakfastReadings(days, 181)).find(
    (f) => f.kind === "high" && f.slot === "Breakfast",
  );
  assert.ok(flag);
  assert.deepEqual(flag.days, days);
  assert.deepEqual(flag.sickDays, []);
});

test("70 mg/dL is not a low reading but 69 mg/dL is (two Breakfast days in a row)", () => {
  const days = ["2027-01-15", "2027-01-16"];
  assert.equal(
    flagsFor(breakfastReadings(days, 70)).find((f) => f.kind === "low" && f.slot === "Breakfast"),
    undefined,
  );
  const flag = flagsFor(breakfastReadings(days, 69)).find(
    (f) => f.kind === "low" && f.slot === "Breakfast",
  );
  assert.ok(flag);
  assert.deepEqual(flag.days, days);
});

test("a pattern requires the full patternRule count of days; one short of the threshold never triggers", () => {
  const twoHighDays = ["2027-01-15", "2027-01-16"];
  assert.equal(
    flagsFor(breakfastReadings(twoHighDays, 220)).find(
      (f) => f.kind === "high" && f.slot === "Breakfast",
    ),
    undefined,
  );
  const oneLowDay = ["2027-01-16"];
  assert.equal(
    flagsFor(breakfastReadings(oneLowDay, 50)).find(
      (f) => f.kind === "low" && f.slot === "Breakfast",
    ),
    undefined,
  );
});

test("a non-consecutive day never extends a run, even when the total count reaches the threshold", () => {
  const entries = [
    ...breakfastReadings(["2027-01-12"], 220),
    // 01-13 normal, breaking the run.
    ...breakfastReadings(["2027-01-13"], 120),
    ...breakfastReadings(["2027-01-14", "2027-01-15", "2027-01-16"], 220),
  ];
  const flag = flagsFor(entries).find((f) => f.kind === "high" && f.slot === "Breakfast");
  assert.ok(flag);
  assert.deepEqual(flag.days, ["2027-01-14", "2027-01-15", "2027-01-16"]);
});

test("sick days count toward a run and are named in the flag", () => {
  const entries = [
    ...breakfastReadings(["2027-01-14"], 220),
    ...breakfastReadings(["2027-01-15", "2027-01-16"], 220), // sick days, also high
  ];
  const illnesses = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      startDate: "2027-01-15",
      endDate: "2027-01-16",
      timezone: TZ,
      note: "",
    },
  ];
  const flag = buildPatternFlags({
    entries,
    cgm: [],
    timezone: TZ,
    illnesses,
    now: NOW,
    lookbackDays: 7,
    plan: PLAN,
  }).find((f) => f.kind === "high" && f.slot === "Breakfast");
  assert.ok(flag);
  assert.deepEqual(flag.days, ["2027-01-14", "2027-01-15", "2027-01-16"]);
  assert.deepEqual(flag.sickDays, ["2027-01-15", "2027-01-16"]);
  assert.match(patternFlagLabel(flag), /on 3 days in a row .*, 2 during illness\.$/);
});

test("a meter HI/LO status counts without a numeric value", () => {
  const highStatus = breakfastReadings(["2027-01-14", "2027-01-15", "2027-01-16"], null, "High");
  const flag = flagsFor(highStatus).find((f) => f.kind === "high" && f.slot === "Breakfast");
  assert.ok(flag);
  const lowStatus = breakfastReadings(["2027-01-15", "2027-01-16"], null, "Low");
  const lowFlag = flagsFor(lowStatus).find((f) => f.kind === "low" && f.slot === "Breakfast");
  assert.ok(lowFlag);
});

test("a day with no logbook cell for the slot never counts toward a run", () => {
  // Lunch readings only; Breakfast has no data on any day, so no Breakfast flag ever fires.
  const entries = ["2027-01-14", "2027-01-15", "2027-01-16"].map((day) =>
    fingerstick(day, 12, 0, 220),
  );
  assert.equal(
    flagsFor(entries).find((f) => f.slot === "Breakfast"),
    undefined,
  );
  assert.ok(flagsFor(entries).find((f) => f.kind === "high" && f.slot === "Lunch"));
});

test("lows are reported ahead of highs in the flag list", () => {
  const entries = [
    ...breakfastReadings(["2027-01-15", "2027-01-16"], 50),
    ...["2027-01-14", "2027-01-15", "2027-01-16"].map((day) => fingerstick(day, 12, 0, 220)),
  ];
  const flags = flagsFor(entries);
  const lowIndex = flags.findIndex((f) => f.kind === "low");
  const highIndex = flags.findIndex((f) => f.kind === "high");
  assert.ok(lowIndex >= 0 && highIndex >= 0 && lowIndex < highIndex);
});

test("patternFlagLabel renders descriptive, non-dosing copy", () => {
  const flag = {
    kind: "high",
    slot: "Bedtime",
    days: ["2027-01-14", "2027-01-15"],
    sickDays: [],
    lookbackDays: 7,
  };
  assert.equal(patternFlagLabel(flag), "Highs at Bedtime on 2 days in a row (Jan 14, Jan 15).");
  assert.match(
    patternFlagLabel({ ...flag, sickDays: flag.days }),
    /\(Jan 14, Jan 15\), all during illness\.$/,
  );
});
