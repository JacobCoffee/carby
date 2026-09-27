import { STANDARD_GLUCOSE_RANGES, fromLocal, type CgmReading, type GlucoseRanges } from "./care";
import { uniqueCgm } from "./cgm-metrics";

/**
 * Descriptive CGM statistics on the international consensus definitions. Nothing here feeds
 * dosing. Gaps follow summarizeCgm: readings more than ten minutes apart leave the time between
 * them unobserved, and the value at the start of an interval stands for that interval.
 */
const MAX_GAP_MINUTES = 10;
/** Mean, SD, CV and GMI are hidden when more readings than this are only "High" or "Low". */
export const CAPPED_LIMIT_PERCENT = 5;
/** The consensus minimum for a representative AGP. */
export const AGP_MIN_DAYS = 14;
export const AGP_MIN_WEAR_PERCENT = 70;
const EPISODE_MINUTES = 15;

export const GLUCOSE_LEVELS = ["veryLow", "low", "inRange", "high", "veryHigh"] as const;
export type GlucoseLevel = (typeof GLUCOSE_LEVELS)[number];
/** A level's name as Dexcom Clarity words it. */
export const glucoseLevelNames: Record<GlucoseLevel, string> = {
  veryLow: "Very low",
  low: "Low",
  inRange: "In range",
  high: "High",
  veryHigh: "Very high",
};
/** Each level's name with the mg/dL values it covers under the given ranges. */
export function glucoseLevelRanges(ranges: GlucoseRanges): Record<GlucoseLevel, string> {
  const { veryLow, low, high, veryHigh } = ranges;
  return {
    veryLow: `below ${veryLow}`,
    low: `${veryLow}–${low - 1}`,
    inRange: `${low}–${high}`,
    high: `${high + 1}–${veryHigh}`,
    veryHigh: `above ${veryHigh}`,
  };
}
const standardRanges = glucoseLevelRanges(STANDARD_GLUCOSE_RANGES);
export const glucoseLevelLabels = Object.fromEntries(
  GLUCOSE_LEVELS.map((l) => [l, `${glucoseLevelNames[l]} (${standardRanges[l]})`]),
) as Record<GlucoseLevel, string>;
/** Percent of observed time in each standard level, to one decimal. */
export type GlucoseLevels = Record<GlucoseLevel, number>;

/**
 * A reading's level, on the consensus ranges unless others are given. "Low" and "High"
 * statuses are past the sensor's limits, which lie beyond any allowed range.
 */
export function glucoseLevel(
  reading: Pick<CgmReading, "value" | "status">,
  ranges: GlucoseRanges = STANDARD_GLUCOSE_RANGES,
): GlucoseLevel {
  const v = reading.value;
  if (v === null) return reading.status === "Low" ? "veryLow" : "veryHigh";
  return v < ranges.veryLow
    ? "veryLow"
    : v < ranges.low
      ? "low"
      : v <= ranges.high
        ? "inRange"
        : v <= ranges.veryHigh
          ? "high"
          : "veryHigh";
}

type Interval = { reading: CgmReading; at: number; until: number; minutes: number };

/** Sorted unique readings within [start, end]. */
function pointsWithin(readings: CgmReading[], start: number, end: number) {
  return uniqueCgm(readings).filter((r) => {
    const at = Date.parse(r.at);
    return at >= start && at <= end;
  });
}

/** Every observed interval, clipped so none runs past `end`. */
function observedIntervals(points: CgmReading[], end: number): Interval[] {
  const intervals: Interval[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const at = Date.parse(points[i].at),
      next = Math.min(Date.parse(points[i + 1].at), end),
      minutes = (next - at) / 60000;
    if (minutes > 0 && minutes <= MAX_GAP_MINUTES)
      intervals.push({ reading: points[i], at, until: next, minutes });
  }
  return intervals;
}

const tenth = (value: number) => Math.round(value * 10) / 10;

