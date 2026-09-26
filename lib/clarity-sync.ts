import type { Database } from "../db/postgres";
import { fromLocal } from "./care";
import { parseClarity } from "./clarity";
import {
  ClarityError,
  addDays,
  exportClarityCsv,
  generateClarityReport,
  openClarity,
  type ClarityRegion,
  type ClarityReport,
  type ClaritySession,
} from "./clarity-client";
import { clarityEventStatements, clarityReadingStatements } from "./cgm-sql";
import { unseal } from "./dexcom-share";

export const MAX_SYNC_DAYS = 366;
export const MAX_REPORT_DAYS = 90;
// Rows per transaction, so a year of five-minute readings does not hold one lock for minutes.
const BATCH_ROWS = 500;
// The hourly scheduler retries an account about once a day.
const SCHEDULE_INTERVAL_MS = 20 * 3600000;
const SCHEDULE_ACCOUNTS_PER_RUN = 50;

/**
 * Out of range of the phone or receiver, a Dexcom sensor keeps its readings and hands them over
 * when it reconnects. Clarity receives that backfill; Share does not. So a gap in the log that has
 * since closed is worth asking Clarity about.
 */
export const BACKFILL_GAP_MINUTES = 15;
/** The longest gap the sensor itself can backfill. */
export const BACKFILL_MAX_GAP_HOURS = 24;
/** Keep asking this long after a gap closes, since the app can upload the backfill late. */
export const BACKFILL_WINDOW_HOURS = 6;
/** Ask Clarity about a gap at most this often. */
export const BACKFILL_RETRY_MINUTES = 30;

export type ClarityGap = { from: string; to: string };

/**
 * The newest closed gap in sorted reading times that Clarity may have filled: readings stopped
 * for over BACKFILL_GAP_MINUTES and resumed within the last BACKFILL_WINDOW_HOURS. A gap that is
 * still open has nothing to backfill yet.
 */
export function clarityGapToFill(times: string[], now: number): ClarityGap | null {
  for (let i = times.length - 1; i > 0; i--) {
    const to = Date.parse(times[i]),
      from = Date.parse(times[i - 1]);
    if (now - to > BACKFILL_WINDOW_HOURS * 3600000) return null;
    const minutes = (to - from) / 60000;
    if (minutes > BACKFILL_GAP_MINUTES && minutes <= BACKFILL_MAX_GAP_HOURS * 60)
      return { from: times[i - 1], to: times[i] };
  }
  return null;
}

export type ClarityCredentials = { code: string; region: ClarityRegion };
export type ClarityConnectionRow = {
  credentials: string;
  subject_id: string;
  subject_name: string;
  expires_at: string;
  auto_sync: boolean;
  monthly_reports: string;
  synced_through: string | null;
  last_sync: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
};
export type ClarityReportMeta = {
  id: string;
  reports: ClarityReport[];
  startDate: string;
  endDate: string;
  scheduled: boolean;
  created: string;
  size: number;
};
/** What GET /api/clarity and every successful change return. */
export type ClarityStatus = {
  connected: boolean;
  subjectName: string | null;
  expiresAt: string | null;
  autoSync: boolean;
  monthlyReports: ClarityReport[];
  syncedThrough: string | null;
  lastSync: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  reports: ClarityReportMeta[];
};
export type ClaritySyncResult = {
  readings: number;
  changed: number;
  events: number;
  newEvents: number;
  skipped: number;
};

/** Encryption context for a sealed share code, so a Share sign-in cannot stand in for one. */
export const clarityContext = (owner: string) => `clarity|${owner}`;

/** A real calendar date written YYYY-MM-DD. */
export function isDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
  );
}
/** The calendar date at `at` in `timeZone`. */
export function localDate(timeZone: string, at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
}
/** Inclusive days from `start` to `end`. */
export function spanDays(start: string, end: string) {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
}

export function clarityConnection(db: Database, owner: string) {
  return db
    .prepare(
      "SELECT credentials, subject_id, subject_name, expires_at, auto_sync, monthly_reports, synced_through, last_sync, last_attempt_at, last_error FROM clarity_connections WHERE owner = $1",
    )
    .bind(owner)
    .first<ClarityConnectionRow>();
}

export type ClarityContext = { session: ClaritySession; timeZone: string };

/** Open the saved share code and confirm it still shows the account that was connected. */
export async function openClarityConnection(
  db: Database,
  owner: string,
  row: ClarityConnectionRow,
): Promise<ClarityContext> {
  const plan = await db
    .prepare("SELECT data FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 1")
    .bind(owner)
    .first<{ data: string }>();
  const timeZone: unknown = plan ? JSON.parse(plan.data).timezone : null;
  if (typeof timeZone !== "string" || !timeZone)
    throw new ClarityError(
      "Save a care plan first. Carby reads Clarity times in the plan's time zone.",
      "setup",
    );
  const { code, region } = await unseal<ClarityCredentials>(row.credentials, clarityContext(owner));
  const session = await openClarity(code, region);
  if (session.subjectId !== row.subject_id)
    throw new ClarityError(
      "This share code now opens a different Clarity account. Disconnect Clarity and connect again.",
      "code",
    );
  return { session, timeZone };
}

