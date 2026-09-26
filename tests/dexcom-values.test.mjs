import { test } from "bun:test";
import assert from "node:assert/strict";
import { parseShareValues } from "../lib/dexcom-values.ts";

test("Share excludes empty, missing, zero and future values without reporting false lows", () => {
  const at = Date.UTC(2026, 8, 24, 15, 0, 47);
  const sample = (value) => ({ DT: `/Date(${at})/`, Value: value });
  const readings = parseShareValues(
    [
      sample(null),
      sample(""),
      sample(0),
      sample(39),
      sample("Low"),
      sample(315),
      sample("High"),
      { DT: `/Date(${at + 600000})/`, Value: 100 },
    ],
    at,
  );
  assert.deepEqual(
    readings.map((r) => ({ value: r.value, status: r.status })),
    [
      { value: null, status: "Low" },
      { value: null, status: "Low" },
      { value: 315, status: null },
      { value: null, status: "High" },
    ],
  );
  assert.equal(readings[0].at, "2026-09-24T15:00:47.000Z");
});

test("Share rejects unexpected response shape", () => {
  assert.throws(() => parseShareValues({ Code: "InvalidSession" }), /unexpected glucose data/);
});
