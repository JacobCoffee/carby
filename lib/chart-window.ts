import { fromLocal } from "./care";

export type ChartRange = "day" | "12h" | "6h" | "3d" | "7d" | "14d" | "30d";
export const chartRangeDays: Record<ChartRange, number> = {
  day: 1,
  "12h": 1,
  "6h": 1,
  "3d": 3,
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

function addDays(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/**
 * Inclusive local calendar days ending on `lastDay`. `end` is the following local midnight and is
 * exclusive. Real instants keep 23-hour and 25-hour days, including both copies of a repeated hour.
 */
export function chartDaysWindow(
  lastDay: string,
  count: number,
  timezone: string,
): { start: number; end: number; days: { day: string; start: number }[] } {
  const days = Array.from({ length: Math.max(1, count) }, (_, i) => {
    const day = addDays(lastDay, i - Math.max(1, count) + 1);
    return { day, start: Date.parse(fromLocal(`${day}T00:00`, timezone)) };
  });
  return {
    start: days[0].start,
    end: Date.parse(fromLocal(`${addDays(lastDay, 1)}T00:00`, timezone)),
    days,
  };
}

/** Real day bounds keep both instances of a repeated local hour on the timeline. */
export function chartDayWindow(day: string, timezone: string): { start: number; end: number } {
  const { start, end } = chartDaysWindow(day, 1, timezone);
  return { start, end };
}

/** The narrowest zoom, in minutes: enough for a few CGM readings. */
export const MIN_ZOOM_MINUTES = 15;
/** A zoomed stretch of the chart, in minutes from the start of its period. */
export type ChartZoom = { start: number; end: number };

/**
 * A zoom covering minutes `a`–`b` (either order) inside a period of `total` minutes. It is widened
 * to MIN_ZOOM_MINUTES and slid back inside the period. Null means no zoom: the stretch is at least
 * `fullWidth`, the width the chart shows unzoomed.
 */
export function chartZoom(a: number, b: number, total: number, fullWidth: number) {
  const width = Math.max(MIN_ZOOM_MINUTES, Math.abs(b - a));
  if (width >= Math.min(fullWidth, total)) return null;
  const start = Math.min(Math.max(0, (a + b) / 2 - width / 2), total - width);
  return { start, end: start + width } satisfies ChartZoom;
}

/** Zoom by `factor` (below 1 zooms in) keeping minute `at` where it is on screen. */
export function zoomAround(
  zoom: ChartZoom,
  at: number,
  factor: number,
  total: number,
  fullWidth: number,
) {
  return chartZoom(
    at - (at - zoom.start) * factor,
    at + (zoom.end - at) * factor,
    total,
    fullWidth,
  );
}
