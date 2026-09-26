import { test } from "bun:test";
import assert from "node:assert/strict";
import { dodgeLane } from "../lib/chart-lanes.ts";

const GAP = 18;

test("icons with room keep their true positions", () => {
  assert.deepEqual(dodgeLane([100, 300, 200], GAP, 0, 1000), [100, 300, 200]);
});

test("crowded icons spread evenly around their shared time and never overlap", () => {
  const placed = dodgeLane([500, 504, 502], GAP, 0, 1000);
  const sorted = [...placed].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= GAP - 1e-9);
  // Centred on the middle of the times they stand for.
  assert.equal((sorted[0] + sorted[2]) / 2, 502);
  // Input order is kept: the earliest time gets the leftmost slot.
  assert.ok(placed[0] < placed[2] && placed[2] < placed[1]);
});

test("a chain of near neighbours becomes one run, and runs stay inside the lane", () => {
  const chained = dodgeLane([100, 110, 120, 130], GAP, 0, 1000);
  for (let i = 1; i < 4; i++) assert.equal(chained[i] - chained[i - 1], GAP);
  const atEdge = dodgeLane([995, 998], GAP, 0, 1000);
  assert.ok(Math.max(...atEdge) <= 1000 && Math.min(...atEdge) >= 0);
  assert.equal(atEdge[1] - atEdge[0], GAP);
});
