import { dateKey, fromLocal, localInput, type CgmReading, type Entry } from "./care";
import { uniqueCgm } from "./cgm-metrics";
import { addDays } from "./cgm-summary";
import { CAPPED_LIMIT_PERCENT } from "./glucose-metrics";
import { firstAtOrAfter } from "./meal-response";

/**
 * How glucose and the log compare with the person's own usual: today so far against the same
 * hours on recent days, and the last week against the four weeks before. Descriptive only: it
 * says which way things moved, never whether that is good or what to do. The day counts below
 * are statistical, not clinical values.
 */
export const TODAY_LOOKBACK_DAYS = 14;
export const WEEK_DAYS = 7;
export const USUAL_WEEKS = 4;
/** A day counts when the CGM recorded at least this much of the hours compared. */
const MIN_DAY_COVERAGE_PERCENT = 70;
/** Today needs this much of the day behind it before it is compared. */
export const MIN_TODAY_MINUTES = 120;
/** Fewest covered days on each side for a comparison. */
export const MIN_USUAL_DAYS = 3;
const MIN_WEEK_DAYS = 4;
const MIN_LOGGED_DAYS = 3;
const STEP_MINUTES = 5;
const MINUTE = 60000;
const LOW = 70,
  HIGH = 180;

export type GlucoseSummary = {
  days: number;
  readings: number;
  /** In unrounded mg/dL. Hidden when more than 5% of readings were past the sensor's limit. */
  mean: number | null;
  inRange: number;
  below70: number;
  above180: number;
};
export type Comparison = {
  current: GlucoseSummary;
  usual: GlucoseSummary;
  /** Change of the average from usual, in percent of usual; null when an average is hidden. */
  meanChangePercent: number | null;
};
export type Unavailable = { unavailable: string };
export type Daypart = "Overnight" | "Morning" | "Afternoon" | "Evening";
export type DaypartComparison = { label: Daypart; current: number | null; usual: number | null };
export type LoggedPerDay = { days: number; carbs: number; rapid: number; long: number };
export type UsualSummary = {
  today: Comparison | Unavailable;
  week: Comparison | Unavailable;
  /** Averages by time of day over the same days as `week`. */
  dayparts: DaypartComparison[] | null;
  /** Per day with anything logged, over the same days as `week`. */
  logged: { current: LoggedPerDay; usual: LoggedPerDay } | null;
};

type Reading = { t: number; value: number; capped: boolean };
type Span = { start: number; end: number };

const DAYPARTS: { label: Daypart; from: string; to: string | null }[] = [
  { label: "Overnight", from: "00:00", to: "06:00" },
  { label: "Morning", from: "06:00", to: "12:00" },
  { label: "Afternoon", from: "12:00", to: "18:00" },
  { label: "Evening", from: "18:00", to: null },
];

/** The instant a local clock time falls on, or null for a time the zone skips. */
function at(day: string, clock: string, timezone: string) {
  try {
    return Date.parse(fromLocal(`${day}T${clock}`, timezone));
  } catch {
    return null;
  }
}

function summarize(groups: Reading[][]): GlucoseSummary {
  const all = groups.flat();
  const count = (test: (r: Reading) => boolean) =>
    Math.round((all.filter(test).length / all.length) * 1000) / 10;
  const capped = all.filter((r) => r.capped).length;
  return {
    days: groups.length,
    readings: all.length,
    mean:
      (capped / all.length) * 100 > CAPPED_LIMIT_PERCENT
        ? null
        : all.reduce((sum, r) => sum + r.value, 0) / all.length,
    inRange: count((r) => r.value >= LOW && r.value <= HIGH),
    below70: count((r) => r.value < LOW),
    above180: count((r) => r.value > HIGH),
  };
}

function compare(current: Reading[][], usual: Reading[][]): Comparison {
  const [a, b] = [summarize(current), summarize(usual)];
  return {
    current: a,
    usual: b,
    meanChangePercent:
      a.mean === null || b.mean === null ? null : Math.round(((a.mean - b.mean) / b.mean) * 100),
  };
}

