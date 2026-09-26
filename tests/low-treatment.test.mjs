import { test } from "bun:test";
import assert from "node:assert/strict";
import { lowRecheck } from "../lib/low-treatment.ts";

const plan = { lowThreshold: 70, lowTreatment: { grams: 15, recheckMinutes: 15 } };
const treat = (at, carbs = 15) => ({ kind: "food", meal: "Low treatment", carbs, at });
const finger = (at, glucose, status = null) => ({
  kind: "glucose",
  source: "Finger-stick",
  glucose,
  status,
  at,
});
const now = Date.parse("2027-01-14T12:00:00Z");

test("lowTreatment off the plan disables recheck tracking entirely", () => {
  const entries = [treat("2027-01-14T11:50:00Z")];
  assert.equal(lowRecheck({ entries, cgm: [], plan: {}, now }), null);
});

test("no low-treatment entry in the last two hours means no recheck to track", () => {
  const entries = [treat("2027-01-14T09:00:00Z")];
  assert.equal(lowRecheck({ entries, cgm: [], plan, now }), null);
});

test("waiting before the recheck window opens, due once it arrives", () => {
  const entries = [treat("2027-01-14T11:50:00Z")];
  const waiting = lowRecheck({ entries, cgm: [], plan, now: Date.parse("2027-01-14T11:52:00Z") });
  assert.equal(waiting.state, "waiting");
  assert.equal(waiting.dueAt, "2027-01-14T12:05:00.000Z");
  const due = lowRecheck({ entries, cgm: [], plan, now: Date.parse("2027-01-14T12:05:00Z") });
  assert.equal(due.state, "due");
});

test("a recheck reading below the low threshold is still-low; at or above it is recovered", () => {
  const readAt = Date.parse("2027-01-14T12:01:00Z");
  const entries = [treat("2027-01-14T11:45:00Z"), finger("2027-01-14T12:01:00Z", 65)];
  const stillLow = lowRecheck({ entries, cgm: [], plan, now: readAt });
  assert.equal(stillLow.state, "still-low");
  assert.equal(stillLow.reading.value, 65);
  const recovered = lowRecheck({
    entries: [treat("2027-01-14T11:45:00Z"), finger("2027-01-14T12:01:00Z", 90)],
    cgm: [],
    plan,
    now: readAt,
  });
  assert.equal(recovered.state, "recovered");
});

test("a reading just inside the two-minute grace before the exact due time still counts as the recheck", () => {
  const entries = [treat("2027-01-14T11:45:00Z"), finger("2027-01-14T11:59:00Z", 60)];
  const result = lowRecheck({ entries, cgm: [], plan, now });
  assert.equal(result.state, "still-low");
  const tooEarly = lowRecheck({
    entries: [treat("2027-01-14T11:45:00Z"), finger("2027-01-14T11:57:00Z", 60)],
    cgm: [],
    plan,
    now,
  });
  assert.equal(tooEarly.state, "due");
});

test("an LO meter status at recheck counts as still-low without a numeric value", () => {
  const entries = [treat("2027-01-14T11:45:00Z"), finger("2027-01-14T12:01:00Z", null, "Low")];
  const result = lowRecheck({ entries, cgm: [], plan, now: Date.parse("2027-01-14T12:01:00Z") });
  assert.equal(result.state, "still-low");
});

test("the most recent low-treatment entry within two hours is used", () => {
  const entries = [treat("2027-01-14T10:00:00Z"), treat("2027-01-14T11:50:00Z")];
  const result = lowRecheck({ entries, cgm: [], plan, now });
  assert.equal(result.treatedAt, "2027-01-14T11:50:00Z");
});