function levelPercents(minutes: Record<GlucoseLevel, number>, observed: number) {
  if (!observed) return null;
  return Object.fromEntries(
    GLUCOSE_LEVELS.map((level) => [level, tenth((minutes[level] / observed) * 100)]),
  ) as GlucoseLevels;
}

const emptyLevels = (): Record<GlucoseLevel, number> => ({
  veryLow: 0,
  low: 0,
  inRange: 0,
  high: 0,
  veryHigh: 0,
});

export type GlucoseMetrics = {
  possibleMinutes: number;
  observedMinutes: number;
  /** Observed share of the period, the consensus "time CGM is active". */
  wearPercent: number;
  /** Length of the period in days, to one decimal. */
  days: number;
  levels: GlucoseLevels | null;
  /** Time inside the care plan's own low–high range; only when a plan range is given. */
  inPlanRange: number | null;
  readings: number;
  /** Readings that are only "High" or "Low" and have no number. */
  capped: number;
  cappedPercent: number;
  mean: number | null;
  sd: number | null;
  /** Coefficient of variation, percent. */
  cv: number | null;
  /** Glucose management indicator, percent. */
  gmi: number | null;
  /** Why mean, SD, CV and GMI are null. */
  hiddenReason: "capped" | "no-readings" | null;
  /** Enough days and wear for the consensus AGP. */
  agpReady: boolean;
};

/** Consensus CGM metrics for readings between two instants. */
export function glucoseMetrics(
  readings: CgmReading[],
  start: string,
  end: string,
  planRange?: { low: number; high: number },
): GlucoseMetrics {
  const startMs = Date.parse(start),
    endMs = Date.parse(end),
    points = pointsWithin(readings, startMs, endMs);
  const minutes = emptyLevels();
  let observed = 0,
    inPlan = 0;
  for (const { reading, minutes: m } of observedIntervals(points, endMs)) {
    observed += m;
    minutes[glucoseLevel(reading)] += m;
    if (
      planRange &&
      reading.value !== null &&
      reading.value >= planRange.low &&
      reading.value <= planRange.high
    )
      inPlan += m;
  }
  const possible = Math.max(0, (endMs - startMs) / 60000);
  const numbers = points.flatMap((r) => (r.value === null ? [] : [r.value]));
  const capped = points.length - numbers.length;
  const cappedPercent = points.length ? tenth((capped / points.length) * 100) : 0;
  const hiddenReason = !numbers.length
    ? "no-readings"
    : cappedPercent > CAPPED_LIMIT_PERCENT
      ? "capped"
      : null;
  let mean: number | null = null,
    sd: number | null = null;
  if (!hiddenReason) {
    const m = numbers.reduce((sum, v) => sum + v, 0) / numbers.length;
    mean = m;
    sd = Math.sqrt(numbers.reduce((sum, v) => sum + (v - m) ** 2, 0) / numbers.length);
  }
  const wearPercent = possible ? Math.min(100, tenth((observed / possible) * 100)) : 0;
  const days = tenth(possible / 1440);
  return {
    possibleMinutes: Math.round(possible),
    observedMinutes: Math.round(observed),
    wearPercent,
    days,
    levels: levelPercents(minutes, observed),
    inPlanRange: planRange && observed ? tenth((inPlan / observed) * 100) : null,
    readings: points.length,
    capped,
    cappedPercent,
    mean: mean === null ? null : Math.round(mean),
    sd: sd === null ? null : Math.round(sd),
    cv: mean === null || sd === null || !mean ? null : tenth((sd / mean) * 100),
    // Bergenstal et al. 2018: GMI (%) = 3.31 + 0.02392 × mean glucose (mg/dL).
    gmi: mean === null ? null : tenth(3.31 + 0.02392 * mean),
    hiddenReason,
    agpReady: days >= AGP_MIN_DAYS && wearPercent >= AGP_MIN_WEAR_PERCENT,
  };
}

const minuteFormatters = new Map<string, Intl.DateTimeFormat>();
/**
 * Minute of the local day. Time zone offsets and transitions fall on quarter hours, so one
 * lookup per quarter hour serves every reading inside it.
 */
