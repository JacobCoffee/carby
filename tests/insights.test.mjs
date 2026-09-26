import { test } from "bun:test";
import assert from "node:assert/strict";
import { computeInsights, identifiedFoodNames } from "../lib/insights.ts";

const sensor = (at, value, status = null, source = "Dexcom Clarity") => ({
  at,
  value,
  status,
  source,
});

function everyTenMinutes(start, end, value, status = null) {
  const readings = [];
  for (let at = Date.parse(start); at <= Date.parse(end); at += 600_000) {
    readings.push(sensor(new Date(at).toISOString(), value, status));
  }
  return readings;
}

const food = (at, meal, carbs, note) => ({ kind: "food", at, meal, carbs, note });

test("unobserved gaps stay out of coverage and suppress sparse glucose percentages", () => {
  const now = new Date("2026-09-24T00:40:00.000Z");
  const readings = [
    sensor("2026-09-24T00:00:00.000Z", 100),
    sensor("2026-09-24T00:05:00.000Z", 120),
    sensor("2026-09-24T00:30:00.000Z", 160),
    sensor("2026-09-24T00:35:00.000Z", 200),
    sensor("2026-09-24T00:40:00.000Z", 210),
  ];
  const result = computeInsights(7, [], readings, "Etc/UTC", now);
  assert.equal(result.coverage.observedMinutes, 15);
  assert.equal(result.coverage.possibleMinutes, 6 * 1_440 + 40);
  assert.equal(result.coverage.quality, "sparse");
  assert.equal(result.glucose.inRangePercent, null);
  assert.equal(result.glucose.mean, null);
  assert.equal(result.trend.comparable, false);
});

test("CGM source duplicates are counted once and HIGH is not invented as numeric glucose", () => {
  const now = new Date("2026-09-24T00:10:00.000Z");
  const readings = [
    sensor("2026-09-24T00:00:00.000Z", null, "High", "Dexcom Share"),
    sensor("2026-09-24T00:00:00.000Z", 320, null, "Dexcom Clarity"),
    sensor("2026-09-24T00:05:00.000Z", null, "High"),
    sensor("2026-09-24T00:10:00.000Z", null, "High"),
  ];
  const result = computeInsights(7, [], readings, "Etc/UTC", now);
  assert.equal(result.coverage.uniqueReadings, 2);
  assert.equal(result.coverage.numericReadings, 1);
  assert.equal(result.coverage.highStatuses, 1);
  assert.equal(result.coverage.observedMinutes, 10);
  assert.equal(result.glucose.mean, null);
});

test("time in range uses observed interval minutes, including status-only HIGH", () => {
  const now = new Date("2026-09-24T00:00:00.000Z");
  const readings = everyTenMinutes("2026-09-10T00:00:00.000Z", "2026-09-24T00:00:00.000Z", 120);
  const highStart = Date.parse("2026-09-23T00:00:00.000Z");
  for (const reading of readings) {
    if (Date.parse(reading.at) >= highStart) {
      reading.value = null;
      reading.status = "High";
    }
  }
  const result = computeInsights(14, [], readings, "Etc/UTC", now);
  assert.equal(result.coverage.quality, "adequate");
  assert.equal(result.coverage.percent, 100);
  assert.equal(result.glucose.inRangePercent, 92);
  assert.equal(result.glucose.above250Percent, 8);
  assert.equal(result.glucose.mean, null);
  assert.equal(result.daily.find((day) => day.day === "2026-09-23").above250Percent, 100);
});

test("seven days is labeled a short window, with complete-day trend comparisons", () => {
  const now = new Date("2026-09-24T00:00:00.000Z");
  const prior = everyTenMinutes("2026-09-10T00:00:00.000Z", "2026-09-17T00:00:00.000Z", 220);
  const current = everyTenMinutes("2026-09-17T00:00:00.000Z", "2026-09-24T00:00:00.000Z", 120);
  const result = computeInsights(7, [], [...prior, ...current], "Etc/UTC", now);
  assert.equal(result.coverage.quality, "short-window");
  assert.equal(result.trend.comparable, true);
  assert.equal(result.trend.previousCoveragePercent, 100);
  assert.equal(result.trend.previousInRangePercent, 0);
  assert.equal(result.trend.currentInRangePercent, 100);
  assert.equal(result.trend.deltaInRangePoints, 100);
});

test("30-day comparison remains unavailable with only 45 loaded days", () => {
  const now = new Date("2026-09-24T00:00:00.000Z");
  const readings = everyTenMinutes("2026-08-10T00:00:00.000Z", "2026-09-24T00:00:00.000Z", 140);
  const result = computeInsights(30, [], readings, "Etc/UTC", now);
  assert.equal(result.coverage.quality, "adequate");
  assert.equal(result.trend.previousCoveragePercent, 50);
  assert.equal(result.trend.comparable, false);
  assert.equal(result.trend.deltaInRangePoints, null);
  assert.match(result.trend.reason, /60 complete days/);
});

