import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  agp,
  glucoseByDay,
  glucoseEpisodes,
  glucoseLevel,
  glucoseLevelRanges,
  glucoseMetrics,
} from "../lib/glucose-metrics.ts";

const base = Date.parse("2026-09-23T00:00:00Z");
const at = (minute) => new Date(base + minute * 60000).toISOString();
/** One reading every five minutes; a string entry is a "High"/"Low" status. */
const series = (values, start = 0) =>
  values.map((v, i) => ({
    at: at(start + i * 5),
    value: typeof v === "number" ? v : null,
    status: typeof v === "string" ? v : null,
    source: "Dexcom Share",
  }));

test("standard levels put each boundary value on the consensus side", () => {
  const level = (value, status = null) => glucoseLevel({ value, status });
  assert.deepEqual(
    [53, 54, 69, 70, 180, 181, 250, 251].map((v) => level(v)),
    ["veryLow", "low", "low", "inRange", "inRange", "high", "high", "veryHigh"],
  );
  assert.equal(level(null, "Low"), "veryLow");
  assert.equal(level(null, "High"), "veryHigh");
});

test("a care plan's own ranges move each boundary, and the labels follow them", () => {
  const ranges = { veryLow: 60, low: 80, high: 160, veryHigh: 220 };
  const level = (value, status = null) => glucoseLevel({ value, status }, ranges);
  assert.deepEqual(
    [59, 60, 79, 80, 160, 161, 220, 221].map((v) => level(v)),
    ["veryLow", "low", "low", "inRange", "inRange", "high", "high", "veryHigh"],
  );
  // Past the sensor's limits is past every allowed range.
  assert.equal(level(null, "Low"), "veryLow");
  assert.equal(level(null, "High"), "veryHigh");
  assert.deepEqual(glucoseLevelRanges(ranges), {
    veryLow: "below 60",
    low: "60–79",
    inRange: "80–160",
    high: "161–220",
    veryHigh: "above 220",
  });
});

test("metrics weigh observed time, skip gaps, and hide mean-based numbers when too many readings are capped", () => {
  // 100 for 20 minutes, then a 30-minute gap, then 200 for 10 minutes.
  const readings = [...series([100, 100, 100, 100, 100]), ...series([200, 200, 200], 50)];
  const m = glucoseMetrics(readings, at(0), at(60), { low: 90, high: 150 });
  assert.equal(m.observedMinutes, 30);
  assert.equal(m.wearPercent, 50);
  assert.deepEqual(m.levels, { veryLow: 0, low: 0, inRange: 66.7, high: 33.3, veryHigh: 0 });
  assert.equal(m.inPlanRange, 66.7);
  assert.equal(m.mean, 138);
  assert.equal(m.gmi, 6.6);
  assert.equal(m.cv, 35.2);
  assert.equal(m.hiddenReason, null);
  assert.equal(m.agpReady, false);

  const capped = glucoseMetrics(
    series([
      300,
      320,
      "High",
      340,
      330,
      310,
      300,
      305,
      315,
      325,
      335,
      345,
      355,
      365,
      375,
      385,
      395,
      390,
      380,
      370,
    ]),
    at(0),
    at(100),
  );
  assert.equal(capped.cappedPercent, 5);
  assert.equal(capped.hiddenReason, null);
  const tooMany = glucoseMetrics(series([300, "High", "High", 340]), at(0), at(20));
  assert.equal(tooMany.hiddenReason, "capped");
  assert.equal(tooMany.mean, null);
  assert.equal(tooMany.gmi, null);
  assert.equal(tooMany.levels.veryHigh, 100);
});

test("AGP percentiles use local time and report capped readings as statuses", () => {
  const days = [0, 1, 2, 3].map((d) => d * 1440);
  // 07:00 in Chicago on four days; the top reading is only "High".
  const readings = days.flatMap((d, i) => series([[120, 140, 160, "High"][i]], d + 12 * 60));
  const slots = agp(readings, at(0), at(5 * 1440), "America/Chicago");
  const seven = slots.find((s) => s.minute === 7 * 60);
  assert.equal(seven.readings, 4);
  assert.equal(seven.p50, 140);
  assert.equal(seven.p95, "High");
  assert.equal(seven.p5, 120);
  assert.equal(slots.find((s) => s.minute === 12 * 60).p50, null);
});

