import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  MIN_ZOOM_MINUTES,
  TIME_LABEL_PX,
  chartZoom,
  timeLabelCount,
  zoomAround,
} from "../lib/chart-window.ts";

test("a dragged stretch becomes the zoom in either direction, widened to the minimum", () => {
  assert.deepEqual(chartZoom(600, 480, 1440, 1440), { start: 480, end: 600 });
  // A 4-minute drag at 10:00 opens a 15-minute window centred on it.
  assert.deepEqual(chartZoom(598, 602, 1440, 1440), { start: 592.5, end: 607.5 });
  assert.equal(MIN_ZOOM_MINUTES, 15);
});

test("a zoom stays inside the period and ends when it is as wide as the unzoomed chart", () => {
  // Panning past either edge keeps the width and stops at the edge.
  assert.deepEqual(chartZoom(-60, 60, 1440, 1440), { start: 0, end: 120 });
  assert.deepEqual(chartZoom(1400, 1520, 1440, 1440), { start: 1320, end: 1440 });
  // A 12-hour view zoomed out to 12 hours or more is simply the 12-hour view again.
  assert.equal(chartZoom(0, 720, 1440, 720), null);
  assert.deepEqual(chartZoom(0, 719, 1440, 720), { start: 0, end: 719 });
});

test("zooming around a minute keeps that minute in the same place on screen", () => {
  const zoom = { start: 400, end: 800 };
  // 500 sits a quarter of the way across before and after.
  assert.deepEqual(zoomAround(zoom, 500, 0.5, 1440, 1440), { start: 450, end: 650 });
  assert.deepEqual(zoomAround(zoom, 500, 2, 1440, 1440), { start: 300, end: 1100 });
  assert.equal(zoomAround(zoom, 500, 4, 1440, 1440), null);
});

test("a narrow chart gets fewer time labels, so neighbours never overlap", () => {
  // A phone-width day chart (about 240px of plot) fits three: midnight, noon, midnight.
  assert.equal(timeLabelCount(240, 5), 3);
  // A desktop one keeps all five, every six hours.
  assert.equal(timeLabelCount(700, 5), 5);
  assert.equal(timeLabelCount(700, 4), 4);
  // Never fewer than the two ends, even when they barely fit.
  assert.equal(timeLabelCount(100, 5), 2);
  // Each gap leaves room for an edge label beside half of the next.
  for (const span of [150, 240, 300, 420, 560, 900]) {
    const n = timeLabelCount(span, 5);
    if (n > 2) assert.ok(span / (n - 1) >= TIME_LABEL_PX * 1.5);
  }
});
