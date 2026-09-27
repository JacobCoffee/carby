import { test } from "bun:test";
import assert from "node:assert/strict";
import { correctionMarkerAt } from "../lib/correction-marker.ts";
import { readingAboveRange } from "../lib/correction-review.ts";
const review = { at: "2026-09-25T23:00:00Z", state: "upcoming" };
test("marker requires current above-range glucose and an upcoming review", () => {
  assert.equal(correctionMarkerAt(review, true, 250, null, 150, 180), review.at);
  assert.equal(correctionMarkerAt(review, true, null, "High", 150, 180), review.at);
  assert.equal(
    correctionMarkerAt({ ...review, state: "window" }, true, 250, null, 150, 180),
    review.at,
  );
  for (const value of [60, 150, 160, 180, null])
    assert.equal(correctionMarkerAt(review, true, value, null, 150, 180), null);
  assert.equal(correctionMarkerAt(review, false, 250, null, 150, 180), null);
  assert.equal(correctionMarkerAt({ ...review, state: "passed" }, true, 250, null, 150, 180), null);
  assert.equal(correctionMarkerAt(null, true, 250, null, 150, 180), null);
  assert.equal(correctionMarkerAt(review, true, 220, null, 240, 180), null);
});

test("marker uses the care plan's high-glucose limit instead of a fixed 180", () => {
  // Plan sets a lower high (150): 165 now clears the plan-driven threshold.
  assert.equal(correctionMarkerAt(review, true, 165, null, 100, 150), review.at);
  // Plan sets a higher high (220): 200 no longer clears it.
  assert.equal(correctionMarkerAt(review, true, 200, null, 100, 220), null);
});

test("above range means HIGH or above both the plan's high limit and target", () => {
  assert.equal(readingAboveRange(null, "High", 150, 180), true);
  assert.equal(readingAboveRange(181, null, 150, 180), true);
  assert.equal(readingAboveRange(180, null, 150, 180), false);
  assert.equal(readingAboveRange(200, null, 220, 180), false);
  assert.equal(readingAboveRange(null, "Low", 150, 180), false);
  assert.equal(readingAboveRange(144, null, 150, 180), false);
});