test("episodes need 15 minutes beyond the threshold and 15 minutes back to end", () => {
  const low = glucoseEpisodes(
    series([
      100,
      65,
      60,
      100, // 10 minutes low: not an episode
      100,
      65,
      50,
      52,
      50,
      60, // low from 25, below 54 for 15 minutes
      80,
      65, // a 5-minute bounce does not end it
      80,
      85,
      90,
      95,
      100, // back for 15 minutes from 60
    ]),
    at(0),
    at(200),
  );
  assert.deepEqual(low, [
    {
      kind: "low",
      severe: true,
      start: at(25),
      end: at(60),
      minutes: 35,
      extreme: 50,
      recovered: true,
    },
  ]);

  const cutOff = glucoseEpisodes(
    [...series([250, 260, "High", 270, 300]), ...series([200], 60)],
    at(0),
    at(100),
  );
  assert.equal(cutOff.length, 1);
  assert.equal(cutOff[0].kind, "high");
  assert.equal(cutOff[0].extreme, "High");
  assert.equal(cutOff[0].severe, true);
  assert.equal(cutOff[0].recovered, false);
  assert.equal(cutOff[0].end, at(20));
});

test("days follow local midnight, stop at now, and roll up by weekday", () => {
  const timezone = "America/Chicago";
  // Local 2026-09-23 starts at 05:00 UTC. Six hours of 100, then two readings of 300.
  const readings = [...series(Array(72).fill(100), 300), ...series([300, 300], 300 + 72 * 5)];
  const { daily, weekdays } = glucoseByDay(
    readings,
    "2026-09-22",
    "2026-09-24",
    timezone,
    base + 17 * 3600000,
  );
  assert.deepEqual(
    daily.map((d) => d.day),
    ["2026-09-22", "2026-09-23", "2026-09-24"],
  );
  assert.equal(daily[0].levels, null);
  assert.equal(daily[1].mean, 105);
  assert.equal(daily[1].wearPercent, 50.7);
  assert.equal(daily[1].levels.inRange, 98.6);
  // 2026-09-24 has not started at `now`.
  assert.equal(daily[2].wearPercent, 0);
  const wednesday = weekdays[3];
  assert.equal(wednesday.days, 1);
  assert.equal(wednesday.levels.veryHigh, 1.4);
  assert.equal(weekdays[4].days, 0);
});

test("months follow local dates, weigh observed time, and leave out days not yet begun", () => {
  const cdt = (local) => Date.parse(`${local}-05:00`);
  const every5 = (from, values) =>
    values.map((v, i) => ({
      at: new Date(cdt(from) + i * 300000).toISOString(),
      value: typeof v === "number" ? v : null,
      status: typeof v === "string" ? v : null,
      source: "Dexcom Clarity",
    }));
  // Sep 30 22:00–23:55 local at 100, then Oct 1 00:00–01:00 at 300 ending in a HIGH.
  const readings = [
    ...every5("2026-09-30T22:00:00", Array(24).fill(100)),
    ...every5("2026-10-01T00:00:00", [...Array(12).fill(300), "High"]),
  ];
  const { months } = glucoseByDay(
    readings,
    "2026-09-29",
    "2026-10-02",
    "America/Chicago",
    cdt("2026-10-01T02:00:00"),
  );
  assert.deepEqual(
    months.map((m) => [m.month, m.days, m.readings, m.wearPercent, m.mean]),
    [
      // The 23:55 reading covers the five minutes up to local midnight.
      ["2026-09", 2, 24, 4.2, 100],
      // Two hours have passed on Oct 1; Oct 2 has not begun. 1 of 13 readings is HIGH: no mean.
      ["2026-10", 1, 13, 50, null],
    ],
  );
  assert.equal(months[0].levels.inRange, 100);
  assert.equal(months[1].levels.veryHigh, 100);
});
