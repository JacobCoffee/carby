import { test } from "bun:test";
import assert from "node:assert/strict";
import { correctionReviewStatus, inQuietHours } from "../lib/correction-review.ts";

const timezone = "America/Chicago";
const correctionHours = 3;

test("yesterday’s review time is past, not the next check", () => {
  const review = correctionReviewStatus(
    "2026-09-24T23:57:00Z",
    Date.parse("2026-09-25T17:36:00Z"),
    timezone,
    correctionHours,
  );
  assert.equal(review.at, "2026-09-25T02:57:00.000Z");
  assert.equal(review.state, "passed");
});

test("review window includes thirty minutes either side without moving the interval", () => {
  const last = "2026-09-25T15:00:00Z";
  const reviewAt = Date.parse(last) + correctionHours * 3600000;
  for (const [offset, state] of [
    [-1800001, "upcoming"],
    [-1800000, "window"],
    [0, "window"],
    [17 * 60000, "window"],
    [1800000, "window"],
    [1800001, "passed"],
  ]) {
    const review = correctionReviewStatus(last, reviewAt + offset, timezone, correctionHours);
    assert.equal(review.state, state);
    assert.equal(Date.parse(review.at), reviewAt);
  }
});

test("a different configured interval shifts the review boundary accordingly", () => {
  const last = "2026-09-25T15:00:00Z";
  const oneHour = correctionReviewStatus(last, Date.parse("2026-09-25T16:00:00Z"), timezone, 1);
  assert.equal(oneHour.state, "window");
  assert.equal(oneHour.at, "2026-09-25T16:00:00.000Z");
  const stillUpcoming = correctionReviewStatus(
    last,
    Date.parse("2026-09-25T15:29:59.999Z"),
    timezone,
    1,
  );
  assert.equal(stillUpcoming.state, "upcoming");
});

test("an interval crossing local midnight remains upcoming and shows the correct date", () => {
  const review = correctionReviewStatus(
    "2026-09-25T04:00:00Z",
    Date.parse("2026-09-25T05:30:00Z"),
    timezone,
    correctionHours,
  );
  assert.equal(review.state, "upcoming");
});

test("missing history, unknown clock, invalid or future records do not announce a review time", () => {
  const now = Date.parse("2026-09-25T17:36:00Z");
  for (const last of [null, undefined, "invalid", "2026-09-25T18:00:00Z"]) {
    assert.equal(correctionReviewStatus(last, now, timezone, correctionHours), null);
  }
  assert.equal(
    correctionReviewStatus("2026-09-25T15:00:00Z", NaN, timezone, correctionHours),
    null,
  );
});

test("a missing or non-positive interval never announces a review time", () => {
  const now = Date.parse("2026-09-25T17:36:00Z");
  assert.equal(correctionReviewStatus("2026-09-25T15:00:00Z", now, timezone, 0), null);
  assert.equal(correctionReviewStatus("2026-09-25T15:00:00Z", now, timezone, undefined), null);
  assert.equal(correctionReviewStatus("2026-09-25T15:00:00Z", now, timezone, NaN), null);
});

test("overnight quiet hours wrap past midnight on the plan's clock, start in and end out", () => {
  const night = { start: "23:00", end: "06:00" };
  for (const [at, quiet] of [
    ["2026-09-26T03:59:00Z", false], // 10:59 PM CDT
    ["2026-09-26T04:00:00Z", true], // 11:00 PM
    ["2026-09-26T04:28:00Z", true], // 11:28 PM
    ["2026-09-26T07:00:00Z", true], // 2:00 AM
    ["2026-09-26T10:59:00Z", true], // 5:59 AM
    ["2026-09-26T11:00:00Z", false], // 6:00 AM
    ["2026-09-26T17:00:00Z", false], // noon
  ])
    assert.equal(inQuietHours(Date.parse(at), night, timezone), quiet, at);
});

test("quiet hours within one day stay inside it, and none on the plan hides nothing", () => {
  const afternoon = { start: "13:00", end: "15:00" };
  assert.equal(inQuietHours(Date.parse("2026-09-26T18:00:00Z"), afternoon, timezone), true);
  assert.equal(inQuietHours(Date.parse("2026-09-26T20:00:00Z"), afternoon, timezone), false);
  assert.equal(inQuietHours(Date.parse("2026-09-26T08:00:00Z"), afternoon, timezone), false);
  assert.equal(inQuietHours(Date.parse("2026-09-26T04:28:00Z"), undefined, timezone), false);
});
