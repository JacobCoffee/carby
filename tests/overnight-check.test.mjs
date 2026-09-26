import { test } from "bun:test";
import assert from "node:assert/strict";
import { overnightBannerShown, overnightCheck } from "../lib/overnight-check.ts";

const plan = { overnightCheck: { time: "02:00", until: "2027-01-16" }, timezone: "UTC" };
const check = (at, entries = [], schedule = plan) =>
  overnightCheck({ entries, plan: schedule, now: Date.parse(at) });
const rescue = (at, medication = "Rescue") => ({ kind: "rescue", at, medication });
const finger = (at, glucose = 150) => ({ kind: "glucose", at, source: "Finger-stick", glucose });

test("no overnightCheck on the plan disables the reminder entirely", () => {
  assert.equal(check("2027-01-14T02:00:00Z", [], {}), null);
});

test("the reminder moves upcoming -> due -> missed at the scheduled time", () => {
  assert.equal(check("2027-01-14T01:00:00Z").state, "upcoming");
  assert.equal(check("2027-01-14T02:00:00Z").state, "due");
  assert.equal(check("2027-01-14T02:14:59Z").state, "due");
  assert.equal(check("2027-01-14T02:15:00Z").state, "missed");
  assert.equal(check("2027-01-14T02:00:00Z").reason, "plan");
});

test("once the check window closes the reminder moves on to the next night", () => {
  const missed = check("2027-01-14T03:29:59Z");
  assert.equal(missed.state, "missed");
  assert.equal(missed.at, "2027-01-14T02:00:00.000Z");
  const next = check("2027-01-14T03:30:00Z");
  assert.equal(next.state, "upcoming");
  assert.equal(next.at, "2027-01-15T02:00:00.000Z");
});

test("a finger-stick within 90 minutes of the scheduled time clears the reminder as logged", () => {
  assert.equal(check("2027-01-14T02:20:00Z", [finger("2027-01-14T01:00:00Z")]).state, "logged");
  assert.equal(check("2027-01-14T02:20:00Z", [finger("2027-01-14T00:20:00Z")]).state, "missed");
});

test("the last night covers its early-morning check, then the reminder turns off", () => {
  // Night of Jan 16 is the last night; its 02:00 check falls on Jan 17.
  assert.equal(check("2027-01-17T01:00:00Z").reason, "plan");
  assert.equal(check("2027-01-17T02:00:00Z").state, "due");
  assert.equal(check("2027-01-17T03:30:00Z"), null);
});

test("an evening check belongs to its own date's night", () => {
  const evening = { overnightCheck: { time: "22:00", until: "2027-01-16" }, timezone: "UTC" };
  assert.equal(check("2027-01-16T21:00:00Z", [], evening).reason, "plan");
  assert.equal(check("2027-01-16T23:30:00Z", [], evening), null);
});

test("a rescue in the 24 hours before a check reactivates it past `until` as severe-low", () => {
  const result = check("2027-01-18T02:00:00Z", [rescue("2027-01-17T10:00:00Z")]);
  assert.equal(result.reason, "severe-low");
  assert.equal(result.state, "due");
  // A rescue more than 24 hours before the check does not.
  assert.equal(check("2027-01-18T01:00:00Z", [rescue("2027-01-17T01:59:00Z")]), null);
});

test("within the plan window a same-night rescue keeps reason plan", () => {
  assert.equal(check("2027-01-16T02:00:00Z", [rescue("2027-01-15T20:00:00Z")]).reason, "plan");
});

test("the banner shows once a finger-stick would count, until logged or the window closes", () => {
  const banner = (at, entries = []) => overnightBannerShown(check(at, entries), Date.parse(at));
  assert.equal(banner("2027-01-14T00:29:59Z"), false);
  assert.equal(banner("2027-01-14T00:30:00Z"), true);
  assert.equal(banner("2027-01-14T02:05:00Z"), true);
  assert.equal(banner("2027-01-14T03:29:59Z"), true);
  assert.equal(banner("2027-01-14T03:30:00Z"), false);
  assert.equal(banner("2027-01-14T01:30:00Z", [finger("2027-01-14T01:15:00Z")]), false);
  assert.equal(overnightBannerShown(null, Date.parse("2027-01-14T02:00:00Z")), false);
});
