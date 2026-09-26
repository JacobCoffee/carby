import type { CgmReading, Entry } from "./care";
import { dateKey, fromLocal } from "./care";
import { uniqueCgm } from "./cgm-metrics";

export type InsightDays = 7 | 14 | 30;
export type InsightQuality = "adequate" | "short-window" | "sparse";
export type InsightDaypart = "Overnight" | "Morning" | "Afternoon" | "Evening";

export type InsightCoverage = {
  observedMinutes: number;
  possibleMinutes: number;
  percent: number;
  uniqueReadings: number;
  numericReadings: number;
  highStatuses: number;
  lowStatuses: number;
  quality: InsightQuality;
};

export type InsightGlucose = {
  inRangePercent: number | null;
  below70Percent: number | null;
  above180Percent: number | null;
  above250Percent: number | null;
  mean: number | null;
};

export type InsightDay = InsightGlucose & {
  day: string;
  coveragePercent: number;
  observedMinutes: number;
  possibleMinutes: number;
  carbs: number;
  lowTreatmentCarbs: number;
  mealCount: number;
  snackCount: number;
  rapidUnits: number;
  basalUnits: number;
};

export type InsightTimeOfDay = InsightGlucose & {
  label: InsightDaypart;
  coveragePercent: number;
  observedMinutes: number;
  possibleMinutes: number;
};

export type InsightFood = {
  name: string;
  count: number;
  lastAt: string;
};

export type InsightsSummary = {
  period: { days: InsightDays; startDay: string; endDay: string };
  coverage: InsightCoverage;
  glucose: InsightGlucose;
  daily: InsightDay[];
  timeOfDay: InsightTimeOfDay[];
  topFoods: InsightFood[];
  topSnacks: InsightFood[];
  foodIdentification: {
    totalFoodEntries: number;
    identifiedEntries: number;
    unidentifiedEntries: number;
    inferredEntries: number;
  };
  trend: {
    previousCoveragePercent: number;
    currentInRangePercent: number | null;
    previousInRangePercent: number | null;
    deltaInRangePoints: number | null;
    comparable: boolean;
    reason: string | null;
  };
};

type Observed = {
  possibleMinutes: number;
  observedMinutes: number;
  inRangeMinutes: number;
  below70Minutes: number;
  above180Minutes: number;
  above250Minutes: number;
  statusMinutes: number;
  numericMinutes: number;
  numericValueMinutes: number;
};

type Bin = { day: string; label: InsightDaypart; start: number; end: number; observed: Observed };

const dayparts: { label: InsightDaypart; fromHour: number; toHour: number }[] = [
  { label: "Overnight", fromHour: 0, toHour: 6 },
  { label: "Morning", fromHour: 6, toHour: 12 },
  { label: "Afternoon", fromHour: 12, toHour: 18 },
  { label: "Evening", fromHour: 18, toHour: 24 },
];

const mealLabels = new Set(["Breakfast", "Lunch", "Dinner", "Meal"]);
const snackLabels = new Set([
  "Snack",
  "Morning snack",
  "Afternoon snack",
  "Evening snack",
  "Overnight",
]);

function emptyObserved(possibleMinutes = 0): Observed {
  return {
    possibleMinutes,
    observedMinutes: 0,
    inRangeMinutes: 0,
    below70Minutes: 0,
    above180Minutes: 0,
    above250Minutes: 0,
    statusMinutes: 0,
    numericMinutes: 0,
    numericValueMinutes: 0,
  };
}

function addObserved(target: Observed, source: Observed): void {
  target.possibleMinutes += source.possibleMinutes;
  target.observedMinutes += source.observedMinutes;
  target.inRangeMinutes += source.inRangeMinutes;
  target.below70Minutes += source.below70Minutes;
  target.above180Minutes += source.above180Minutes;
  target.above250Minutes += source.above250Minutes;
  target.statusMinutes += source.statusMinutes;
  target.numericMinutes += source.numericMinutes;
  target.numericValueMinutes += source.numericValueMinutes;
}

