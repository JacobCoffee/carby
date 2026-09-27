import { test } from "bun:test";
import assert from "node:assert/strict";
import { estimateLabel, glucoseEstimate } from "../lib/glucose-estimate.ts";

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
    const v = fn(t);
    out.push(typeof v === "object" ? v : reading(t, v));
  }
  return out;
};
/** Repeatable noise in [-1, 1]. */
const noise = (t) => {
  const x = Math.sin(t / 60000) * 10000;
  return (x - Math.floor(x)) * 2 - 1;
};
/** Slow waves between about 80 and 280, with noise: rises and falls that carry on, then turn. */
const waves = (t) => Math.round(180 + 100 * Math.sin((2 * Math.PI * t) / (5 * H)) + 8 * noise(t));
const now = Date.parse("2026-09-26T22:00:00Z");
const days = (n) => now - n * 24 * H;
/** A moment `hours` into the last full wave before now. */
const intoWave = (hours) => now - (now % (5 * H)) - 5 * H + hours * H;

test("the estimate starts at the current reading, not at what past days read at this time", () => {
  // Every past evening ran near 350; tonight is steady at 140.
  const cgm = series(days(4), now, (t) =>
    now - t < 2 * H ? 140 : (t / H) % 24 >= 20 ? 350 + Math.round(4 * noise(t)) : 150,
  );
  const estimate = glucoseEstimate(cgm, now);
  assert.equal(estimate.state, "ready");
  assert.equal(estimate.points[0].median, 140);
  assert.ok(Math.abs(estimate.points[1].median - 140) <= 10, `${estimate.points[1].median}`);
});

test("a fall under way continues in the estimate, and the range widens further ahead", () => {
  const cgm = series(days(4), now, waves);
  const falling = intoWave(2.1); // past the peak, heading down
  const estimate = glucoseEstimate(
    cgm.filter((r) => Date.parse(r.at) <= falling),
    falling,
  );
  assert.equal(estimate.state, "ready");
  const [start, half, end] = [estimate.points[0], estimate.points[2], estimate.points.at(-1)];
  assert.equal(end.minutes, 120);
  assert.ok(half.median < start.median - 10, `${start.median} → ${half.median}`);
  assert.ok(end.high - end.low > half.high - half.low);
  for (const p of estimate.points) assert.ok(p.low <= p.median && p.median <= p.high);
});

test("with too little history the estimate waits instead of guessing", () => {
  const estimate = glucoseEstimate(series(now - 10 * H, now, waves), now);
  assert.equal(estimate.state, "learning");
  assert.ok(estimate.examples < 200);
});

test("a stale, HIGH, or unbroken-hour-missing current reading gives no estimate", () => {
  const cgm = series(days(4), now, waves);
  assert.equal(glucoseEstimate(cgm, now + 20 * 60000).state, "no-reading");
  assert.equal(glucoseEstimate([], now).state, "no-reading");
  assert.equal(
    glucoseEstimate([...cgm, reading(now + 60000, null, "High")], now + 60000).state,
    "no-reading",
  );
  const gap = cgm.filter((r) => {
    const t = Date.parse(r.at);
    return t < now - 60 * 60000 || t > now - 20 * 60000;
  });
  assert.equal(glucoseEstimate(gap, now).state, "no-reading");
});

test("HIGH readings count as the sensor limit, so the range tops out at HIGH", () => {
  // Waves that clip at HIGH near every peak.
  const cgm = series(days(4), now, (t) => {
    const v = waves(t) + 150;
    return v > 400 ? reading(t, null, "High") : v;
  });
  const rising = intoWave(0.4);
  const estimate = glucoseEstimate(
    cgm.filter((r) => Date.parse(r.at) <= rising),
    rising,
  );
  assert.equal(estimate.state, "ready");
  const end = estimate.points.at(-1);
  assert.equal(end.high, 400);
  assert.equal(estimateLabel(end.high), "HIGH");
  assert.equal(estimateLabel(142), "142");
});

test("when the last day turns noisier, the range widens to its misses instead of averaging them away", () => {
  const history = (recentNoise) =>
    series(days(4), now, (t) =>
      Math.round(
        180 +
          100 * Math.sin((2 * Math.PI * t) / (5 * H)) +
          (now - t < 24 * H ? recentNoise : 8) * noise(t),
      ),
    );
  const width = (cgm) => {
    const estimate = glucoseEstimate(cgm, now);
    assert.equal(estimate.state, "ready");
    return estimate.points[2].high - estimate.points[2].low;
  };
  // Averaged over all four days the noisy day would only widen the 30-minute range by half.
  assert.ok(
    width(history(30)) >= 2.5 * width(history(8)),
    `${width(history(30))} vs ${width(history(8))}`,
  );
});