export function comparedWithUsual({
  cgm,
  entries,
  timezone,
  now,
}: {
  cgm: CgmReading[];
  entries: Entry[];
  timezone: string;
  now: number;
}): UsualSummary {
  const readings: Reading[] = uniqueCgm(cgm)
    .map((r) => ({
      t: Date.parse(r.at),
      value: r.value ?? (r.status === "Low" ? 40 : 400),
      capped: r.value === null,
    }))
    .filter((r) => r.t <= now)
    .sort((a, b) => a.t - b.t);
  const times = readings.map((r) => r.t);
  /** Readings in [start, end), or null when the CGM recorded too little of it. */
  const covered = ({ start, end }: Span) => {
    const inside = readings.slice(firstAtOrAfter(times, start), firstAtOrAfter(times, end));
    const possible = (end - start) / (STEP_MINUTES * MINUTE);
    return possible > 0 && (inside.length / possible) * 100 >= MIN_DAY_COVERAGE_PERCENT
      ? inside
      : null;
  };
  const today = dateKey(new Date(now), timezone);
  const clock = localInput(new Date(now), timezone).slice(11, 16);
  const dayStart = (day: string) => at(day, "00:00", timezone);
  const daySpan = (day: string): Span | null => {
    const [start, end] = [dayStart(day), dayStart(addDays(day, 1))];
    return start === null || end === null ? null : { start, end };
  };

  let todayComparison: Comparison | Unavailable;
  const todayStart = dayStart(today);
  const todayReadings =
    todayStart !== null && now - todayStart >= MIN_TODAY_MINUTES * MINUTE
      ? covered({ start: todayStart, end: now })
      : null;
  if (todayStart === null || now - todayStart < MIN_TODAY_MINUTES * MINUTE)
    todayComparison = { unavailable: "Too early in the day to compare." };
  else if (!todayReadings)
    todayComparison = { unavailable: "The CGM recorded too little of today to compare." };
  else {
    const usual: Reading[][] = [];
    for (let back = 1; back <= TODAY_LOOKBACK_DAYS; back++) {
      const day = addDays(today, -back);
      const [start, end] = [dayStart(day), at(day, clock, timezone)];
      const inside = start !== null && end !== null && end > start ? covered({ start, end }) : null;
      if (inside) usual.push(inside);
    }
    todayComparison =
      usual.length >= MIN_USUAL_DAYS
        ? compare([todayReadings], usual)
        : {
            unavailable: `Needs ${MIN_USUAL_DAYS} earlier days with CGM readings at these hours (${usual.length} so far).`,
          };
  }

  // Complete days only: the last week, and the four weeks before it.
  const days = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => addDays(today, -(from + i)));
  const weekDays = days(1, WEEK_DAYS),
    usualDays = days(1 + WEEK_DAYS, USUAL_WEEKS * WEEK_DAYS);
  const coveredDays = (list: string[]) =>
    list.flatMap((day) => {
      const span = daySpan(day);
      const inside = span && covered(span);
      return inside ? [{ day, span, readings: inside }] : [];
    });
  const [weekCovered, usualCovered] = [coveredDays(weekDays), coveredDays(usualDays)];
  const weekReady = weekCovered.length >= MIN_WEEK_DAYS && usualCovered.length >= MIN_USUAL_DAYS;
  const week: Comparison | Unavailable = weekReady
    ? compare(
        weekCovered.map((d) => d.readings),
        usualCovered.map((d) => d.readings),
      )
    : {
        unavailable: `Needs ${MIN_WEEK_DAYS} of the last ${WEEK_DAYS} days and ${MIN_USUAL_DAYS} of the ${USUAL_WEEKS} weeks before with CGM readings most of the day (${weekCovered.length} and ${usualCovered.length} so far).`,
      };

  const partMean = (list: typeof weekCovered, part: (typeof DAYPARTS)[number]) => {
    const values = list.flatMap(({ day, span, readings: inside }) => {
      const start = at(day, part.from, timezone);
      const end = part.to === null ? span.end : at(day, part.to, timezone);
      return start === null || end === null ? [] : inside.filter((r) => r.t >= start && r.t < end);
    });
    if (
      !values.length ||
      (values.filter((r) => r.capped).length / values.length) * 100 > CAPPED_LIMIT_PERCENT
    )
      return null;
    return values.reduce((sum, r) => sum + r.value, 0) / values.length;
  };
  const dayparts = weekReady
    ? DAYPARTS.map((part) => ({
        label: part.label,
        current: partMean(weekCovered, part),
        usual: partMean(usualCovered, part),
      }))
    : null;

  const perDay = (list: string[]): LoggedPerDay => {
    const byDay = new Map<string, Entry[]>();
    const wanted = new Set(list);
    for (const e of entries) {
      const day = dateKey(new Date(e.at), timezone);
      if (wanted.has(day)) byDay.set(day, [...(byDay.get(day) ?? []), e]);
    }
    const all = [...byDay.values()].flat();
    const sum = (pick: (e: Entry) => number) =>
      byDay.size ? Math.round((all.reduce((s, e) => s + pick(e), 0) / byDay.size) * 10) / 10 : 0;
    return {
      days: byDay.size,
      carbs: sum((e) => (e.kind === "food" ? (e.carbs ?? 0) : 0)),
      rapid: sum((e) =>
        e.kind === "insulin" && e.insulin === "Rapid-acting" ? (e.units ?? 0) : 0,
      ),
      long: sum((e) => (e.kind === "insulin" && e.insulin === "Long-acting" ? (e.units ?? 0) : 0)),
    };
  };
  const [loggedWeek, loggedUsual] = [perDay(weekDays), perDay(usualDays)];
  const logged =
    loggedWeek.days >= MIN_LOGGED_DAYS && loggedUsual.days >= MIN_LOGGED_DAYS
      ? { current: loggedWeek, usual: loggedUsual }
      : null;

  return { today: todayComparison, week, dayparts, logged };
}

export type UsualNudge = { direction: "higher" | "lower"; percent: number };

/**
 * When the last week's average moved at least `threshold` percent from the four weeks before, a
 * prompt to ask what's going on. The threshold comes from the care plan; without it, never.
 */
export function usualNudge(
  summary: UsualSummary,
  threshold: number | undefined,
): UsualNudge | null {
  if (threshold === undefined || "unavailable" in summary.week) return null;
  const change = summary.week.meanChangePercent;
  if (change === null || Math.abs(change) < threshold) return null;
  return { direction: change > 0 ? "higher" : "lower", percent: Math.abs(change) };
}
