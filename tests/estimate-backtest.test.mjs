import { test } from "bun:test";
import assert from "node:assert/strict";
import { backtestEstimate } from "../lib/estimate-backtest.ts";

// Synthetic readings every 5 minutes; nothing here is a clinical value.
const H = 3600000;
const start = Date.parse("2026-09-20T00:00:00Z");
const valueAt = (t) => Math.round(150 + 60 * Math.sin((2 * Math.PI * (t - start)) / (4 * H)));
const cgm = [];
for (let t = start; t <= start + 12 * H; t += 5 * 60000)
  cgm.push({
    at: new Date(t).toISOString(),
    value: valueAt(t),
    status: null,
    source: "Dexcom Share",
  });
const estimate = (points) => ({
  state: "ready",
  at: "",
  value: points[0].median,
  examples: 0,
  points,
});
const ahead = (now, fn) =>
  estimate(
    [0, 15, 30, 60].map((minutes) => ({
      at: new Date(now + minutes * 60000).toISOString(),
      minutes,
      ...fn(now + minutes * 60000),
    })),
  );

test("the estimator only ever sees readings up to the moment it predicts", () => {
  let checked = 0;
  backtestEstimate(cgm, (seen, now) => {
    assert.ok(seen.every((r) => Date.parse(r.at) <= now));
    assert.equal(Date.parse(seen.at(-1).at), now);
    checked++;
    return { state: "no-reading" };
  });
  assert.ok(checked > 40);
});

test("a range that always holds the later reading scores no miss and full coverage", () => {
  const { all } = backtestEstimate(cgm, (_, now) =>
    ahead(now, (t) => ({ low: valueAt(t) - 5, median: valueAt(t), high: valueAt(t) + 5 })),
  );
  assert.deepEqual(
    all.map((s) => s.minutes),
    [15, 30, 60],
  );
  for (const s of all) {
    assert.equal(s.medianMiss, 0);
    assert.equal(s.covered, 1);
    assert.equal(s.medianWidth, 10);
    assert.ok(s.stayMiss > 0);
  }
  // Past the last reading there is nothing to score against.
  assert.ok(all[2].cases < all[0].cases);
});

test("a flat estimate misses exactly as much as assuming glucose stays where it is", () => {
  const { all } = backtestEstimate(cgm, (_, now) =>
    ahead(now, () => ({ low: valueAt(now), median: valueAt(now), high: valueAt(now) })),
  );
  for (const s of all) assert.equal(s.medianMiss, s.stayMiss);
});
