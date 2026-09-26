import { test } from "bun:test";
import assert from "node:assert/strict";
import { correctionReviewStatus } from "../lib/correction-review.ts";

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
