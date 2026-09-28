import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  cgmLabel,
  entryGlucoseLabel,
  logSearchText,
  math,
  meterStatusLabel,
  planDraft,
  planSchema,
} from "../lib/care.ts";
import { summarizeCgm } from "../lib/cgm-metrics.ts";
import {
  factorFromInput,
  formatFactor,
  formatGlucose,
  formatGlucoseRate,
  glucoseFromInput,
  glucoseIn,
  glucoseInputBounds,
  glucoseToMgdl,
  glucoseUnitOf,
  glucoseWithUnit,
  parseGlucose,
} from "../lib/glucose-units.ts";
import { glucoseByDay, glucoseLevelRanges, glucoseMetrics } from "../lib/glucose-metrics.ts";
import { planChanges } from "../lib/plan-sections.ts";
import { planSummary } from "../lib/setup-steps.ts";
import { STANDARD_GLUCOSE_RANGES } from "../lib/care.ts";

const tenths = (from, to) =>
  Array.from({ length: Math.round((to - from) * 10) + 1 }, (_, i) => (from * 10 + i) / 10);

const plan = {
  target: 140,
  factor: 80,
  ratio: 40,
  increment: 0.5,
  rounding: "down",
  basal: 0,
  basalTime: "",
  timezone: "Europe/London",
  correctionHours: 4,
  note: "",
  lowThreshold: 70,
  ketoneCheckAbove: 180,
  patternRule: { highDays: 3, lowDays: 2 },
};

test("mg/dL shows in mmol/L to one decimal on the shared factor, and whole in mg/dL", () => {
  for (const [mgdl, mmol] of [
    [54, "3.0"],
    [70, "3.9"],
    [100, "5.6"],
    // Nightscout, xDrip and AAPS show 6.1 here; the older 18.0182 gave 6.0.
    [109, "6.1"],
    [180, "10.0"],
    [250, "13.9"],
    [400, "22.2"],
  ])
    assert.equal(formatGlucose(mgdl, "mmol/L"), mmol, `${mgdl} mg/dL`);
  assert.equal(glucoseIn(90, "mmol/L"), 5);
  assert.equal(formatGlucose(90, "mmol/L"), "5.0");
  assert.equal(formatGlucose(99.4, "mg/dL"), "99");
  assert.equal(glucoseWithUnit(180, "mmol/L"), "10.0 mmol/L");
  assert.equal(glucoseWithUnit(180, "mg/dL"), "180 mg/dL");
  // Changes in glucose convert the same way, with no offset.
  assert.equal(formatGlucose(-36, "mmol/L"), "-2.0");
  assert.equal(formatGlucoseRate(2, "mmol/L"), "0.11 mmol/L per min");
});

test("every value typed in either unit shows again exactly as typed", () => {
  for (const mmol of tenths(1.2, 55.5))
    assert.equal(glucoseIn(glucoseFromInput(mmol, "mmol/L"), "mmol/L"), mmol);
  for (let mgdl = 20; mgdl <= 1000; mgdl++)
    assert.equal(glucoseIn(glucoseFromInput(mgdl, "mg/dL"), "mg/dL"), mgdl);
  // A value typed past the unit's precision is taken at the precision it shows with.
  assert.equal(glucoseIn(glucoseFromInput(5.46, "mmol/L"), "mmol/L"), 5.5);
  assert.equal(glucoseFromInput(5.5, "mmol/L"), glucoseToMgdl(5.5, "mmol/L"));
  for (const factor of [0.5, 1.7, 2, 2.25, 3.5])
    assert.equal(formatFactor(factorFromInput(factor, "mmol/L"), "mmol/L"), String(factor));
  assert.equal(formatFactor(37.5, "mg/dL"), "37.5");
  assert.ok(Number.isNaN(parseGlucose("", "mmol/L")));
  assert.ok(Number.isNaN(parseGlucose("HI", "mmol/L")));
  assert.equal(parseGlucose(" 5.5 ", "mmol/L"), glucoseFromInput(5.5, "mmol/L"));
});

