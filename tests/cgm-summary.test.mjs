import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  cgmSummary,
  clarityBehind,
  currentSensor,
  describeAlert,
  timeAgo,
} from "../lib/cgm-summary.ts";

test("alerts read as the setting the app uses, or just the name when it has none", () => {
  const alert = { kind: "Urgent Low", glucose: 55, rate: null, minutes: null };
  assert.equal(describeAlert(alert), "Urgent Low · 55 mg/dL");
  assert.equal(
    describeAlert({ ...alert, kind: "Rise", glucose: null, rate: 3 }),
    "Rise · 3 mg/dL per min",
  );
  assert.equal(
    describeAlert({ ...alert, kind: "Signal Loss", glucose: null, minutes: 20 }),
    "Signal Loss · after 20 min",
  );
  assert.equal(
    describeAlert({ ...alert, kind: "Urgent Low Soon", glucose: null }),
    "Urgent Low Soon",
  );
});

test("the current sensor is the one with the newest reading, counted from its first day", () => {
  const now = Date.parse("2026-09-26T20:00:00Z");
  const sensor = currentSensor(
    [
      {
        sensorId: "OLD",
        source: null,
        firstAt: "2026-09-10T00:00:00Z",
        lastAt: "2026-09-20T00:00:00Z",
      },
      {
        sensorId: "NEW",
        source: "iOS G7",
        firstAt: "2026-09-22T20:30:00Z",
        lastAt: "2026-09-26T19:40:00Z",
      },
    ],
    now,
  );
  assert.equal(sensor.sensorId, "NEW");
  // Sep 22 20:30 to Sep 26 20:00 is three full days and most of a fourth: day 4.
  assert.equal(sensor.day, 4);
  assert.equal(sensor.quietMinutes, 20);
  assert.equal(sensor.inUse, true);
  assert.equal(currentSensor([], now), null);
});

test("a sensor Clarity has not heard from in a day is no longer called in use", () => {
  const session = { sensorId: "S", source: null, firstAt: "2026-09-20T00:00:00Z" };
  const inUse = (lastAt) =>
    currentSensor([{ ...session, lastAt }], Date.parse("2026-09-26T20:00:00Z")).inUse;
  assert.equal(inUse("2026-09-25T20:01:00Z"), true);
  assert.equal(inUse("2026-09-25T20:00:00Z"), false);
});

test("Clarity is behind when a sync failed, never ran, or is more than 36 hours old", () => {
  const now = Date.parse("2026-09-26T20:00:00Z");
  const sync = { lastSync: "2026-09-25T09:00:00Z", lastError: null, latestAt: null };
  assert.equal(clarityBehind(sync, now), false);
  assert.equal(clarityBehind({ ...sync, lastSync: "2026-09-25T07:59:00Z" }, now), true);
  assert.equal(clarityBehind({ ...sync, lastError: "Share code expired." }, now), true);
  assert.equal(clarityBehind({ ...sync, lastSync: null }, now), true);
});

test("ages read in the largest whole unit", () => {
  const now = Date.parse("2026-09-26T20:00:00Z");
  const ago = (minutes) => timeAgo(new Date(now - minutes * 60000).toISOString(), now);
  assert.deepEqual([0.5, 59, 60, 47 * 60 + 59, 48 * 60, -5].map(ago), [
    "just now",
    "59 min ago",
    "1 hr ago",
    "47 hr ago",
    "2 days ago",
    "just now",
  ]);
});

test("a summary ending today stops at now, so the unfinished day is not counted as missing", () => {
  const now = Date.parse("2026-09-26T17:00:00Z"); // noon in Chicago
  const readings = Array.from({ length: 12 }, (_, i) => ({
    at: new Date(now - (12 - i) * 300000).toISOString(),
    value: 120,
    status: null,
    source: "Dexcom Share",
  }));
  const summary = cgmSummary({
    readings,
    startDay: "2026-09-26",
    endDay: "2026-09-26",
    timezone: "America/Chicago",
    now,
  });
  // Midnight to noon is 720 minutes; the readings cover the last 55 of them.
  assert.equal(summary.metrics.possibleMinutes, 720);
  assert.equal(summary.metrics.observedMinutes, 55);
  assert.equal(summary.daily[0].wearPercent, 7.6);
});