function localMinuteOfDay(timezone: string) {
  let formatter = minuteFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    minuteFormatters.set(timezone, formatter);
  }
  const format = formatter,
    quarters = new Map<number, number>();
  return (at: number) => {
    const quarter = Math.floor(at / 900000);
    let minute = quarters.get(quarter);
    if (minute === undefined) {
      const [hour, min] = format
        .format(new Date(quarter * 900000))
        .split(":")
        .map(Number);
      minute = hour * 60 + min;
      quarters.set(quarter, minute);
    }
    return minute + Math.floor((at - quarter * 900000) / 60000);
  };
}

/** A percentile is a number, or the sensor's "High"/"Low" when it falls on a capped reading. */
export type AgpValue = number | "High" | "Low";
export type AgpSlot = {
  /** Minutes after local midnight where this slot starts. */
  minute: number;
  readings: number;
  p5: AgpValue | null;
  p25: AgpValue | null;
  p50: AgpValue | null;
  p75: AgpValue | null;
  p95: AgpValue | null;
};
export const AGP_SLOT_MINUTES = 15;

/** Nearest-rank percentile over sort keys where Low (-Infinity) sorts first and High (Infinity) last. */
export function percentile(sorted: number[], p: number): AgpValue | null {
  if (!sorted.length) return null;
  const key =
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  return key === -Infinity ? "Low" : key === Infinity ? "High" : key;
}

/** Ambulatory glucose profile: percentiles of all readings by local time of day. */
export function agp(readings: CgmReading[], start: string, end: string, timezone: string) {
  const slots: number[][] = Array.from({ length: 1440 / AGP_SLOT_MINUTES }, () => []),
    minuteOf = localMinuteOfDay(timezone);
  for (const r of pointsWithin(readings, Date.parse(start), Date.parse(end))) {
    const minute = minuteOf(Date.parse(r.at));
    slots[Math.floor(minute / AGP_SLOT_MINUTES)].push(
      r.value ?? (r.status === "Low" ? -Infinity : Infinity),
    );
  }
  return slots.map((keys, i): AgpSlot => {
    keys.sort((a, b) => a - b);
    return {
      minute: i * AGP_SLOT_MINUTES,
      readings: keys.length,
      p5: percentile(keys, 5),
      p25: percentile(keys, 25),
      p50: percentile(keys, 50),
      p75: percentile(keys, 75),
      p95: percentile(keys, 95),
    };
  });
}

export type GlucoseEpisode = {
  kind: "low" | "high";
  /** Level 2: at least 15 consecutive minutes below 54 (low) or above 250 (high). */
  severe: boolean;
  start: string;
  end: string;
  minutes: number;
  /** Lowest (low) or highest (high) reading in the episode. */
  extreme: AgpValue;
  /** False when a sensor gap or the end of the data cut the episode off before recovery. */
  recovered: boolean;
};

/**
 * Episodes on the consensus rule: one begins after at least 15 consecutive observed minutes
 * below 70 (low) or above 180 (high), and ends where at least 15 consecutive minutes back
 * across that threshold begin.
 */