test("30-day comparison becomes available with sufficient extended CGM history", () => {
  const now = new Date("2026-09-24T00:00:00.000Z");
  const readings = everyTenMinutes("2026-07-21T00:00:00.000Z", "2026-09-24T00:00:00.000Z", 140);
  const result = computeInsights(30, [], readings, "Etc/UTC", now);
  assert.equal(result.trend.previousCoveragePercent, 100);
  assert.equal(result.trend.comparable, true);
  assert.equal(result.trend.deltaInRangePoints, 0);
  assert.equal(result.trend.reason, null);
});

test("rounded 70% coverage is still sparse if the actual fraction is below 70%", () => {
  const start = "2026-09-18T00:00:00.000Z";
  const end = new Date(Date.parse(start) + 6_010 * 60_000).toISOString();
  const now = new Date("2026-09-24T00:00:00.000Z");
  const result = computeInsights(7, [], everyTenMinutes(start, end, 110), "Etc/UTC", now);
  assert.equal(result.coverage.percent, 70);
  assert.equal(result.coverage.quality, "sparse");
  assert.equal(result.glucose.inRangePercent, null);
});

test("local days respect daylight saving time instead of assuming 24 hours", () => {
  const now = new Date("2026-03-09T04:00:00.000Z");
  const readings = [
    sensor("2026-03-08T06:55:00.000Z", 100),
    sensor("2026-03-08T07:00:00.000Z", 110),
  ];
  const result = computeInsights(7, [], readings, "America/New_York", now);
  assert.equal(result.period.endDay, "2026-03-09");
  assert.equal(result.daily.find((day) => day.day === "2026-03-08").possibleMinutes, 1_380);
  assert.equal(result.daily.find((day) => day.day === "2026-03-08").observedMinutes, 5);
});

test("only itemized food notes count as identifiable favorites", () => {
  assert.deepEqual(
    identifiedFoodNames("Bread: 1 slice × 13 g per 1 slice; Bread: 1 slice × 13 g per 1 slice"),
    ["Bread"],
  );
  assert.deepEqual(identifiedFoodNames("A snack, maybe some bread"), []);
  const now = new Date("2026-09-24T12:00:00.000Z");
  const entries = [
    food(
      "2026-09-23T21:37:00.000Z",
      "Dinner",
      25,
      "Bread: 1 slice × 13 g per 1 slice; Fairlife Whole Milk: 1 cup × 12 g per 2 cups",
    ),
    food("2026-09-24T09:00:00.000Z", "Snack", 13, "Bread: 1 slice × 13 g per 1 slice"),
    food("2026-09-24T10:00:00.000Z", "Snack", 8, "some crackers"),
    food("2026-09-24T11:00:00.000Z", "Low treatment", 15, "Bread: 1 slice × 15 g per 1 slice"),
  ];
  const result = computeInsights(7, entries, [], "America/Chicago", now);
  assert.deepEqual(
    result.topFoods.map((item) => [item.name, item.count]),
    [
      ["Bread", 2],
      ["Fairlife Whole Milk", 1],
    ],
  );
  assert.deepEqual(
    result.topSnacks.map((item) => [item.name, item.count]),
    [["Bread", 1]],
  );
  assert.deepEqual(result.foodIdentification, {
    totalFoodEntries: 3,
    identifiedEntries: 2,
    unidentifiedEntries: 1,
    inferredEntries: 2,
  });
  assert.equal(result.daily.find((day) => day.day === "2026-09-23").mealCount, 1);
  assert.equal(result.daily.find((day) => day.day === "2026-09-24").snackCount, 2);
});

test("structured eaten portions take precedence over stale legacy text", () => {
  const now = new Date("2026-09-24T12:00:00.000Z");
  const logged = {
    ...food(
      "2026-09-24T09:00:00.000Z",
      "Morning snack",
      12,
      "Old bread: 1 slice × 12 g per 1 slice",
    ),
    foodItems: [
      { name: "Fairlife Whole Milk", carbs: 6, amount: 1, unit: "cup" },
      { name: "fairlife whole milk", carbs: 6, amount: 1, unit: "cup" },
    ],
  };
  const result = computeInsights(7, [logged], [], "America/Chicago", now);
  assert.deepEqual(
    result.topFoods.map((item) => item.count),
    [1],
  );
  assert.equal(result.topFoods[0].name.toLowerCase(), "fairlife whole milk");
  assert.deepEqual(
    result.topSnacks.map((item) => item.count),
    [1],
  );
  assert.deepEqual(result.foodIdentification, {
    totalFoodEntries: 1,
    identifiedEntries: 1,
    unidentifiedEntries: 0,
    inferredEntries: 0,
  });
});
