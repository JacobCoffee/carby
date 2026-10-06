import type { Database } from "@/db/raw";
import { IMPORT_TABLES, type BackupTable } from "./backup-import";

/** Every table that holds an owner's data. A backup is only imported when all of them are empty. */
export const ACCOUNT_TABLES: readonly BackupTable[] = [...IMPORT_TABLES, "dexcom_connections"];

// Table names come from the fixed list above, never from a request.
const existsSql = `SELECT ${ACCOUNT_TABLES.map((table, index) => `EXISTS (SELECT 1 FROM "${table}" WHERE owner = $${index + 1}) AS "${table}"`).join(", ")}`;
/** One owner parameter per table, numbered from `$first` within the statement that embeds it. */
export const emptyAccountGuard = (first: number) =>
  ACCOUNT_TABLES.map(
    (table, index) => `NOT EXISTS (SELECT 1 FROM "${table}" WHERE owner = $${first + index})`,
  ).join(" AND ");

/** Which kinds of records the owner already has. An empty list means a fresh account. */
export async function careRecordKinds(db: Database, owner: string): Promise<BackupTable[]> {
  const row = await db
    .prepare(existsSql)
    .bind(...ACCOUNT_TABLES.map(() => owner))
    .first<Record<BackupTable, boolean>>();
  return ACCOUNT_TABLES.filter((table) => row?.[table] === true);
}

/** Kinds that hold care data. A profile or change history alone is not a log waiting on a plan. */
export function loggedRecordKinds(kinds: readonly BackupTable[]): BackupTable[] {
  return kinds.filter((kind) => kind !== "profiles" && kind !== "care_audit");
}

const SESSION_TTL = 24 * 3600000;
const CLEANUP_ROWS = 5000;
const finished = "state IN ('cancelled','failed','complete')";

/**
 * Remove staged import rows in bounded steps: every finished session of this owner, plus any
 * session left unfinished for a day. Staged rows are copies that were never shown in the app.
 * Returns true while more rows remain.
 */
export async function cleanupImports(db: Database, owner: string): Promise<boolean> {
  const expired = new Date(Date.now() - SESSION_TTL).toISOString();
  // Keep the old timestamp so the expiry check below still matches sessions of other owners.
  await db
    .prepare(
      "UPDATE import_sessions SET state = 'cancelled' WHERE state IN ('staging','ready') AND updated < $1",
    )
    .bind(expired)
    .run();
  const removed = await db
    .prepare(
      `DELETE FROM import_rows WHERE ctid IN (SELECT ctid FROM import_rows WHERE session IN (SELECT id FROM import_sessions WHERE ${finished} AND (owner = $1 OR updated < $2)) LIMIT $3)`,
    )
    .bind(owner, expired, CLEANUP_ROWS)
    .run();
  if (removed.meta.changes >= CLEANUP_ROWS) return true;
  await db
    .prepare(
      "DELETE FROM import_sessions WHERE state IN ('cancelled','failed') AND (owner = $1 OR updated < $2) AND NOT EXISTS (SELECT 1 FROM import_rows WHERE import_rows.session = import_sessions.id)",
    )
    .bind(owner, expired)
    .run();
  return false;
}

/** A read-only check so ordinary page loads only write when there is staging to remove. */
export async function importCleanupNeeded(db: Database, owner: string): Promise<boolean> {
  const expired = new Date(Date.now() - SESSION_TTL).toISOString();
  const row = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM import_sessions WHERE (state IN ('staging','ready') AND updated < $1) OR (state IN ('cancelled','failed') AND owner = $2)) OR EXISTS (SELECT 1 FROM import_rows WHERE session IN (SELECT id FROM import_sessions WHERE ${finished} AND (owner = $3 OR updated < $4))) AS needed`,
    )
    .bind(expired, owner, owner, expired)
    .first<{ needed: boolean }>();
  return row?.needed === true;
}