export function glucoseEpisodes(readings: CgmReading[], start: string, end: string) {
  const endMs = Date.parse(end),
    intervals = observedIntervals(pointsWithin(readings, Date.parse(start), endMs), endMs);
  const episodes: GlucoseEpisode[] = [];
  for (const kind of ["low", "high"] as const) {
    const beyond = (level: GlucoseLevel) =>
      kind === "low"
        ? level === "veryLow" || level === "low"
        : level === "high" || level === "veryHigh";
    const severeLevel: GlucoseLevel = kind === "low" ? "veryLow" : "veryHigh";
    const more = (a: number, b: number) => (kind === "low" ? Math.min(a, b) : Math.max(a, b));
    type Open = {
      start: number;
      extreme: number;
      severeRun: number;
      severe: boolean;
      back: number;
      backStart: number;
    };
    let runStart = 0,
      runMinutes = 0,
      runExtreme = 0,
      runSevere = 0,
      runSevereMax = 0,
      open: Open | null = null,
      previousEnd = -1;
    /** Close at `at`, or where a partial recovery began if one was under way. */
    const close = (at: number, recovered: boolean) => {
      if (!open) return;
      const endAt = !recovered && open.back ? open.backStart : at;
      episodes.push({
        kind,
        severe: open.severe,
        start: new Date(open.start).toISOString(),
        end: new Date(endAt).toISOString(),
        minutes: Math.round((endAt - open.start) / 60000),
        extreme:
          open.extreme === -Infinity ? "Low" : open.extreme === Infinity ? "High" : open.extreme,
        recovered,
      });
      open = null;
    };
    for (const { reading, at, until, minutes } of intervals) {
      if (previousEnd >= 0 && at !== previousEnd) {
        // A gap: nothing is known in between, so every run restarts.
        close(previousEnd, false);
        runMinutes = 0;
        runSevere = 0;
        runSevereMax = 0;
      }
      previousEnd = until;
      const level = glucoseLevel(reading),
        key = reading.value ?? (reading.status === "Low" ? -Infinity : Infinity);
      if (open) {
        if (beyond(level)) {
          open.back = 0;
          open.extreme = more(open.extreme, key);
          open.severeRun = level === severeLevel ? open.severeRun + minutes : 0;
          if (open.severeRun >= EPISODE_MINUTES) open.severe = true;
        } else {
          if (!open.back) open.backStart = at;
          open.back += minutes;
          open.severeRun = 0;
          if (open.back >= EPISODE_MINUTES) close(open.backStart, true);
        }
        continue;
      }
      if (!beyond(level)) {
        runMinutes = 0;
        runSevere = 0;
        runSevereMax = 0;
        continue;
      }
      if (!runMinutes) {
        runStart = at;
        runExtreme = key;
      }
      runMinutes += minutes;
      runExtreme = more(runExtreme, key);
      runSevere = level === severeLevel ? runSevere + minutes : 0;
      runSevereMax = Math.max(runSevereMax, runSevere);
      if (runMinutes >= EPISODE_MINUTES) {
        open = {
          start: runStart,
          extreme: runExtreme,
          severeRun: runSevere,
          severe: runSevereMax >= EPISODE_MINUTES,
          back: 0,
          backStart: 0,
        };
        runMinutes = 0;
      }
    }
    close(previousEnd, false);
  }
  return episodes.sort((a, b) => a.start.localeCompare(b.start));
}

export type DayGlucose = {
  day: string;
  wearPercent: number;
  levels: GlucoseLevels | null;
  /** Mean of numeric readings; null when none or when capped readings pass the limit. */
  mean: number | null;
};
export type WeekdayGlucose = {
  /** 0 = Sunday. */
  weekday: number;
  days: number;
  wearPercent: number;
  levels: GlucoseLevels | null;
};
export type MonthGlucose = {
  /** YYYY-MM. */
  month: string;
  /** Days of the month inside the summary so far. */
  days: number;
  wearPercent: number;
  levels: GlucoseLevels | null;
  readings: number;
  /** Mean of numeric readings; null when none or when capped readings pass the limit. */
  mean: number | null;
};

/** The day after a YYYY-MM-DD date. */
function nextDay(day: string) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

