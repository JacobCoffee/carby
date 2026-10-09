import { getCurrentUser } from "@/app/auth";
import { accessFor } from "@/app/access";
import { database } from "@/db/raw";
import { publicDexcomDefaults, resolveDexcomCredentials } from "@/lib/dexcom-defaults";
import {
  fetchShare,
  seal,
  ShareRateLimited,
  unseal,
  type ShareCredentials,
} from "@/lib/dexcom-share";
import { saveCgmSql } from "@/lib/cgm-sql";

export const dynamic = "force-dynamic";
type ConnectionRow = {
  credentials: string;
  last_sync: string | null;
  latest_reading_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  share_paused_until: string | null;
};
// Share is called at most once a minute per connection, manual syncs included, so open tabs and
// devices cannot stack retries on an account that is failing or rate-limited.
const ATTEMPT_GAP_MS = 60_000;
// How long a rate limit pauses Share calls when Dexcom does not say, and the most any pause lasts.
const DEFAULT_PAUSE_MS = 15 * 60_000;
const MAX_PAUSE_MS = 60 * 60_000;
const PAUSED_MESSAGE = "Dexcom is limiting requests, so Share sync is paused.";
function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
async function connection(owner: string): Promise<ConnectionRow | null> {
  return database()
    .prepare(
      "SELECT credentials, last_sync, latest_reading_at, last_attempt_at, last_error, share_paused_until FROM dexcom_connections WHERE owner = $1",
    )
    .bind(owner)
    .first<ConnectionRow>();
}
/** The pause still in effect, if any. */
function pausedUntil(row: ConnectionRow | null, now = Date.now()) {
  const until = row?.share_paused_until;
  return until && Date.parse(until) > now ? until : null;
}
function pauseReply(row: ConnectionRow | null, until: string) {
  return reply({ error: row?.last_error ?? PAUSED_MESSAGE, retryAt: until }, 429);
}
async function recentReply(owner: string, row: ConnectionRow) {
  return reply({
    connected: true,
    lastSync: row.last_sync,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    count: 0,
    alreadyRecent: true,
    latestShareAt: await latestShareAt(owner, row.latest_reading_at),
  });
}
function newestReadingAt(
  readings: Awaited<ReturnType<typeof fetchShare>>["readings"],
): string | null {
  return readings.reduce<string | null>(
    (newest, reading) => (!newest || reading.at > newest ? reading.at : newest),
    null,
  );
}
async function latestShareAt(owner: string, savedAt?: string | null) {
  if (savedAt) return savedAt;
  // Existing connections are backfilled on their next sync. Until then, use the last Share-owned row.
  const row = await database()
    .prepare(
      "SELECT at FROM cgm_readings WHERE owner = $1 AND source = 'Dexcom Share' ORDER BY at DESC LIMIT 1",
    )
    .bind(owner)
    .first<{ at: string }>();
  return row?.at ?? null;
}
async function saveReadings(
  owner: string,
  readings: Awaited<ReturnType<typeof fetchShare>>["readings"],
) {
  const db = database();
  let changed = 0;
  for (let i = 0; i < readings.length; i += 100) {
    const batch = await Promise.all(
      readings.slice(i, i + 100).map(async (v) => {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(owner + "|" + v.at),
        );
        const id = Array.from(new Uint8Array(digest))
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        return db.prepare(saveCgmSql).bind(id, owner, v.at, v.status ?? String(v.value), v.source);
      }),
    );
    if (batch.length) {
      const results = await db.batch(batch);
      changed += results.reduce((total, result) => total + (result.meta?.changes ?? 0), 0);
    }
  }
  return changed;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in first." }, 401);
  const access = await accessFor(request, user, "read");
  if (access instanceof Response) return access;
  const owner = access.person;
  try {
    const row = await connection(owner);
    return reply({
      connected: !!row,
      lastSync: row?.last_sync ?? null,
      lastAttemptAt: row?.last_attempt_at ?? null,
      lastError: row?.last_error ?? null,
      pausedUntil: pausedUntil(row),
      latestShareAt: await latestShareAt(owner, row?.latest_reading_at),
      // Username and region only: publicDexcomDefaults has no password field to leak.
      defaults: publicDexcomDefaults(owner),
    });
  } catch {
    return reply({ error: "Connection status is unavailable." }, 503);
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
  // Anyone who can see the person may refresh their Share readings; connecting is for owners.
  const access = await accessFor(request, user, body.action === "sync" ? "read" : "manage");
  if (access instanceof Response) return access;
  const owner = access.person;
  try {
    const db = database();
    if (body.action === "connect") {
      // A typed password wins; a configured one applies only when this request asks for it and
      // still names the configured account. The checks below judge the resolved values either way.
      const { username, password, region } = resolveDexcomCredentials(owner, body);
      if (
        !username ||
        username.length > 200 ||
        !password ||
        password.length > 300 ||
        !["us", "ous", "jp"].includes(region)
      )
        return reply({ error: "Enter the publisher account login, password and region." }, 400);
      const existing = await connection(owner),
        paused = pausedUntil(existing);
      if (paused) return pauseReply(existing, paused);
      const credentials: ShareCredentials = {
        username,
        password,
        region: region as ShareCredentials["region"],
      };
      const { readings, sessionId, rawCount } = await fetchShare(credentials);
      if (rawCount === 0)
        return reply(
          {
            error:
              "This account signed in, but Share returned no readings. Check that these are the credentials signed into the G7 app, not the Follow app. The existing connection was kept.",
          },
          422,
        );
      if (readings.length === 0)
        return reply(
          {
            error:
              "Dexcom Share returned values without readable glucose readings. The existing connection was kept.",
          },
          422,
        );
      const encrypted = await seal({ ...credentials, sessionId }, owner),
        latestAt = newestReadingAt(readings);
      const count = await saveReadings(owner, readings),
        now = new Date().toISOString();
      await db
        .prepare(
          "INSERT INTO dexcom_connections (owner, credentials, last_sync, latest_reading_at, last_attempt_at, last_error, share_paused_until, updated) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6) ON CONFLICT(owner) DO UPDATE SET credentials = excluded.credentials, last_sync = excluded.last_sync, latest_reading_at = excluded.latest_reading_at, last_attempt_at = excluded.last_attempt_at, last_error = NULL, share_paused_until = NULL, updated = excluded.updated",
        )
        .bind(owner, encrypted, now, latestAt, now, now)
        .run();
      return reply({
        connected: true,
        lastSync: now,
        lastAttemptAt: now,
        lastError: null,
        count,
        rawCount,
        latestShareAt: latestAt,
      });
    }
    if (body.action === "sync") {
      const row = await connection(owner);
      if (!row) return reply({ error: "Connect Dexcom Share first." }, 400);
      const elapsed = row.last_sync ? Date.now() - Date.parse(row.last_sync) : Infinity;
      if (body.force !== true && elapsed >= 0 && elapsed < 240000) return recentReply(owner, row);
      const now = Date.now(),
        attemptedAt = new Date(now).toISOString();
      // One statement claims the attempt, so concurrent tabs and devices cannot both reach Share.
      const claimed = await db
        .prepare(
          "UPDATE dexcom_connections SET last_attempt_at = $1 WHERE owner = $2 AND (last_attempt_at IS NULL OR last_attempt_at <= $3) AND (share_paused_until IS NULL OR share_paused_until <= $1) RETURNING owner",
        )
        .bind(attemptedAt, owner, new Date(now - ATTEMPT_GAP_MS).toISOString())
        .first();
      if (!claimed) {
        const latest = await connection(owner);
        if (!latest) return reply({ error: "Connect Dexcom Share first." }, 400);
        const paused = pausedUntil(latest, now);
        if (paused) return pauseReply(latest, paused);
        if (
          latest.last_sync &&
          latest.last_attempt_at &&
          latest.last_sync >= latest.last_attempt_at
        )
          return recentReply(owner, latest);
        // The last attempt failed or is still running.
        const retryAt = new Date(
          Date.parse(latest.last_attempt_at ?? attemptedAt) + ATTEMPT_GAP_MS,
        ).toISOString();
        return reply({ error: "Dexcom was checked less than a minute ago.", retryAt }, 429);
      }
      const credentials = await unseal(row.credentials, owner);
      const { readings, rawCount } = await fetchShare(credentials, async (sessionId) => {
        await db
          .prepare("UPDATE dexcom_connections SET credentials = $1 WHERE owner = $2")
          .bind(await seal({ ...credentials, sessionId }, owner), owner)
          .run();
      });
      if (rawCount > 0 && readings.length === 0)
        throw new Error("Dexcom Share returned values without readable glucose readings.");
      const count = await saveReadings(owner, readings),
        syncedAt = new Date().toISOString(),
        fetchedAt = newestReadingAt(readings);
      const lastError =
        rawCount === 0
          ? "Dexcom Share returned no readings in the last 24 hours. Check Share in the G7 app and the phone connection."
          : fetchedAt && Date.now() - Date.parse(fetchedAt) > 30 * 60000
            ? "Newest Share glucose is over 30 minutes old. Check the G7 app, Share, and the phone connection."
            : null;
      await db
        .prepare(
          "UPDATE dexcom_connections SET last_sync = $1, last_error = $2, share_paused_until = NULL, latest_reading_at = CASE WHEN latest_reading_at IS NULL OR latest_reading_at < $3 THEN $4 ELSE latest_reading_at END WHERE owner = $5",
        )
        .bind(syncedAt, lastError, fetchedAt, fetchedAt, owner)
        .run();
      return reply({
        connected: true,
        lastSync: syncedAt,
        lastAttemptAt: attemptedAt,
        lastError,
        count,
        rawCount,
        latestShareAt: await latestShareAt(
          owner,
          row.latest_reading_at && (!fetchedAt || row.latest_reading_at > fetchedAt)
            ? row.latest_reading_at
            : fetchedAt,
        ),
      });
    }
    return reply({ error: "Unknown action." }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Dexcom sync failed.";
    const safeMessage =
      message === "Dexcom connection is not configured." || message.startsWith("Dexcom")
        ? message
        : "Dexcom sync failed. Try again.";
    const pause =
      e instanceof ShareRateLimited
        ? new Date(
            Date.now() +
              Math.min(Math.max(e.retryAfterMs ?? DEFAULT_PAUSE_MS, ATTEMPT_GAP_MS), MAX_PAUSE_MS),
          ).toISOString()
        : null;
    // A failed connect keeps the existing connection, so only a rate limit is recorded against it.
    if (body.action === "sync" || pause) {
      try {
        await database()
          .prepare(
            "UPDATE dexcom_connections SET last_error = $1, share_paused_until = $2 WHERE owner = $3",
          )
          .bind(safeMessage, pause, owner)
          .run();
      } catch {
        /* Keep the original sync error. */
      }
    }
    // Not 502: Cloudflare swaps an origin 502/504 for its own HTML page, hiding this message.
    return pause
      ? reply({ error: safeMessage, retryAt: pause }, 429)
      : reply({ error: safeMessage }, 503);
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
    await database().prepare("DELETE FROM dexcom_connections WHERE owner = $1").bind(owner).run();
    return reply({ connected: false });
  } catch {
    return reply({ error: "Could not disconnect Dexcom." }, 503);
  }
}
