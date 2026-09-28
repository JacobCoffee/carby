import { fromLocal, type CgmReading } from "./care";
import type { ClarityAlert, ClarityDevice } from "./clarity";
import { formatGlucoseRate, glucoseWithUnit, type GlucoseUnit } from "./glucose-units";
import {
  agp,
  glucoseByDay,
  glucoseEpisodes,
  glucoseMetrics,
  type AgpSlot,
  type DayGlucose,
  type GlucoseEpisode,
  type GlucoseMetrics,
  type MonthGlucose,
  type WeekdayGlucose,
} from "./glucose-metrics";

/** The longest range one summary covers. */
export const MAX_SUMMARY_DAYS = 366;

export type SensorSession = {
  sensorId: string;
  source: string | null;
  firstAt: string;
  lastAt: string;
};

export type CgmSummaryResult = {
  startDay: string;
  endDay: string;
  metrics: GlucoseMetrics;
  agp: AgpSlot[];
  episodes: GlucoseEpisode[];
  daily: DayGlucose[];
  weekdays: WeekdayGlucose[];
  months: MonthGlucose[];
};

export type CgmSummaryResponse = CgmSummaryResult & {
  sensors: SensorSession[];
  device: ClarityDevice | null;
};

/** The date `days` after a YYYY-MM-DD date. Safe for the browser, unlike the Clarity client's. */
export function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** Every summary for inclusive local dates, cut off at `now` so today counts only so far. */
export function cgmSummary(options: {
  readings: CgmReading[];
  startDay: string;
  endDay: string;
  timezone: string;
  now: number;
  planRange?: { low: number; high: number };
}): CgmSummaryResult {
  const { readings, startDay, endDay, timezone, now, planRange } = options;
  const start = fromLocal(`${startDay}T00:00`, timezone);
  const end = new Date(
    Math.min(now, Date.parse(fromLocal(`${addDays(endDay, 1)}T00:00`, timezone))),
  ).toISOString();
  const { daily, weekdays, months } = glucoseByDay(readings, startDay, endDay, timezone, now);
  return {
    startDay,
    endDay,
    metrics: glucoseMetrics(readings, start, end, planRange),
    agp: agp(readings, start, end, timezone),
    episodes: glucoseEpisodes(readings, start, end),
    daily,
    weekdays,
    months,
  };
}

/** A sensor with a Clarity reading this recent is taken to be the one in use. */
export const SENSOR_QUIET_MINUTES = 1440;

/** Which sensor is running now and for how long, from its first reading. */
export function currentSensor(sessions: SensorSession[], now: number) {
  const latest = sessions.reduce<SensorSession | null>(
    (newest, s) => (!newest || s.lastAt > newest.lastAt ? s : newest),
    null,
  );
  if (!latest) return null;
  const started = Date.parse(latest.firstAt);
  const quietMinutes = Math.max(0, Math.round((now - Date.parse(latest.lastAt)) / 60000));
  return {
    ...latest,
    /** Day 1 is the first 24 hours of readings. */
    day: Math.floor((now - started) / 86400000) + 1,
    /** Minutes since this sensor's last reading reached Carby through Clarity. */
    quietMinutes,
    inUse: quietMinutes < SENSOR_QUIET_MINUTES,
  };
}

/** Clarity sync state as the care snapshot sends it; null when Clarity is not connected. */
export type ClarityFreshness = {
  lastSync: string | null;
  lastError: string | null;
  /** The newest Clarity reading stored. */
  latestAt: string | null;
};
/** Clarity syncs about once a day, so a sync older than this is behind. */
export const CLARITY_BEHIND_HOURS = 36;

/** "just now", "12 min ago", "3 hr ago" or "2 days ago". */
export function timeAgo(at: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** Whether Clarity data is behind: never synced, the last attempt failed, or the sync is old. */
export function clarityBehind(sync: ClarityFreshness, now: number) {
  if (sync.lastError || !sync.lastSync) return true;
  return now - Date.parse(sync.lastSync) > CLARITY_BEHIND_HOURS * 3600000;
}

/** One alert as the app has it set, e.g. "Urgent Low · 55 mg/dL" or "Signal Loss · after 20 min". */
export function describeAlert(alert: ClarityAlert, unit: GlucoseUnit) {
  const setting =
    alert.glucose !== null
      ? glucoseWithUnit(alert.glucose, unit)
      : alert.rate !== null
        ? formatGlucoseRate(alert.rate, unit)
        : alert.minutes !== null
          ? `after ${alert.minutes} min`
          : null;
  return setting ? `${alert.kind} · ${setting}` : alert.kind;
}