/** Per-day, per-weekday and per-month standard levels for inclusive local dates, cut off at `now`. */
export function glucoseByDay(
  readings: CgmReading[],
  startDay: string,
  endDay: string,
  timezone: string,
  now: number,
) {
  const days: string[] = [];
  for (let day = startDay; day <= endDay; day = nextDay(day)) days.push(day);
  const bounds = days.map((day) => [
    Date.parse(fromLocal(`${day}T00:00`, timezone)),
    Math.min(now, Date.parse(fromLocal(`${nextDay(day)}T00:00`, timezone))),
  ]);
  const first = bounds[0]?.[0] ?? 0,
    last = bounds.at(-1)?.[1] ?? 0;
  const perDay = days.map(() => ({
    minutes: emptyLevels(),
    observed: 0,
    sum: 0,
    count: 0,
    capped: 0,
  }));
  const points = pointsWithin(readings, first, last);
  let d = 0;
  const dayOf = (at: number) => {
    while (d < bounds.length - 1 && at >= bounds[d][1]) d++;
    return at >= bounds[d][0] && at < bounds[d][1] ? d : -1;
  };
  for (const r of points) {
    const i = dayOf(Date.parse(r.at));
    if (i < 0) continue;
    if (r.value === null) perDay[i].capped++;
    else {
      perDay[i].sum += r.value;
      perDay[i].count++;
    }
  }
  d = 0;
  for (const { reading, at, minutes } of observedIntervals(points, last)) {
    const i = dayOf(at);
    if (i < 0) continue;
    // An interval that crosses midnight stays with the day it started in.
    perDay[i].observed += minutes;
    perDay[i].minutes[glucoseLevel(reading)] += minutes;
  }
  const possible = bounds.map(([s, e]) => Math.max(0, (e - s) / 60000));
  const daily: DayGlucose[] = days.map((day, i) => {
    const t = perDay[i],
      all = t.count + t.capped;
    return {
      day,
      wearPercent: possible[i] ? Math.min(100, tenth((t.observed / possible[i]) * 100)) : 0,
      levels: levelPercents(t.minutes, t.observed),
      mean:
        t.count && (t.capped / all) * 100 <= CAPPED_LIMIT_PERCENT
          ? Math.round(t.sum / t.count)
          : null,
    };
  });
  const weekdays: WeekdayGlucose[] = Array.from({ length: 7 }, (_, weekday) => {
    const minutes = emptyLevels();
    let observed = 0,
      possibleTotal = 0,
      count = 0;
    days.forEach((day, i) => {
      if (new Date(`${day}T00:00:00Z`).getUTCDay() !== weekday || !possible[i]) return;
      count++;
      possibleTotal += possible[i];
      observed += perDay[i].observed;
      for (const level of GLUCOSE_LEVELS) minutes[level] += perDay[i].minutes[level];
    });
    return {
      weekday,
      days: count,
      wearPercent: possibleTotal ? Math.min(100, tenth((observed / possibleTotal) * 100)) : 0,
      levels: levelPercents(minutes, observed),
    };
  });
  // Days arrive in order, so each month's days are contiguous.
  const monthTotals: {
    month: string;
    days: number;
    possible: number;
    t: (typeof perDay)[number];
  }[] = [];
  days.forEach((day, i) => {
    if (!possible[i]) return;
    const month = day.slice(0, 7);
    let m = monthTotals.at(-1);
    if (m?.month !== month) {
      m = {
        month,
        days: 0,
        possible: 0,
        t: { minutes: emptyLevels(), observed: 0, sum: 0, count: 0, capped: 0 },
      };
      monthTotals.push(m);
    }
    const t = perDay[i];
    m.days++;
    m.possible += possible[i];
    m.t.observed += t.observed;
    m.t.sum += t.sum;
    m.t.count += t.count;
    m.t.capped += t.capped;
    for (const level of GLUCOSE_LEVELS) m.t.minutes[level] += t.minutes[level];
  });
  const months: MonthGlucose[] = monthTotals.map((m) => {
    const { t } = m,
      all = t.count + t.capped;
    return {
      month: m.month,
      days: m.days,
      wearPercent: Math.min(100, tenth((t.observed / m.possible) * 100)),
      levels: levelPercents(t.minutes, t.observed),
      readings: all,
      mean:
        t.count && (t.capped / all) * 100 <= CAPPED_LIMIT_PERCENT
          ? Math.round(t.sum / t.count)
          : null,
    };
  });
  return { daily, weekdays, months };
}
