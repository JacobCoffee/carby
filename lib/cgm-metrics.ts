import type { CgmReading } from "./care";

export type CgmSummary = {
  observedMinutes: number;
  possibleMinutes: number;
  coveragePercent: number;
  inRangePercent: number | null;
  below70Percent: number | null;
  above180Percent: number | null;
  above250Percent: number | null;
  /** Time in the plan's own glucose range, only computed when a range is passed to summarizeCgm. */
  inPlanRangePercent: number | null;
  average: number | null;
  uniqueReadings: number;
  numericReadings: number;
  highStatuses: number;
  lowStatuses: number;
  longestGapMinutes: number;
};

/** Choose one value per instant, preferring an exact value over an out-of-range status. */
export function uniqueCgm(readings: CgmReading[]): CgmReading[] {
  const byTime = new Map<string, CgmReading>();
  for (const reading of readings) {
    const previous = byTime.get(reading.at);
    if (
      !previous ||
      (previous.value === null && reading.value !== null) ||
      ((previous.value === reading.value || (previous.value !== null && reading.value !== null)) &&
        previous.source === "Dexcom Share" &&
        reading.source === "Dexcom Clarity")
    ) {
      byTime.set(reading.at, reading);
    }
  }
  const points = [...byTime.values()].sort((a, b) => a.at.localeCompare(b.at));
  // Older CSV imports discarded seconds. Hide a rounded copy only when a
  // precise point in that minute has the same actual value or status.
  const preciseByMinute = new Map<string, CgmReading[]>();
  for (const point of points) {
    if (Date.parse(point.at) % 60000 === 0) continue;
    const key = point.at.slice(0, 16);
    preciseByMinute.set(key, [...(preciseByMinute.get(key) ?? []), point]);
  }
  return points.filter((point) => {
    if (point.source !== "Dexcom Clarity" || Date.parse(point.at) % 60000 !== 0) return true;
    return !(preciseByMinute.get(point.at.slice(0, 16)) ?? []).some(
      (other) => other.value === point.value && other.status === point.status,
    );
  });
}

/**
 * Summarize observed CGM intervals. Gaps over ten minutes remain unobserved.
 * The value at the start of each observed interval represents that interval;
 * values are never extrapolated through a gap or beyond the latest reading.
 */
export function summarizeCgm(
  readings: CgmReading[],
  start: string,
  end: string,
  range?: { low: number; high: number },
): CgmSummary {
  const startMs = Date.parse(start),
    endMs = Date.parse(end),
    points = uniqueCgm(readings).filter(
      (r) => Date.parse(r.at) >= startMs && Date.parse(r.at) <= endMs,
    );
  const possibleMinutes = Math.max(0, (endMs - startMs) / 60000);
  let observedMinutes = 0,
    inRange = 0,
    inPlanRange = 0,
    below70 = 0,
    above180 = 0,
    above250 = 0,
    longestGapMinutes = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const minutes = (Date.parse(points[i + 1].at) - Date.parse(points[i].at)) / 60000;
    longestGapMinutes = Math.max(longestGapMinutes, minutes);
    if (minutes <= 0 || minutes > 10) continue;
    observedMinutes += minutes;
    const r = points[i],
      v = r.value;
    if (v === null) {
      if (r.status === "Low") below70 += minutes;
      else if (r.status === "High") {
        above180 += minutes;
        above250 += minutes;
      }
    } else if (v < 70) below70 += minutes;
    else if (v <= 180) inRange += minutes;
    else {
      above180 += minutes;
      if (v > 250) above250 += minutes;
    }
    if (range) {
      if (v !== null && v >= range.low && v <= range.high) inPlanRange += minutes;
    }
  }
  const numeric = points.filter((r) => r.value !== null);
  const percent = (value: number) =>
    observedMinutes ? Math.round((value / observedMinutes) * 100) : null;
  return {
    observedMinutes: Math.round(observedMinutes),
    possibleMinutes: Math.round(possibleMinutes),
    coveragePercent: possibleMinutes
      ? Math.min(100, Math.round((observedMinutes / possibleMinutes) * 100))
      : 0,
    inRangePercent: percent(inRange),
    below70Percent: percent(below70),
    above180Percent: percent(above180),
    above250Percent: percent(above250),
    inPlanRangePercent: range ? percent(inPlanRange) : null,
    average: numeric.length
      ? Math.round(numeric.reduce((sum, r) => sum + r.value!, 0) / numeric.length)
      : null,
    uniqueReadings: points.length,
    numericReadings: numeric.length,
    highStatuses: points.filter((r) => r.status === "High").length,
    lowStatuses: points.filter((r) => r.status === "Low").length,
    longestGapMinutes: Math.round(longestGapMinutes),
  };
}
