import { test } from "bun:test";
import assert from "node:assert/strict";
import { sickDayStatus } from "../lib/sick-day.ts";

const illness = (overrides = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  startDate: "2027-01-14",
  startTime: "08:00",
  endDate: null,
  endTime: undefined,
  timezone: "UTC",
  note: "",
  ...overrides,
});
const context = (overrides = {}) => ({ ...illness(overrides), kind: "stress" });
const now = Date.parse("2027-01-14T14:00:00Z");
const plan = { sickDayChecks: { glucoseHours: 3, ketoneHours: 4 } };

test("returns null when no sick period covers now", () => {
  assert.equal(sickDayStatus({ illnesses: [], entries: [], cgm: [], plan, now }), null);
  const future = illness({ startDate: "2027-01-20", startTime: "08:00" });
  assert.equal(sickDayStatus({ illnesses: [future], entries: [], cgm: [], plan, now }), null);
});

test("a non-illness context period (e.g. stress) never activates sick-day mode", () => {
  const stress = context();
  assert.equal(sickDayStatus({ illnesses: [stress], entries: [], cgm: [], plan, now }), null);
});

test("checks is null when sickDayChecks is off the plan, even during an active illness", () => {
  const status = sickDayStatus({ illnesses: [illness()], entries: [], cgm: [], plan: {}, now });
  assert.ok(status);
  assert.equal(status.checks, null);
});

test("glucose and ketone checks start from illness onset and go overdue after their hours elapse", () => {
  const status = sickDayStatus({ illnesses: [illness()], entries: [], cgm: [], plan, now });
  // Illness started 2027-01-14T08:00Z; now is 06:00 later.
  assert.equal(status.checks.glucose.lastAt, null);
  assert.equal(status.checks.glucose.dueAt, "2027-01-14T11:00:00.000Z");
  assert.equal(status.checks.glucose.overdue, true);
  assert.equal(status.checks.ketones.dueAt, "2027-01-14T12:00:00.000Z");
  assert.equal(status.checks.ketones.overdue, true);
});

test("a logged glucose reading resets the glucose due time but not the ketone due time", () => {
  const entries = [
    { kind: "glucose", at: "2027-01-14T13:00:00Z", glucose: 180, ketones: "Not checked" },
  ];
  const status = sickDayStatus({ illnesses: [illness()], entries, cgm: [], plan, now });
  assert.equal(status.checks.glucose.lastAt, "2027-01-14T13:00:00Z");
  assert.equal(status.checks.glucose.dueAt, "2027-01-14T16:00:00.000Z");
  assert.equal(status.checks.glucose.overdue, false);
  assert.equal(status.checks.ketones.lastAt, null);
  assert.equal(status.checks.ketones.overdue, true);
});

test("a checked-but-negative ketone reading counts as a ketone check; 'Not checked' never does", () => {
  const entries = [
    { kind: "glucose", at: "2027-01-14T09:00:00Z", glucose: 150, ketones: "Negative" },
    { kind: "glucose", at: "2027-01-14T10:00:00Z", glucose: 150, ketones: "Not checked" },
  ];
  const status = sickDayStatus({ illnesses: [illness()], entries, cgm: [], plan, now });
  assert.equal(status.checks.ketones.lastAt, "2027-01-14T09:00:00Z");
});

test("CGM readings count toward the glucose check even without a logged fingerstick", () => {
  const status = sickDayStatus({
    illnesses: [illness()],
    entries: [],
    cgm: [{ at: "2027-01-14T13:30:00Z", value: 170, status: null, source: "Dexcom Share" }],
    plan,
    now,
  });
  assert.equal(status.checks.glucose.lastAt, "2027-01-14T13:30:00Z");
  assert.equal(status.checks.glucose.overdue, false);
});