test("input limits are the stored bounds as each unit can show them", () => {
  assert.deepEqual(glucoseInputBounds(70, 250, "mmol/L"), { min: 3.9, max: 13.8, step: 0.1 });
  assert.deepEqual(glucoseInputBounds(40, 400, "mmol/L"), { min: 2.3, max: 22.2, step: 0.1 });
  assert.deepEqual(glucoseInputBounds(20, 1000, "mg/dL"), { min: 20, max: 1000, step: 1 });
  const { min, max } = glucoseInputBounds(70, 250, "mmol/L");
  assert.ok(planSchema.safeParse({ ...plan, target: glucoseFromInput(min, "mmol/L") }).success);
  assert.ok(planSchema.safeParse({ ...plan, target: glucoseFromInput(max, "mmol/L") }).success);
});

test("meter HI/LO and sensor High/Low stay statuses, with the meter's limits in the unit", () => {
  const mmolPlan = {
    meter: { hi: glucoseFromInput(33.3, "mmol/L"), lo: glucoseFromInput(1.1, "mmol/L") },
    glucoseUnit: "mmol/L",
  };
  assert.equal(meterStatusLabel("High", mmolPlan), "HI (above 33.3)");
  assert.equal(meterStatusLabel("Low", mmolPlan), "LO (below 1.1)");
  assert.equal(meterStatusLabel("High", { meter: { hi: 600, lo: 20 } }), "HI (above 600)");
  assert.equal(meterStatusLabel("High", { glucoseUnit: "mmol/L" }), "HI");
  assert.equal(entryGlucoseLabel({ glucose: null, status: "Low" }, mmolPlan), "LO (below 1.1)");
  assert.equal(
    entryGlucoseLabel({ glucose: glucoseFromInput(4.2, "mmol/L"), status: null }, mmolPlan),
    "4.2 mmol/L",
  );
  assert.equal(entryGlucoseLabel({ glucose: 143, status: null }, {}), "143 mg/dL");
  const high = { at: "2026-09-27T12:00:00.000Z", value: null, status: "High", source: "Dexcom" };
  assert.equal(cgmLabel(high, "mmol/L"), "HIGH (out of range)");
  assert.equal(cgmLabel({ ...high, value: 180, status: null }, "mmol/L"), "10.0");
  assert.ok(planSchema.safeParse({ ...plan, ...mmolPlan }).success);
});

test("a plan entered in mmol/L is stored in mg/dL and reads back as entered", () => {
  const entered = planSchema.parse({
    ...plan,
    glucoseUnit: "mmol/L",
    target: glucoseFromInput(5.5, "mmol/L"),
    factor: factorFromInput(2.5, "mmol/L"),
    lowThreshold: glucoseFromInput(3.9, "mmol/L"),
    ketoneCheckAbove: glucoseFromInput(14, "mmol/L"),
    correctionCallCheck: { above: glucoseFromInput(16.7, "mmol/L"), hours: 2 },
    glucoseRanges: {
      veryLow: glucoseFromInput(3, "mmol/L"),
      low: glucoseFromInput(3.9, "mmol/L"),
      high: glucoseFromInput(10, "mmol/L"),
      veryHigh: glucoseFromInput(13.9, "mmol/L"),
    },
  });
  assert.ok(Math.abs(entered.target - 99.09) < 0.01);
  const rows = Object.fromEntries(
    planSummary(entered).flatMap(({ rows }) => rows.map((row) => [row.label, row.value])),
  );
  assert.equal(rows["Glucose unit"], "mmol/L");
  assert.equal(rows["Glucose target"], "5.5 mmol/L");
  assert.equal(rows["Correction factor"], "2.5 mmol/L per unit");
  assert.equal(rows["Treat a low below"], "3.9 mmol/L");
  assert.equal(rows["Check ketones above"], "14.0 mmol/L");
  assert.equal(rows["Correction call check"], "Above 16.7 mmol/L, 2 hours after a correction");
  assert.equal(rows["Low below"], "3.9 mmol/L");
  assert.equal(rows["Very high above"], "13.9 mmol/L");
  assert.deepEqual(planDraft(entered).values.glucoseUnit, "mmol/L");
  assert.deepEqual(planDraft({ ...entered, glucoseUnit: "mmol" }).invalid, ["glucoseUnit"]);
});

test("a plan without a glucose unit was entered in mg/dL", () => {
  assert.equal(glucoseUnitOf(planSchema.parse(plan)), "mg/dL");
  assert.equal(glucoseUnitOf(null), "mg/dL");
  assert.deepEqual(planDraft(plan).missing, []);
});

test("changing only the unit lists only the unit as changed", () => {
  const before = planSchema.parse(plan);
  const after = { ...before, glucoseUnit: "mmol/L" };
  assert.deepEqual(planChanges(before, after), [
    {
      id: "math",
      title: "Glucose and meal math",
      changes: [{ label: "Glucose unit", before: "mg/dL", after: "mmol/L" }],
    },
  ]);
});

