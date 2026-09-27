import { test } from "bun:test";
import assert from "node:assert/strict";
import { nightlyReminder, nightlySchedule } from "../lib/nightly-reminder.ts";
const plan = { basal: 9, timezone: "America/Chicago", basalTime: "23:00" };
const dose = (at) => ({ id: at, kind: "insulin", insulin: "Long-acting", units: 9, at });
const prior = dose("2026-09-25T04:00:00Z");
const state = (at, entries = [prior], schedule = plan) =>
  nightlyReminder(entries, Date.parse(at), schedule);
test("nightly appears at the scheduled evening and becomes unlogged 15 minutes later", () => {
  assert.equal(state("2026-09-26T01:59:59Z").visible, false);
  assert.equal(state("2026-09-26T02:00:00Z").state, "upcoming");
  assert.equal(state("2026-09-26T02:00:00Z").visible, true);
  assert.equal(state("2026-09-26T04:14:59Z").state, "due");
  assert.equal(state("2026-09-26T04:15:00Z").state, "unlogged");
});
test("missing night carries across midnight, and overnight logging clears it", () => {
  const now = "2026-09-26T07:30:00Z";
  assert.equal(state(now).at, "2026-09-26T04:00:00.000Z");
  assert.equal(state(now).state, "unlogged");
  const overnight = dose("2026-09-26T07:15:00Z");
  assert.equal(state(now, [prior, overnight]).state, "logged");
  assert.equal(state(now, [prior, overnight]).visible, false);
  assert.equal(state("2026-09-27T02:00:00Z", [overnight]).state, "upcoming");
});
test("early actual dose counts; prior morning, future, invalid and other insulin do not", () => {
  const now = "2026-09-26T05:00:00Z";
  assert.equal(state(now, [dose("2026-09-26T00:00:00Z")]).state, "logged");
  const invalid = [
    dose("2026-09-25T14:00:00Z"),
    dose("2026-09-26T06:00:00Z"),
    dose("invalid"),
    { ...dose("2026-09-26T04:00:00Z"), insulin: "Rapid-acting" },
  ];
  assert.equal(state(now, invalid).state, "unlogged");
});
test("a schedule shortly after midnight becomes visible the evening before", () => {
  const result = state("2026-09-26T06:00:00Z", [], { ...plan, basalTime: "02:30" });
  assert.equal(result.at, "2026-09-26T07:30:00.000Z");
  assert.equal(result.state, "upcoming");
  assert.equal(result.visible, true);
});
test("DST follows local schedule rather than fixed 24-hour arithmetic", () => {
  assert.equal(state("2026-11-02T03:00:00Z", []).at, "2026-11-02T05:00:00.000Z");
  assert.equal(state("2026-03-09T02:00:00Z", []).at, "2026-03-09T04:00:00.000Z");
  assert.equal(nightlyReminder([], NaN, plan), null);
});
test("basal=0 explicitly disables the reminder rather than scheduling a fake dose", () => {
  assert.equal(
    nightlyReminder([prior], Date.parse("2026-09-26T04:00:00Z"), { ...plan, basal: 0 }),
    null,
  );
});
test("the chart schedule lists each day's local dose time in the window, skipping a missing clock time", () => {
  assert.deepEqual(
    nightlySchedule(plan, Date.parse("2026-09-25T05:00:00Z"), Date.parse("2026-09-28T05:00:00Z")),
    ["2026-09-26T04:00:00.000Z", "2026-09-27T04:00:00.000Z", "2026-09-28T04:00:00.000Z"],
  );
  // 2:30 AM does not exist on the spring-forward day.
  assert.deepEqual(
    nightlySchedule(
      { ...plan, basalTime: "02:30" },
      Date.parse("2027-03-13T06:00:00Z"),
      Date.parse("2027-03-16T05:00:00Z"),
    ),
    ["2027-03-13T08:30:00.000Z", "2027-03-15T07:30:00.000Z"],
  );
  assert.deepEqual(
    nightlySchedule(
      { ...plan, basal: 0, basalTime: "" },
      Date.parse("2026-09-25T05:00:00Z"),
      Date.parse("2026-09-28T05:00:00Z"),
    ),
    [],
  );
});
