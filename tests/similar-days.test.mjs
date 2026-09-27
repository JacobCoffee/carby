import { test } from "bun:test";
import assert from "node:assert/strict";
import { similarDays, similarDaysOutside, estimateLabel } from "../lib/similar-days.ts";

// Synthetic readings every 5 minutes; nothing here is a clinical value.
const H = 3600000;
const reading = (t, value, status = null) => ({
  at: new Date(t).toISOString(),
  value,
  status,
  source: "Dexcom Share",
});
const series = (from, to, fn) => {
  const out = [];
  for (let t = from; t <= to; t += 5 * 60000) {
    const r = fn(t);
    if (r !== undefined) out.push(typeof r === "object" ? r : reading(t, r));
  }
  return out;
};
const hourOf = (t) => (t / H) % 24;
/** Steady 200 before 9 PM, then down 100 over six hours; 150 through the day. */
const evening = (t) => {
  const h = hourOf(t);
  return h >= 15 && h < 21
    ? 200
    : h >= 21
      ? 200 - ((h - 21) * 100) / 6
      : h < 3
        ? 200 - ((h + 3) * 100) / 6
        : 150;
};
const now = Date.parse("2026-09-26T21:00:00Z");
const tenDays = now - 10 * 24 * H - 6 * H;

test("past days with a similar reading at this time give the spread of what followed", () => {
  const cgm = series(tenDays, now, (t) => Math.round(evening(t)));
  const estimate = similarDays(cgm, now, "UTC");
  assert.equal(estimate.state, "ready");
  assert.equal(estimate.value, 200);
  assert.equal(estimate.trend, "steady");
  assert.equal(estimate.matched, 10);
  // Six hours in 15-minute steps, from now.
  assert.equal(estimate.points.length, 25);
  assert.equal(estimate.points[0].at, "2026-09-26T21:00:00.000Z");
  assert.equal(estimate.points[12].p50, 150);
  assert.equal(estimate.points[12].days, 10);
  assert.deepEqual(similarDaysOutside(estimate, 110, 180), { below: 10, above: 10 });
});

test("days with a different value or trend at this time are not compared", () => {
  // On odd days the evening runs 80 higher; on day 2 it is falling through 9 PM instead of steady.
  const shifted = (t) => {
    const day = Math.floor((now - t) / (24 * H) + 0.75);
    const h = hourOf(t);
    if (day === 2 && h >= 20.5 && h < 22) return Math.round(240 - (h - 20.5) * 80);
    return Math.round(evening(t) + (day % 2 ? 80 : 0));
  };
  const estimate = similarDays(series(tenDays, now, shifted), now, "UTC");
  // Days 2, 4, 6, 8 and 10 are even, but day 2 was falling.
  assert.equal(estimate.state, "too-few");
  assert.equal(estimate.matched, 4);
});

test("a stale, missing, or HIGH current reading gives no estimate", () => {
  const cgm = series(tenDays, now - 20 * 60000, (t) => Math.round(evening(t)));
  assert.equal(similarDays(cgm, now, "UTC").state, "no-reading");
  assert.equal(similarDays([], now, "UTC").state, "no-reading");
  const high = [...cgm, reading(now, null, "High")];
  assert.equal(similarDays(high, now, "UTC").state, "no-reading");
});

test("HIGH readings that followed stay HIGH instead of becoming a number", () => {
  const cgm = series(tenDays, now, (t) => {
    const h = hourOf(t);
    return h >= 22 && h < 23 ? reading(t, null, "High") : Math.round(evening(t));
  });
  const estimate = similarDays(cgm, now, "UTC");
  const eleven = estimate.points.find((p) => p.at === "2026-09-26T22:30:00.000Z");
  assert.equal(eleven.p90, "High");
  assert.equal(estimateLabel(eleven.p90), "HIGH");
  assert.deepEqual(similarDaysOutside(estimate, 110, 400), { below: 10, above: 10 });
});

test("matching follows the local clock across a daylight saving change", () => {
  // Chicago falls back on Nov 1; 9 PM CST is 03:00Z, 9 PM CDT the days before is 02:00Z.
  const tz = "America/Chicago";
  const local = (t) =>
    Number(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(
        t,
      ),
    );
  const at = Date.parse("2026-11-04T03:00:00Z");
  const cgm = series(at - 10 * 24 * H, at, (t) => (local(t) === 21 ? 200 : 120));
  const estimate = similarDays(cgm, at, tz);
  assert.equal(estimate.state, "ready");
  assert.equal(estimate.matched, 9);
});

test("each past day contributes its reading closest to tonight's value, so the spread starts there", () => {
  // Tonight is steady at 200. Past evenings are steady at 225 until 9:10 PM, then steady at 205:
  // the closest time is 225 at 9 PM, the closest value is 205 at 9:25 PM.
  const cgm = series(tenDays, now, (t) => {
    const h = hourOf(t);
    if (now - t < 3 * H) return 200;
    return h >= 18 && h < 21 + 10 / 60 ? 225 : h >= 21 + 10 / 60 ? 205 : 150;
  });
  const estimate = similarDays(cgm, now, "UTC");
  assert.equal(estimate.state, "ready");
  assert.equal(estimate.points[0].p50, 205);
});
