import { test } from "bun:test";
import assert from "node:assert/strict";
import { currentShareForCorrection } from "../lib/correction-reading.ts";
const now = Date.parse("2026-09-24T14:10:00Z");
const point = (at, value, status = null, source = "Dexcom Share") => ({
  at,
  value,
  status,
  source,
});

test("prefills only the latest numeric live Share point", () => {
  const readings = [
    point("2026-09-24T14:01:00Z", 280),
    point("2026-09-24T14:05:00Z", 300),
    point("2026-09-24T14:08:00Z", 350, null, "Dexcom Clarity"),
  ];
  assert.equal(currentShareForCorrection(readings, true, "2026-09-24T14:05:00Z", now)?.value, 300);
  assert.equal(currentShareForCorrection(readings, false, "2026-09-24T14:05:00Z", now), null);
  assert.equal(currentShareForCorrection(readings, true, "2026-09-24T13:55:00Z", now), null);
});

test("a newer out-of-range status, missing Share point or old value requires a current measurement", () => {
  const high = [point("2026-09-24T14:05:00Z", 300), point("2026-09-24T14:09:00Z", null, "High")];
  assert.equal(currentShareForCorrection(high, true, "2026-09-24T14:09:00Z", now), null);
  assert.equal(
    currentShareForCorrection(
      [point("2026-09-24T14:08:00Z", 310, null, "Dexcom Clarity")],
      true,
      "2026-09-24T14:08:00Z",
      now,
    ),
    null,
  );
  assert.equal(
    currentShareForCorrection(
      [point("2026-09-24T13:59:00Z", 310)],
      true,
      "2026-09-24T13:59:00Z",
      now,
    ),
    null,
  );
});
