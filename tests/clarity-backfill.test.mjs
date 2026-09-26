import { test } from "bun:test";
import assert from "node:assert/strict";
import { clarityGapToFill } from "../lib/clarity-sync.ts";

const base = Date.parse("2026-09-26T12:00:00.000Z");
const at = (minute) => new Date(base + minute * 60000).toISOString();
/** Readings every five minutes over [from, to] minutes. */
const every5 = (from, to) => {
  const out = [];
  for (let m = from; m <= to; m += 5) out.push(at(m));
  return out;
};

test("a closed gap over 15 minutes is found; short dropouts and open gaps are not", () => {
  const now = base + 120 * 60000;
  // Out of range from 12:30 to 13:10, back in range since.
  assert.deepEqual(clarityGapToFill([...every5(0, 30), ...every5(70, 115)], now), {
    from: at(30),
    to: at(70),
  });
  // A 15-minute dropout is ordinary signal loss, not worth a Clarity sync.
  assert.equal(clarityGapToFill([...every5(0, 30), ...every5(45, 115)], now), null);
  // Still out of range: nothing has been backfilled yet.
  assert.equal(clarityGapToFill(every5(0, 30), now), null);
});

test("only gaps that closed in the last six hours and lasted at most a day count", () => {
  const readings = [...every5(0, 30), ...every5(70, 115)];
  // Closed at 13:10; six hours later is the last chance.
  assert.notEqual(clarityGapToFill(readings, base + (70 + 360) * 60000), null);
  assert.equal(clarityGapToFill(readings, base + (70 + 361) * 60000), null);
  // A sensor keeps 24 hours; a longer silence is a sensor change or a break, not backfill.
  assert.equal(
    clarityGapToFill([at(0), at(24 * 60 + 5), at(24 * 60 + 10)], base + 25 * 3600000),
    null,
  );
});

test("the newest recent gap is chosen", () => {
  const readings = [...every5(0, 30), ...every5(60, 100), ...every5(140, 160)];
  assert.deepEqual(clarityGapToFill(readings, base + 170 * 60000), { from: at(100), to: at(140) });
});