function addReadingMinutes(target: Observed, reading: CgmReading, minutes: number): void {
  target.observedMinutes += minutes;
  if (reading.value === null) {
    target.statusMinutes += minutes;
    if (reading.status === "High") {
      target.above180Minutes += minutes;
      target.above250Minutes += minutes;
    } else if (reading.status === "Low") {
      target.below70Minutes += minutes;
    }
    return;
  }
  const value = reading.value;
  target.numericMinutes += minutes;
  target.numericValueMinutes += value * minutes;
  if (value < 70) target.below70Minutes += minutes;
  else if (value <= 180) target.inRangeMinutes += minutes;
  else {
    target.above180Minutes += minutes;
    if (value > 250) target.above250Minutes += minutes;
  }
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function sufficientCoverage(observed: Observed): boolean {
  return observed.possibleMinutes > 0 && observed.observedMinutes / observed.possibleMinutes >= 0.7;
}

/** An observed fraction is shown only if the requested interval has enough CGM coverage. */
function glucoseMetrics(observed: Observed): InsightGlucose {
  if (!sufficientCoverage(observed)) {
    return {
      inRangePercent: null,
      below70Percent: null,
      above180Percent: null,
      above250Percent: null,
      mean: null,
    };
  }
  const fraction = (minutes: number) => percentage(minutes, observed.observedMinutes);
  return {
    inRangePercent: fraction(observed.inRangeMinutes),
    below70Percent: fraction(observed.below70Minutes),
    above180Percent: fraction(observed.above180Minutes),
    above250Percent: fraction(observed.above250Minutes),
    // HIGH/LOW are not numbers. A numeric-only mean would misrepresent this period.
    mean:
      observed.statusMinutes === 0 && observed.numericMinutes > 0
        ? Math.round(observed.numericValueMinutes / observed.numericMinutes)
        : null,
  };
}

function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function atLocalHour(day: string, hour: number, timezone: string): number {
  const nextDay = hour === 24 ? shiftDay(day, 1) : day;
  const hh = hour === 24 ? "00" : String(hour).padStart(2, "0");
  return Date.parse(fromLocal(`${nextDay}T${hh}:00`, timezone));
}

function makeBins(startDay: string, days: number, end: number, timezone: string): Bin[] {
  const bins: Bin[] = [];
  for (let index = 0; index < days; index++) {
    const day = shiftDay(startDay, index);
    for (const part of dayparts) {
      const start = atLocalHour(day, part.fromHour, timezone);
      const stop = Math.min(atLocalHour(day, part.toHour, timezone), end);
      if (stop > start)
        bins.push({
          day,
          label: part.label,
          start,
          end: stop,
          observed: emptyObserved((stop - start) / 60_000),
        });
    }
  }
  return bins;
}

/** Assign only pairs at most ten minutes apart, matching the report's CGM gap rule. */
function collectObserved(bins: Bin[], points: CgmReading[]): void {
  let binIndex = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const reading = points[index];
    const first = Date.parse(reading.at);
    const last = Date.parse(points[index + 1].at);
    const intervalMinutes = (last - first) / 60_000;
    if (intervalMinutes <= 0 || intervalMinutes > 10) continue;
    while (binIndex < bins.length && bins[binIndex].end <= first) binIndex++;
    for (let current = binIndex; current < bins.length && bins[current].start < last; current++) {
      const overlap = Math.min(last, bins[current].end) - Math.max(first, bins[current].start);
      if (overlap > 0) addReadingMinutes(bins[current].observed, reading, overlap / 60_000);
    }
  }
}

/** Summarize a complete calendar-day window for a like-for-like prior-period trend. */
function periodObserved(start: number, end: number, points: CgmReading[]): Observed {
  const result = emptyObserved((end - start) / 60_000);
  for (let index = 0; index < points.length - 1; index++) {
    const first = Date.parse(points[index].at);
    const last = Date.parse(points[index + 1].at);
    if (last <= start || first >= end) continue;
    const intervalMinutes = (last - first) / 60_000;
    if (intervalMinutes <= 0 || intervalMinutes > 10) continue;
    const overlap = Math.min(last, end) - Math.max(first, start);
    if (overlap > 0) addReadingMinutes(result, points[index], overlap / 60_000);
  }
  return result;
}