test("level ranges step past each limit by the unit's smallest step", () => {
  assert.deepEqual(glucoseLevelRanges(STANDARD_GLUCOSE_RANGES, "mmol/L"), {
    veryLow: "below 3.0",
    low: "3.0–3.8",
    inRange: "3.9–10.0",
    high: "10.1–13.9",
    veryHigh: "above 13.9",
  });
  assert.deepEqual(glucoseLevelRanges(STANDARD_GLUCOSE_RANGES, "mg/dL"), {
    veryLow: "below 54",
    low: "54–69",
    inRange: "70–180",
    high: "181–250",
    veryHigh: "above 250",
  });
});

test("the calculator gives the same dose whichever unit the plan and reading were entered in", () => {
  let compared = 0;
  for (const rounding of ["down", "nearest"])
    for (const increment of [0.5, 1])
      for (const target of tenths(4, 8))
        for (const factor of [1, 1.5, 1.7, 2, 2.25, 2.5, 3])
          for (const glucose of tenths(4, 25)) {
            // The same arithmetic worked in mmol/L, as the person's care plan writes it.
            const inMmol = math(
              glucose,
              30,
              { ...plan, target, factor, increment, rounding },
              true,
            );
            const stored = math(
              glucoseFromInput(glucose, "mmol/L"),
              30,
              {
                ...plan,
                target: glucoseFromInput(target, "mmol/L"),
                factor: factorFromInput(factor, "mmol/L"),
                increment,
                rounding,
              },
              true,
            );
            assert.equal(stored.rounded, inMmol.rounded, `${glucose} ${target} ${factor}`);
            assert.ok(Math.abs(stored.raw - inMmol.raw) < 1e-9);
            compared++;
          }
  assert.ok(compared > 50000);
});

test("a CGM mean rounds once, in the unit it is shown in", () => {
  // Mean 99.6 mg/dL is 5.53 mmol/L. Rounded to 100 mg/dL first, it would show as 5.6.
  const readings = [99, 100, 100, 99, 100].map((value, i) => ({
    at: new Date(Date.parse("2026-09-23T12:00:00Z") + i * 300000).toISOString(),
    value,
    status: null,
    source: "Dexcom Share",
  }));
  const start = "2026-09-23T11:00:00Z",
    end = "2026-09-23T13:00:00Z";
  assert.equal(formatGlucose(summarizeCgm(readings, start, end).average, "mmol/L"), "5.5");
  assert.equal(formatGlucose(glucoseMetrics(readings, start, end).mean, "mmol/L"), "5.5");
  const { daily, months } = glucoseByDay(
    readings,
    "2026-09-23",
    "2026-09-23",
    "UTC",
    Date.parse("2026-09-24T00:00:00Z"),
  );
  assert.equal(formatGlucose(daily[0].mean, "mmol/L"), "5.5");
  assert.equal(formatGlucose(months[0].mean, "mmol/L"), "5.5");
  assert.equal(formatGlucose(glucoseMetrics(readings, start, end).mean, "mg/dL"), "100");
});

test("log search finds glucose as the person's unit shows it", () => {
  const glucose = glucoseFromInput(5.5, "mmol/L");
  const entry = {
    kind: "insulin",
    glucose: null,
    note: "After lunch",
    calculation: {
      glucose,
      target: glucoseFromInput(6, "mmol/L"),
      factor: factorFromInput(2.5, "mmol/L"),
      ratio: 10,
    },
  };
  const reading = { at: "2026-09-23T12:00:00Z", value: 99, status: null, source: "Dexcom Share" };
  const mmol = logSearchText(entry, "mmol/L");
  for (const shown of ["5.5", "6.0", "2.5", "after lunch"]) assert.ok(mmol.includes(shown), shown);
  // The stored mg/dL behind a mmol/L reading is not what the person sees, so it doesn't match.
  assert.ok(!mmol.includes("99"));
  assert.ok(logSearchText(reading, "mmol/L").includes("5.5"));
  assert.ok(!logSearchText(reading, "mmol/L").includes("99"));
  assert.ok(logSearchText(reading, "mg/dL").includes("99"));
  assert.ok(logSearchText({ ...entry, glucose: 180 }, "mg/dL").includes("180"));
});
