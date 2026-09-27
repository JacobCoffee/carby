import { test } from "bun:test";
import assert from "node:assert/strict";
import { comparedWithUsual, usualNudge } from "../lib/usual.ts";

// Synthetic readings every 5 minutes in UTC; nothing here is a clinical value.
const H = 3600000,
  D = 24 * H;
const now = Date.parse("2026-09-27T15:00:00Z");
const midnight = Date.parse("2026-09-27T00:00:00Z");
const cgm = (valueAt, from = midnight - 40 * D, to = now) => {
  const out = [];
  for (let t = from; t <= to; t += 5 * 60000) {
    const v = valueAt(t);
    if (v === null) continue;
    out.push({
      at: new Date(t).toISOString(),
      value: typeof v === "number" ? v : null,
      status: typeof v === "string" ? v : null,
      source: "Dexcom Share",
    });
  }
  return out;
};
const run = (readings, entries = [], at = now) =>
  comparedWithUsual({ cgm: readings, entries, timezone: "UTC", now: at });
/** Days ago counted from today's midnight: 0 is today, 1 yesterday. */
const daysAgo = (t) => Math.floor((midnight + D - 1 - t) / D);

test("today so far is compared with the same hours on the previous 14 days", () => {
  const summary = run(cgm((t) => (t >= midnight ? 160 : 200)));
  const today = summary.today;
  assert.equal(today.usual.days, 14);
  assert.equal(today.current.mean, 160);
  assert.equal(today.usual.mean, 200);
  assert.equal(today.meanChangePercent, -20);
  assert.equal(today.current.inRange, 100);
  assert.equal(today.usual.above180, 100);
});

test("only the same hours count: later hours on earlier days don't", () => {
  // Earlier days run 200 until 15:00 and 300 after; today is 200.
  const summary = run(
    cgm((t) => (t >= midnight || (t - midnight + 40 * D) % D < 15 * H ? 200 : 300)),
  );
  assert.equal(summary.today.usual.mean, 200);
  assert.equal(summary.today.meanChangePercent, 0);
});

test("today waits for two hours of the day and for three covered earlier days", () => {
  const early = run(
    cgm(() => 150, midnight - 20 * D, midnight + H),
    [],
    midnight + H,
  );
  assert.deepEqual(early.today, { unavailable: "Too early in the day to compare." });
  // Only 2 earlier days have readings at these hours.
  const thin = run(cgm((t) => (daysAgo(t) <= 2 ? 150 : null)));
  assert.match(thin.today.unavailable, /\(2 so far\)/);
  // Today itself mostly missing.
  const gappy = run(cgm((t) => (t >= midnight && t % (20 * 60000) ? null : 150)));
  assert.match(gappy.today.unavailable, /too little of today/);
});

test("the last 7 complete days are compared with the 4 weeks before, by time of day too", () => {
  const value = (t) => {
    const ago = daysAgo(t);
    const hour = new Date(t).getUTCHours();
    if (ago === 0) return 100; // today is left out of the week
    if (ago <= 7) return hour < 6 ? 260 : 200;
    return 200;
  };
  const { week, dayparts } = run(cgm(value));
  assert.equal(week.current.days, 7);
  assert.equal(week.usual.days, 28);
  assert.equal(week.current.mean, 215);
  assert.equal(week.meanChangePercent, 8);
  assert.deepEqual(dayparts, [
    { label: "Overnight", current: 260, usual: 200 },
    { label: "Morning", current: 200, usual: 200 },
    { label: "Afternoon", current: 200, usual: 200 },
    { label: "Evening", current: 200, usual: 200 },
  ]);
  const short = run(cgm((t) => (daysAgo(t) <= 9 ? 200 : null)));
  assert.match(short.week.unavailable, /\(7 and 2 so far\)/);
  assert.equal(short.dayparts, null);
});

test("an average is hidden when too many readings were past the sensor's limit, and nothing nudges", () => {
  // One reading in ten is HIGH during the last week.
  const summary = run(
    cgm((t) =>
      daysAgo(t) >= 1 && daysAgo(t) <= 7 && Math.round(t / 300000) % 10 === 0 ? "High" : 200,
    ),
  );
  assert.equal(summary.week.current.mean, null);
  assert.equal(summary.week.meanChangePercent, null);
  assert.equal(usualNudge(summary, 5), null);
});

test("the nudge needs the care plan's percent and a change at least that big, either way", () => {
  const up = run(cgm((t) => (daysAgo(t) >= 1 && daysAgo(t) <= 7 ? 230 : 200)));
  assert.equal(up.week.meanChangePercent, 15);
  assert.equal(usualNudge(up, undefined), null);
  assert.deepEqual(usualNudge(up, 15), { direction: "higher", percent: 15 });
  assert.equal(usualNudge(up, 16), null);
  const down = run(cgm((t) => (daysAgo(t) >= 1 && daysAgo(t) <= 7 ? 160 : 200)));
  assert.deepEqual(usualNudge(down, 10), { direction: "lower", percent: 20 });
  const unavailable = run(cgm(() => 200, midnight - 3 * D));
  assert.equal(usualNudge(unavailable, 1), null);
});

test("logged totals are per day with something logged, so unlogged days aren't zeros", () => {
  let n = 0;
  const entry = (ago, fields) => ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    at: new Date(midnight - ago * D + 12 * H).toISOString(),
    glucose: null,
    source: null,
    ketones: null,
    carbs: null,
    units: null,
    insulin: null,
    meal: null,
    note: "",
    ...fields,
  });
  const entries = [
    ...[1, 2, 3].map((ago) => entry(ago, { kind: "food", carbs: 50, meal: "Lunch" })),
    entry(3, { kind: "insulin", units: 3, insulin: "Rapid-acting" }),
    ...[10, 12, 14, 16].map((ago) => entry(ago, { kind: "food", carbs: 40, meal: "Lunch" })),
    entry(0, { kind: "food", carbs: 500, meal: "Lunch" }),
  ];
  const { logged } = run(
    cgm(() => 150),
    entries,
  );
  assert.deepEqual(logged.current, { days: 3, carbs: 50, rapid: 1, long: 0 });
  assert.deepEqual(logged.usual, { days: 4, carbs: 40, rapid: 0, long: 0 });
  assert.equal(
    run(
      cgm(() => 150),
      entries.slice(0, 2),
    ).logged,
    null,
  );
});

test("a saved care plan keeps its change-from-usual percent, and an out-of-range one is flagged", async () => {
  const { planDraft } = await import("../lib/care.ts");
  assert.equal(planDraft({ usualChangePercent: 15 }).values.usualChangePercent, 15);
  assert.equal(planDraft({}).values.usualChangePercent, undefined);
  assert.ok(!planDraft({}).missing.includes("usualChangePercent"), "optional, never required");
  for (const bad of [2, 150, 12.5])
    assert.ok(planDraft({ usualChangePercent: bad }).invalid.includes("usualChangePercent"), bad);
});