/** Import Clarity readings and device events for inclusive local dates. */
export async function importClarityData(
  db: Database,
  owner: string,
  { session, timeZone }: ClarityContext,
  start: string,
  end: string,
): Promise<ClaritySyncResult> {
  const { readings, events, skipped, device, sensors } = parseClarity(
    await exportClarityCsv(session, start, end),
    timeZone,
  );
  if ([...readings, ...events].some((v) => Date.parse(v.at) > Date.now() + 300000))
    throw new ClarityError(
      "Clarity returned readings in the future. Check the time zone in the care plan.",
      "setup",
    );
  let changed = 0;
  for (let i = 0; i < readings.length; i += BATCH_ROWS) {
    const { saves, cleanups } = await clarityReadingStatements(
      db,
      owner,
      readings.slice(i, i + BATCH_ROWS),
    );
    const results = await db.batch([...saves, ...cleanups]);
    changed += results.slice(0, saves.length).reduce((sum, r) => sum + r.meta.changes, 0);
  }
  let newEvents = 0;
  for (let i = 0; i < events.length; i += BATCH_ROWS) {
    const results = await db.batch(
      await clarityEventStatements(db, owner, events.slice(i, i + BATCH_ROWS)),
    );
    newEvents += results.reduce((sum, r) => sum + r.meta.changes, 0);
  }
  const now = new Date().toISOString();
  // A sync covers a date range, so each sensor's span only ever widens.
  const sensorSaves = sensors.map((sensor) =>
    db
      .prepare(
        "INSERT INTO sensor_sessions (owner, sensor_id, source, first_at, last_at, updated) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (owner, sensor_id) DO UPDATE SET source = COALESCE(excluded.source, sensor_sessions.source), first_at = LEAST(sensor_sessions.first_at, excluded.first_at), last_at = GREATEST(sensor_sessions.last_at, excluded.last_at), updated = excluded.updated",
      )
      .bind(owner, sensor.id, sensor.source, sensor.firstAt, sensor.lastAt, now),
  );
  const deviceSave = device
    ? [
        db
          .prepare(
            "INSERT INTO cgm_device_settings (owner, data, updated) VALUES ($1, $2, $3) ON CONFLICT (owner) DO UPDATE SET data = excluded.data, updated = excluded.updated",
          )
          .bind(owner, JSON.stringify(device), now),
      ]
    : [];
  await db.batch([
    ...sensorSaves,
    ...deviceSave,
    db
      .prepare(
        "UPDATE clarity_connections SET last_sync = $1, last_error = NULL, expires_at = $2, synced_through = CASE WHEN synced_through IS NULL OR synced_through < $3 THEN $4 ELSE synced_through END WHERE owner = $5",
      )
      .bind(now, session.expiresAt, end, end, owner),
  ]);
  return { readings: readings.length, changed, events: events.length, newEvents, skipped };
}

/** Generate a Clarity PDF for inclusive local dates and keep it with the account. */
export async function archiveClarityReport(
  db: Database,
  owner: string,
  { session, timeZone }: ClarityContext,
  reports: ClarityReport[],
  start: string,
  end: string,
  scheduled: boolean,
): Promise<ClarityReportMeta> {
  const pdf = await generateClarityReport(session, reports, start, end, timeZone);
  const meta = {
    id: crypto.randomUUID(),
    reports,
    startDate: start,
    endDate: end,
    scheduled,
    created: new Date().toISOString(),
    size: pdf.length,
  };
  await db
    .prepare(
      "INSERT INTO clarity_reports (id, owner, reports, start_date, end_date, scheduled, created, size, pdf) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(
      meta.id,
      owner,
      JSON.stringify(reports),
      start,
      end,
      scheduled,
      meta.created,
      meta.size,
      Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength),
    )
    .run();
  return meta;
}

/** The message to show for a failure; anything unexpected gets a generic one. */
export function clarityMessage(error: unknown) {
  if (error instanceof ClarityError) return error.message;
  if (error instanceof Error && error.message === "Dexcom connection is not configured.")
    return error.message;
  return "Clarity sync failed. Try again.";
}

/** Store a user-safe failure on the connection and return it. */
export async function recordClarityError(db: Database, owner: string, error: unknown) {
  const message = clarityMessage(error);
  try {
    await db
      .prepare("UPDATE clarity_connections SET last_error = $1 WHERE owner = $2")
      .bind(message, owner)
      .run();
  } catch {
    /* Keep the original failure. */
  }
  return message;
}

/**
 * Sync Clarity over a recent closed gap when automatic sync is on and Clarity has not been asked
 * in the last BACKFILL_RETRY_MINUTES. Returns null when there was nothing to do.
 */
