import { test } from "bun:test";
import assert from "node:assert/strict";
import { isRecentReading } from "../lib/reading-freshness.ts";

test("correction glucose must be measured now or within ten minutes", () => {
  const now = Date.parse("2026-09-24T15:00:00.000Z");
  const at = (offset) => new Date(now + offset).toISOString();
  assert.equal(isRecentReading(at(0), now), true);
  assert.equal(isRecentReading(at(-10 * 60_000), now), true);
  assert.equal(isRecentReading(at(-10 * 60_000 - 1), now), false);
  // The dashboard clock ticks every 30s and times are entered to the minute.
  assert.equal(isRecentReading(at(60_000), now), true);
  assert.equal(isRecentReading(at(60_001), now), false);
  assert.equal(isRecentReading(null, now), false);
  assert.equal(isRecentReading("not a timestamp", now), false);
});
