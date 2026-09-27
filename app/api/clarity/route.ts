import { getCurrentUser } from "@/app/auth";
import { accessFor } from "@/app/access";
import { database } from "@/db/raw";
import {
  CLARITY_REPORTS,
  ClarityError,
  addDays,
  normalizeShareCode,
  openClarity,
  type ClarityReport,
} from "@/lib/clarity-client";
import {
  MAX_REPORT_DAYS,
  MAX_SYNC_DAYS,
  archiveClarityReport,
  backfillClarityGap,
  clarityConnection,
  clarityContext,
  clarityMessage,
  importClarityData,
  isDate,
  localDate,
  openClarityConnection,
  recordClarityError,
  spanDays,
  type ClarityConnectionRow,
  type ClarityCredentials,
  type ClarityReportMeta,
  type ClarityStatus,
} from "@/lib/clarity-sync";
import { seal } from "@/lib/dexcom-share";

export const dynamic = "force-dynamic";
type ReportRow = {
  id: string;
  reports: string;
  start_date: string;
  end_date: string;
  scheduled: boolean;
  created: string;
  size: number;
};
function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
function reportList(value: unknown, allowEmpty: boolean): ClarityReport[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return null;
  if (!value.every((v) => (CLARITY_REPORTS as readonly unknown[]).includes(v))) return null;
  return CLARITY_REPORTS.filter((kind) => value.includes(kind));
}
async function status(owner: string, row?: ClarityConnectionRow | null): Promise<ClarityStatus> {
  const db = database();
  const [connection, reports] = await Promise.all([
    row === undefined ? clarityConnection(db, owner) : row,
    db
      .prepare(
        "SELECT id, reports, start_date, end_date, scheduled, created, size FROM clarity_reports WHERE owner = $1 ORDER BY created DESC LIMIT 200",
      )
      .bind(owner)
      .all<ReportRow>(),
  ]);
  return {
    connected: !!connection,
    subjectName: connection?.subject_name ?? null,
    expiresAt: connection?.expires_at ?? null,
    autoSync: connection?.auto_sync ?? false,
    monthlyReports: connection ? (JSON.parse(connection.monthly_reports) as ClarityReport[]) : [],
    syncedThrough: connection?.synced_through ?? null,
    lastSync: connection?.last_sync ?? null,
    lastAttemptAt: connection?.last_attempt_at ?? null,
    lastError: connection?.last_error ?? null,
    reports: reports.results.map((r): ClarityReportMeta => ({
      id: r.id,
      reports: JSON.parse(r.reports),
      startDate: r.start_date,
      endDate: r.end_date,
      scheduled: r.scheduled,
      created: r.created,
      size: r.size,
    })),
  };
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in first." }, 401);
  const access = await accessFor(request, user, "read");
  if (access instanceof Response) return access;
  const owner = access.person;
  try {
    return reply(await status(owner));
  } catch {
    return reply({ error: "Clarity status is unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in first." }, 401);
  if (!sameOrigin(request)) return reply({ error: "Request origin rejected." }, 403);
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return reply({ error: "Invalid request." }, 400);
    body = raw as Record<string, unknown>;
  } catch {
    return reply({ error: "Invalid JSON request." }, 400);
  }
  // Connecting and changing settings is for owners; syncing and archiving reports is logging.
  const access = await accessFor(
    request,
    user,
    body.action === "sync" || body.action === "report" || body.action === "backfill"
      ? "log"
      : "manage",
  );
  if (access instanceof Response) return access;
  const owner = access.person;
  const db = database();
  try {
    if (body.action === "check" || body.action === "connect") {
      const code = typeof body.code === "string" ? normalizeShareCode(body.code) : null;
      if (!code) return reply({ error: "Enter the 12-character share code from Clarity." }, 400);
      if (body.region !== "us" && body.region !== "ous")
        return reply({ error: "Choose where the Clarity account is registered." }, 400);
      const session = await openClarity(code, body.region);
      const name = `${session.subject.firstName} ${session.subject.lastName}`.trim();
      if (body.action === "check")
        return reply({ subjectName: name, expiresAt: session.expiresAt });
      // The person confirmed this name after the check; a code that now opens someone else stops here.
      if (body.subjectName !== name)
        return reply(
          { error: "This share code opens a different Clarity account. Check it again." },
          409,
        );
      const monthlyReports = reportList(body.monthlyReports, true);
      if (typeof body.autoSync !== "boolean" || !monthlyReports)
        return reply({ error: "Invalid sync settings." }, 400);
      const credentials: ClarityCredentials = { code, region: body.region };
      const now = new Date().toISOString();
      await db
        .prepare(
          "INSERT INTO clarity_connections (owner, credentials, subject_id, subject_name, expires_at, auto_sync, monthly_reports, synced_through, last_sync, last_attempt_at, last_error, updated) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, NULL, NULL, $8) ON CONFLICT(owner) DO UPDATE SET credentials = excluded.credentials, subject_id = excluded.subject_id, subject_name = excluded.subject_name, expires_at = excluded.expires_at, auto_sync = excluded.auto_sync, monthly_reports = excluded.monthly_reports, synced_through = CASE WHEN clarity_connections.subject_id = excluded.subject_id THEN clarity_connections.synced_through END, last_error = NULL, updated = excluded.updated",
        )
        .bind(
          owner,
          await seal(credentials, clarityContext(owner)),
          session.subjectId,
          name,
          session.expiresAt,
          body.autoSync,
          JSON.stringify(monthlyReports),
          now,
        )
        .run();
      return reply(await status(owner));
    }

    const row = await clarityConnection(db, owner);
    if (!row) return reply({ error: "Connect Clarity first." }, 400);
    if (body.action === "settings") {
      const monthlyReports = reportList(body.monthlyReports, true);
      if (typeof body.autoSync !== "boolean" || !monthlyReports)
        return reply({ error: "Invalid sync settings." }, 400);
      await db
        .prepare(
          "UPDATE clarity_connections SET auto_sync = $1, monthly_reports = $2, updated = $3 WHERE owner = $4",
        )
        .bind(body.autoSync, JSON.stringify(monthlyReports), new Date().toISOString(), owner)
        .run();
      return reply(await status(owner));
    }
    if (body.action === "backfill") {
      // Safe to call often: it syncs only for a recent closed gap and at most every half hour.
      const backfilled = await backfillClarityGap(db, owner);
      return reply({ backfilled });
    }
    if (body.action !== "sync" && body.action !== "report")
      return reply({ error: "Unknown action." }, 400);
    const reports = body.action === "report" ? reportList(body.reports, false) : [];
    if (!reports) return reply({ error: "Choose at least one report." }, 400);
    const { start, end } = body;
    const maxDays = body.action === "sync" ? MAX_SYNC_DAYS : MAX_REPORT_DAYS;
    if (!isDate(start) || !isDate(end) || start > end || spanDays(start, end) > maxDays)
      return reply({ error: `Choose a date range of up to ${maxDays} days.` }, 400);

    await db
      .prepare("UPDATE clarity_connections SET last_attempt_at = $1 WHERE owner = $2")
      .bind(new Date().toISOString(), owner)
      .run();
    const context = await openClarityConnection(db, owner, row);
    // A day's grace covers a time zone ahead of the server's clock.
    if (end > addDays(localDate(context.timeZone), 1))
      return reply({ error: "The date range ends in the future." }, 400);
    if (body.action === "sync") {
      const result = await importClarityData(db, owner, context, start, end);
      return reply({ ...(await status(owner)), result });
    }
    const report = await archiveClarityReport(db, owner, context, reports, start, end, false);
    return reply({ ...(await status(owner)), report });
  } catch (error) {
    const message =
      body.action === "sync" || body.action === "report" || body.action === "backfill"
        ? await recordClarityError(db, owner, error)
        : clarityMessage(error);
    return reply(
      { error: message },
      error instanceof ClarityError && error.kind !== "unavailable" ? 422 : 502,
    );
  }
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in first." }, 401);
  if (!sameOrigin(request)) return reply({ error: "Request origin rejected." }, 403);
  const access = await accessFor(request, user, "manage");
  if (access instanceof Response) return access;
  const owner = access.person;
  try {
    // Readings and archived reports stay; only the share code is forgotten.
    await database().prepare("DELETE FROM clarity_connections WHERE owner = $1").bind(owner).run();
    return reply(await status(owner, null));
  } catch {
    return reply({ error: "Could not disconnect Clarity." }, 503);
  }
}