export async function backfillClarityGap(
  db: Database,
  owner: string,
  now = new Date(),
): Promise<{ gap: ClarityGap; result: ClaritySyncResult } | null> {
  const since = new Date(
    now.getTime() - (BACKFILL_MAX_GAP_HOURS + BACKFILL_WINDOW_HOURS) * 3600000,
  ).toISOString();
  const rows = await db
    .prepare("SELECT DISTINCT at FROM cgm_readings WHERE owner = $1 AND at >= $2 ORDER BY at")
    .bind(owner, since)
    .all<{ at: string }>();
  const gap = clarityGapToFill(
    rows.results.map((r) => r.at),
    now.getTime(),
  );
  if (!gap) return null;
  // The claim is the rate limit: a second tab or process finds the attempt already made.
  const claimed = await db
    .prepare(
      "UPDATE clarity_connections SET last_attempt_at = $1 WHERE owner = $2 AND auto_sync AND (last_attempt_at IS NULL OR last_attempt_at < $3) RETURNING owner",
    )
    .bind(
      now.toISOString(),
      owner,
      new Date(now.getTime() - BACKFILL_RETRY_MINUTES * 60000).toISOString(),
    )
    .first<{ owner: string }>();
  if (!claimed) return null;
  const row = await clarityConnection(db, owner);
  if (!row) return null;
  const context = await openClarityConnection(db, owner, row);
  const result = await importClarityData(
    db,
    owner,
    context,
    localDate(context.timeZone, new Date(gap.from)),
    localDate(context.timeZone, now),
  );
  return { gap, result };
}

/**
 * Sync every account with automatic sync on that has not been tried for a day, one at a time.
 * Each account is claimed with SKIP LOCKED, so several processes can run this together. Then
 * fill recent gaps the sensor backfilled into Clarity for accounts not asked recently.
 */
export async function runScheduledClarity(db: Database, now = new Date()) {
  let synced = 0,
    backfilled = 0,
    failed = 0;
  const cutoff = new Date(now.getTime() - SCHEDULE_INTERVAL_MS).toISOString();
  for (let i = 0; i < SCHEDULE_ACCOUNTS_PER_RUN; i++) {
    const claimed = await db
      .prepare(
        "UPDATE clarity_connections SET last_attempt_at = $1 WHERE owner = (SELECT owner FROM clarity_connections WHERE auto_sync AND (last_attempt_at IS NULL OR last_attempt_at < $2) ORDER BY last_attempt_at NULLS FIRST LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING owner",
      )
      .bind(now.toISOString(), cutoff)
      .first<{ owner: string }>();
    if (!claimed) break;
    const { owner } = claimed;
    try {
      const row = await clarityConnection(db, owner);
      if (!row) continue;
      const context = await openClarityConnection(db, owner, row);
      const today = localDate(context.timeZone, now);
      // Two days of overlap catch readings the phone uploaded late.
      const start = row.synced_through ? addDays(row.synced_through, -2) : addDays(today, -13);
      await importClarityData(
        db,
        owner,
        context,
        start < addDays(today, 1 - MAX_SYNC_DAYS) ? addDays(today, 1 - MAX_SYNC_DAYS) : start,
        today,
      );
      const reports = JSON.parse(row.monthly_reports) as ClarityReport[];
      if (reports.length) {
        const monthStart = `${today.slice(0, 7)}-01`;
        const previousStart = `${addDays(monthStart, -1).slice(0, 7)}-01`;
        const previousEnd = addDays(monthStart, -1);
        // A month with no sensor readings would archive a blank report, so it is skipped. A
        // later run still archives it if late readings arrive.
        const due = await db
          .prepare(
            "SELECT NOT EXISTS (SELECT 1 FROM clarity_reports WHERE owner = $1 AND scheduled AND start_date = $2 AND end_date = $3) AND EXISTS (SELECT 1 FROM cgm_readings WHERE owner = $1 AND at >= $4 AND at < $5) AS due",
          )
          .bind(
            owner,
            previousStart,
            previousEnd,
            fromLocal(`${previousStart}T00:00`, context.timeZone),
            fromLocal(`${monthStart}T00:00`, context.timeZone),
          )
          .first<{ due: boolean }>();
        if (due?.due)
          await archiveClarityReport(db, owner, context, reports, previousStart, previousEnd, true);
      }
      synced++;
    } catch (error) {
      failed++;
      const message = await recordClarityError(db, owner, error);
      console.warn(`[clarity] scheduled sync failed: ${message}`);
    }
  }
  const due = await db
    .prepare(
      "SELECT owner FROM clarity_connections WHERE auto_sync AND (last_attempt_at IS NULL OR last_attempt_at < $1) ORDER BY last_attempt_at NULLS FIRST LIMIT $2",
    )
    .bind(
      new Date(now.getTime() - BACKFILL_RETRY_MINUTES * 60000).toISOString(),
      SCHEDULE_ACCOUNTS_PER_RUN,
    )
    .all<{ owner: string }>();
  for (const { owner } of due.results) {
    try {
      if (await backfillClarityGap(db, owner, now)) backfilled++;
    } catch (error) {
      failed++;
      const message = await recordClarityError(db, owner, error);
      console.warn(`[clarity] gap backfill failed: ${message}`);
    }
  }
  return { synced, backfilled, failed };
}
