import { test } from "bun:test";
import assert from "node:assert/strict";
import { mergeReadings } from "../lib/chart-readout.ts";

const at = (iso, value, status, source) => ({ at: iso, t: Date.parse(iso), value, status, source });

test("the same value in the same minute is one row naming each source once", () => {
  const rows = mergeReadings([
    at("2026-09-26T17:49:05Z", null, "High", "Dexcom Clarity"),
    at("2026-09-26T17:49:00Z", null, "High", "Dexcom Share"),
    at("2026-09-26T17:49:00Z", null, "High", "Dexcom Share"),
    at("2026-09-26T17:50:00Z", 488, null, "Finger-stick"),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].sources, ["Dexcom Clarity", "Dexcom Share"]);
  assert.deepEqual(rows[1].sources, ["Finger-stick"]);
});

test("different values, statuses or minutes stay separate", () => {
  const rows = mergeReadings([
    at("2026-09-26T17:49:00Z", 250, null, "Dexcom Share"),
    at("2026-09-26T17:49:30Z", 251, null, "Dexcom Clarity"),
    at("2026-09-26T17:49:40Z", null, "High", "Dexcom Clarity"),
    at("2026-09-26T17:50:00Z", 250, null, "Dexcom Share"),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.value, r.status]),
    [
      [250, null],
      [251, null],
      [null, "High"],
      [250, null],
    ],
  );
});