/** Parse only the food builder's itemized note format; arbitrary prose remains unidentified. */
export function identifiedFoodNames(note: string): string[] {
  const names = new Map<string, string>();
  for (const item of note.split(";")) {
    const colon = item.indexOf(":");
    if (colon < 1 || colon > 100) continue;
    const name = item.slice(0, colon).trim().replace(/\s+/g, " ");
    const portion = item.slice(colon + 1);
    if (!name || !/[×]/u.test(portion) || !/\b\d+(?:\.\d+)?\s*g\s+per\s+/iu.test(portion)) continue;
    const key = name.toLocaleLowerCase("en-US");
    if (key !== "food") names.set(key, name);
  }
  return [...names.values()];
}

function rankedFoods(counts: Map<string, InsightFood>): InsightFood[] {
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Produce descriptive insights from the loaded log, without using these data for dosing. */
export function computeInsights(
  days: InsightDays,
  entries: Entry[],
  cgm: CgmReading[],
  timezone: string,
  now: Date,
): InsightsSummary {
  const endDay = dateKey(now, timezone);
  const startDay = shiftDay(endDay, 1 - days);
  const start = atLocalHour(startDay, 0, timezone);
  const end = now.getTime();
  const allPoints = uniqueCgm(cgm);
  const bins = makeBins(startDay, days, end, timezone);
  collectObserved(bins, allPoints);

  const observed = emptyObserved();
  for (const bin of bins) addObserved(observed, bin.observed);
  const periodPoints = allPoints.filter((point) => {
    const at = Date.parse(point.at);
    return at >= start && at < end;
  });
  const coveragePercent = percentage(observed.observedMinutes, observed.possibleMinutes);

  const daily: InsightDay[] = Array.from({ length: days }, (_, index) => ({
    day: shiftDay(startDay, index),
    coveragePercent: 0,
    observedMinutes: 0,
    possibleMinutes: 0,
    inRangePercent: null,
    below70Percent: null,
    above180Percent: null,
    above250Percent: null,
    mean: null,
    carbs: 0,
    lowTreatmentCarbs: 0,
    mealCount: 0,
    snackCount: 0,
    rapidUnits: 0,
    basalUnits: 0,
  }));
  const dailyMap = new Map(daily.map((row) => [row.day, row]));
  const dailyObserved = new Map(daily.map((row) => [row.day, emptyObserved()]));
  const timeOfDay = dayparts.map(
    (part) =>
      ({
        label: part.label,
        coveragePercent: 0,
        observedMinutes: 0,
        possibleMinutes: 0,
        inRangePercent: null,
        below70Percent: null,
        above180Percent: null,
        above250Percent: null,
        mean: null,
      }) satisfies InsightTimeOfDay,
  );
  const daypartObserved = new Map(dayparts.map((part) => [part.label, emptyObserved()]));

  for (const bin of bins) {
    addObserved(dailyObserved.get(bin.day)!, bin.observed);
    addObserved(daypartObserved.get(bin.label)!, bin.observed);
  }
  for (const row of daily) {
    const data = dailyObserved.get(row.day)!;
    row.coveragePercent = percentage(data.observedMinutes, data.possibleMinutes);
    row.observedMinutes = Math.round(data.observedMinutes);
    row.possibleMinutes = Math.round(data.possibleMinutes);
    Object.assign(row, glucoseMetrics(data));
  }
  for (const row of timeOfDay) {
    const data = daypartObserved.get(row.label)!;
    row.coveragePercent = percentage(data.observedMinutes, data.possibleMinutes);
    row.observedMinutes = Math.round(data.observedMinutes);
    row.possibleMinutes = Math.round(data.possibleMinutes);
    Object.assign(row, glucoseMetrics(data));
  }

  const foodCounts = new Map<string, InsightFood>();
  const snackCounts = new Map<string, InsightFood>();
  let totalFoodEntries = 0;
  let identifiedEntries = 0;
  let inferredEntries = 0;
  for (const entry of entries) {
    const at = Date.parse(entry.at);
    if (at < start || at >= end) continue;
    const row = dailyMap.get(dateKey(new Date(at), timezone));
    if (!row) continue;
    if (entry.kind === "insulin") {
      if (entry.insulin === "Rapid-acting") row.rapidUnits += entry.units ?? 0;
      else if (entry.insulin === "Long-acting") row.basalUnits += entry.units ?? 0;
      continue;
    }
    if (entry.kind !== "food") continue;
    row.carbs += entry.carbs ?? 0;
    if (entry.meal === "Low treatment") {
      row.lowTreatmentCarbs += entry.carbs ?? 0;
      continue;
    }
    if (mealLabels.has(entry.meal ?? "")) row.mealCount++;
    if (snackLabels.has(entry.meal ?? "")) row.snackCount++;
    totalFoodEntries++;
    const structuredNames = new Map<string, string>();
    for (const item of entry.foodItems ?? []) {
      const name = item.name.trim().replace(/\s+/g, " ");
      const key = name.toLocaleLowerCase("en-US");
      if (name && key !== "unspecified food") structuredNames.set(key, name);
    }
    const names =
      entry.foodItems === undefined
        ? identifiedFoodNames(entry.note)
        : [...structuredNames.values()];
    if (names.length) identifiedEntries++;
    if (names.length && entry.foodItems === undefined) inferredEntries++;
    for (const name of names) {
      const key = name.toLocaleLowerCase("en-US");
      for (const counts of [
        foodCounts,
        ...(snackLabels.has(entry.meal ?? "") ? [snackCounts] : []),
      ]) {
        const previous = counts.get(key);
        counts.set(key, {
          name: previous?.name ?? name,
          count: (previous?.count ?? 0) + 1,
          lastAt: previous && previous.lastAt > entry.at ? previous.lastAt : entry.at,
        });
      }
    }
  }

  // Compare completed local days. Today's partial day is excluded from both sides.
  const currentStartDay = shiftDay(endDay, -days);
  const previousStartDay = shiftDay(endDay, -2 * days);
  const previousStart = atLocalHour(previousStartDay, 0, timezone);
  const currentStart = atLocalHour(currentStartDay, 0, timezone);
  const todayStart = atLocalHour(endDay, 0, timezone);
  const currentPeriod = periodObserved(currentStart, todayStart, allPoints);
  const previousPeriod = periodObserved(previousStart, currentStart, allPoints);
  const previousCoveragePercent = percentage(
    previousPeriod.observedMinutes,
    previousPeriod.possibleMinutes,
  );
  const comparable = sufficientCoverage(currentPeriod) && sufficientCoverage(previousPeriod);
  const currentInRangePercent = glucoseMetrics(currentPeriod).inRangePercent;
  const previousInRangePercent = glucoseMetrics(previousPeriod).inRangePercent;
  const reason = comparable
    ? null
    : days === 30 && !sufficientCoverage(previousPeriod)
      ? "A previous 30-day comparison needs 60 complete days with at least 70% observed CGM time in each window."
      : !sufficientCoverage(previousPeriod)
        ? `The preceding ${days} complete days have less than 70% observed CGM time.`
        : `The latest ${days} complete days have less than 70% observed CGM time.`;

  return {
    period: { days, startDay, endDay },
    coverage: {
      observedMinutes: Math.round(observed.observedMinutes),
      possibleMinutes: Math.round(observed.possibleMinutes),
      percent: coveragePercent,
      uniqueReadings: periodPoints.length,
      numericReadings: periodPoints.filter((point) => point.value !== null).length,
      highStatuses: periodPoints.filter((point) => point.status === "High").length,
      lowStatuses: periodPoints.filter((point) => point.status === "Low").length,
      quality: !sufficientCoverage(observed) ? "sparse" : days < 14 ? "short-window" : "adequate",
    },
    glucose: glucoseMetrics(observed),
    daily,
    timeOfDay,
    topFoods: rankedFoods(foodCounts),
    topSnacks: rankedFoods(snackCounts),
    foodIdentification: {
      totalFoodEntries,
      identifiedEntries,
      unidentifiedEntries: totalFoodEntries - identifiedEntries,
      inferredEntries,
    },
    trend: {
      previousCoveragePercent,
      currentInRangePercent,
      previousInRangePercent,
      deltaInRangePoints:
        comparable && currentInRangePercent !== null && previousInRangePercent !== null
          ? currentInRangePercent - previousInRangePercent
          : null,
      comparable,
      reason,
    },
  };
}
