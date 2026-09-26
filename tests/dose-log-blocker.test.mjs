import { test } from "bun:test";
import assert from "node:assert/strict";
import { doseLogBlocker } from "../lib/dose-log-blocker.ts";

const ready = {
  needsCarbs: true,
  carbsValid: true,
  carbRatioSet: true,
  needsCorrection: true,
  hasReading: true,
  low: false,
  correctionReady: true,
  roundedUnits: 1.5,
  recordUnits: 1.5,
  actualDoseValid: true,
  reviewRequired: false,
  reviewed: false,
};

test("a complete calculation can be logged", () => {
  assert.equal(doseLogBlocker(ready), null);
  assert.equal(doseLogBlocker({ ...ready, reviewRequired: true, reviewed: true }), null);
});

test("an unreviewed recent Rapid-acting dose explains the disabled log button", () => {
  assert.match(
    doseLogBlocker({ ...ready, reviewRequired: true }),
    /reviewed the last Rapid-acting/,
  );
});

test("reports the earliest missing input first", () => {
  assert.match(
    doseLogBlocker({ ...ready, carbsValid: false, hasReading: false, reviewRequired: true }),
    /carbohydrates/,
  );
  assert.match(doseLogBlocker({ ...ready, carbRatioSet: false }), /carb ratio/);
  assert.match(
    doseLogBlocker({ ...ready, hasReading: false, correctionReady: false }),
    /glucose reading/,
  );
  assert.match(doseLogBlocker({ ...ready, low: true, correctionReady: false }), /low/);
  assert.match(doseLogBlocker({ ...ready, correctionReady: false }), /last 10 minutes/);
  assert.match(doseLogBlocker({ ...ready, roundedUnits: 0, recordUnits: 0 }), /0 units/);
  assert.match(doseLogBlocker({ ...ready, recordUnits: null }), /adjusted amount/);
  assert.match(doseLogBlocker({ ...ready, actualDoseValid: false }), /actual dose/);
});

test("inputs a mode does not use never block it", () => {
  assert.equal(
    doseLogBlocker({ ...ready, needsCorrection: false, hasReading: false, correctionReady: false }),
    null,
  );
  assert.equal(doseLogBlocker({ ...ready, needsCarbs: false, carbsValid: false }), null);
});
