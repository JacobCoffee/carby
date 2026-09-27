import { test } from "bun:test";
import assert from "node:assert/strict";
import { backtestEstimate, loggedGroup } from "../lib/estimate-backtest.ts";

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

test("grouped scores split the same cases by each test time's group", () => {
  const run = backtestEstimate(
    cgm,
    (_, now) =>
      ahead(now, (t) => ({ low: valueAt(t) - 5, median: valueAt(t), high: valueAt(t) + 5 })),
    { group: (now) => ((now - start) % (2 * H) < H ? "first hour" : "second hour") },
  );
  assert.deepEqual(Object.keys(run.byGroup).toSorted(), ["first hour", "second hour"]);
  for (const [i, s] of run.all.entries())
    assert.equal(s.cases, run.byGroup["first hour"][i].cases + run.byGroup["second hour"][i].cases);
  assert.deepEqual(backtestEstimate(cgm, () => ({ state: "no-reading" })).byGroup, {});
});

test("the logged group is what was logged in the three hours before, and nothing after", () => {
  const now = start + 6 * H;
  const entry = (hoursBefore, fields) => ({
    at: new Date(now - hoursBefore * H).toISOString(),
    ...fields,
  });
  const food = (h) => entry(h, { kind: "food", carbs: 30 });
  const rapid = (h) => entry(h, { kind: "insulin", insulin: "Rapid-acting", units: 1 });
  assert.equal(loggedGroup([], now), "Nothing logged");
  assert.equal(loggedGroup([food(1)], now), "Food only");
  assert.equal(loggedGroup([rapid(2.5)], now), "Insulin only");
  assert.equal(loggedGroup([food(0.5), rapid(0.5)], now), "Food and insulin");
  // Too long ago, still to come, a long-acting dose, or food with no carbs don't count.
  assert.equal(
    loggedGroup(
      [
        food(3.5),
        food(-0.5),
        entry(1, { kind: "insulin", insulin: "Long-acting", units: 7 }),
        entry(1, { kind: "food", carbs: 0 }),
      ],
      now,
    ),
    "Nothing logged",
  );
});
