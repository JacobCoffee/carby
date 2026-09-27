import { z } from "zod";
import type { Database, Statement } from "../db/postgres";
import { appointmentSchema } from "./appointments";
import { entrySchema, planSchema, savedFoodSchema } from "./care";
import { illnessSchema } from "./illness";
import { profileSchema } from "./profile";

/**
 * One-way sync: care records saved on one deployment (the sender) are forwarded to another (the
 * receiver). The sender queues each changed record in `sync_outbox` in the same transaction as
 * the change, then sends the record as it now stands. The receiver applies it only when its own
 * copy is still the one the sender last had, so a record edited directly on the receiver is
 * held back as a conflict instead of being overwritten. CGM readings and Dexcom events are not
 * sent: each deployment syncs its own from Dexcom.
 */
export const SYNC_TABLES = [
  "entries",
  "plans",
  "saved_foods",
  "illness_windows",
  "appointments",
  "profiles",
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
export type SyncRef = { table: SyncTable; id: string };

/** Tables whose records carry a `revision`, so an edit made on the receiver can be detected. */
const TRACKED = new Set<SyncTable>(["entries", "illness_windows", "appointments"]);
/** Changes per request, and requests per flush. */
const BATCH = 50;
const ROUNDS = 20;
const TIMEOUT_MS = 15000;
const MIN_TOKEN = 32;

export type PushConfig = { url: string; token: string; person: string };
export type AcceptConfig = { token: string; person: string };
type Env = Record<string, string | undefined>;

/** Sender settings: all three, a URL without a path, and a long token, or no sending. */
export function pushConfig(env: Env): PushConfig | null {
  const url = env.CARBY_SYNC_PUSH_URL?.trim() ?? "";
  const token = env.CARBY_SYNC_PUSH_TOKEN?.trim() ?? "";
  const person = env.CARBY_SYNC_PUSH_PERSON?.trim() ?? "";
  if (!url || !person || token.length < MIN_TOKEN) return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" &&
      parsed.hostname !== "localhost" &&
      parsed.hostname !== "127.0.0.1"
    )
      return null;
    return { url: parsed.origin, token, person };
  } catch {
    return null;
  }
}

/** Receiver settings: a long token and the person every received record belongs to. */
export function acceptConfig(env: Env): AcceptConfig | null {
  const token = env.CARBY_SYNC_ACCEPT_TOKEN?.trim() ?? "";
  const person = env.CARBY_SYNC_ACCEPT_PERSON?.trim() ?? "";
  return person && token.length >= MIN_TOKEN ? { token, person } : null;
}

const id = z.string().min(1).max(200);
const json = z.string().min(2).max(200000);
const change = <T extends SyncTable, R extends z.ZodTypeAny>(table: T, row: R) =>
  z.object({ table: z.literal(table), id, previous: z.string().max(200).nullable(), row });
/** One record as the receiver should store it; `row: null` deletes it. */
export const syncChangeSchema = z.discriminatedUnion("table", [
  change("entries", z.object({ at: z.string().datetime(), data: json, plan: json }).nullable()),
  change("plans", z.object({ data: json, created: z.string().datetime() })),
  change("saved_foods", z.object({ data: json }).nullable()),
  change("illness_windows", z.object({ data: json }).nullable()),
  change("appointments", z.object({ at: z.string().datetime(), data: json }).nullable()),
  change("profiles", z.object({ data: json })),
]);
export type SyncChange = z.infer<typeof syncChangeSchema>;
export const syncRequestSchema = z.object({ changes: z.array(syncChangeSchema).min(1).max(BATCH) });
export type SyncResult = {
  table: SyncTable;
  id: string;
  status: "applied" | "same" | "conflict" | "rejected";
  /** The receiver's revision when it holds back a conflict. */
  theirs?: string | null;
  error?: string;
};

/** The `revision` in a stored record's JSON, or null. */
export function revisionOf(data: string | null) {
  if (!data) return null;
  try {
    const value: unknown = JSON.parse(data);
    return value &&
      typeof value === "object" &&
      "revision" in value &&
      typeof value.revision === "string"
      ? value.revision
      : null;
  } catch {
    return null;
  }
}

/**
 * What the receiver does with a change. `current` is its stored copy (null when it has none),
 * `previous` the sender's revision before its first unsent change, `incoming` the new copy
 * (null to delete). A tracked record changed on the receiver since is a conflict.
 */
export function syncDecision(
  table: SyncTable,
  current: string | null,
  previous: string | null,
  incoming: string | null,
): "apply" | "same" | "conflict" {
  if (current === incoming) return "same";
  if (current === null) return incoming === null ? "same" : "apply";
  if (!TRACKED.has(table)) return "apply";
  return revisionOf(current) === previous ? "apply" : "conflict";
}

/** The record's data checked against the app's own schema, and that it names the same record. */
function validRecord(change: SyncChange) {
  if (!change.row) return true;
  let data: unknown;
  try {
    data = JSON.parse(change.row.data);
  } catch {
    return false;
  }
  const parsed =
    change.table === "entries"
      ? entrySchema.safeParse(data)
      : change.table === "plans"
        ? planSchema.safeParse(data)
        : change.table === "saved_foods"
          ? savedFoodSchema.safeParse(data)
          : change.table === "illness_windows"
            ? illnessSchema.safeParse(data)
            : change.table === "appointments"
              ? appointmentSchema.safeParse(data)
              : profileSchema.safeParse(data);
  if (!parsed.success) return false;
  return change.table === "plans" || ("id" in parsed.data && parsed.data.id === change.id);
}

function audit(
  db: Database,
  person: string,
  actor: string,
  recordId: string,
  action: "created" | "updated" | "deleted" | "plan updated",
  before: string | null,
  after: string | null,
) {
  return db
    .prepare(
      'INSERT INTO care_audit (id, owner, entry_id, actor_id, actor_name, action, "before", "after", at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    )
    .bind(
      crypto.randomUUID(),
      person,
      recordId,
      "sync",
      actor,
      action,
      before,
      after,
      new Date().toISOString(),
    );
}

/** Stores one received change for `person`, audited as made by `actor` (the sender's name). */
export async function applySyncChange(
  db: Database,
  person: string,
  actor: string,
  change: SyncChange,
): Promise<SyncResult> {
  const result = (status: SyncResult["status"], extra: Partial<SyncResult> = {}): SyncResult => ({
    table: change.table,
    id: change.id,
    status,
    ...extra,
  });
  if (!validRecord(change)) return result("rejected", { error: "The record failed validation." });
  const existing =
    change.table === "profiles"
      ? await db
          .prepare("SELECT owner, data FROM profiles WHERE owner = $1")
          .bind(person)
          .first<{ owner: string; data: string }>()
      : await db
          .prepare(`SELECT owner, data FROM ${change.table} WHERE id = $1`)
          .bind(change.id)
          .first<{ owner: string; data: string }>();
  if (existing && existing.owner !== person)
    return result("rejected", { error: "A record with this id belongs to someone else here." });
  const current = existing?.data ?? null;
  const incoming = change.row?.data ?? null;
  const decision = syncDecision(change.table, current, change.previous, incoming);
  if (decision === "same") return result("same");
  if (decision === "conflict")
    return result("conflict", {
      theirs: revisionOf(current),
      error: "It was changed here since it was last sent.",
    });
  const now = new Date().toISOString();
  // Every write is guarded by the copy read above, so a change made meanwhile is not lost.
  let write: Statement;
  let action: "created" | "updated" | "deleted" | "plan updated" | null = current
    ? incoming
      ? "updated"
      : "deleted"
    : "created";
  const row = change.row;
  if (change.table === "plans") {
    const prior = await db
      .prepare("SELECT data FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 1")
      .bind(person)
      .first<{ data: string }>();
    write = db
      .prepare(
        "INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4) ON CONFLICT(id) DO NOTHING",
      )
      .bind(change.id, person, change.row.data, change.row.created);
    const results = await db.batch([
      write,
      audit(db, person, actor, change.id, "plan updated", prior?.data ?? null, change.row.data),
    ]);
    return results[0].meta.changes
      ? result("applied")
      : result("conflict", { error: "Saved here meanwhile." });
  }
  if (change.table === "profiles") {
    write = db
      .prepare(
        "INSERT INTO profiles (id, owner, data, updated) VALUES ($1, $2, $3, $4) ON CONFLICT (owner) DO UPDATE SET id = excluded.id, data = excluded.data, updated = excluded.updated",
      )
      .bind(change.id, person, change.row.data, now);
    action = null;
  } else if (!row) {
    write = db
      .prepare(`DELETE FROM ${change.table} WHERE id = $1 AND owner = $2 AND data = $3`)
      .bind(change.id, person, current);
    if (change.table === "saved_foods") action = null;
  } else if (change.table === "saved_foods") {
    const food = savedFoodSchema.parse(JSON.parse(row.data));
    write = current
      ? db
          .prepare(
            "UPDATE saved_foods SET name = $1, data = $2, updated = $3 WHERE id = $4 AND owner = $5 AND data = $6",
          )
          .bind(food.name, row.data, now, change.id, person, current)
      : db
          .prepare(
            "INSERT INTO saved_foods (id, owner, name, data, updated) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO NOTHING",
          )
          .bind(change.id, person, food.name, row.data, now);
    action = null;
  } else if (change.table === "illness_windows") {
    const startDate = illnessSchema.parse(JSON.parse(row.data)).startDate;
    write = current
      ? db
          .prepare(
            "UPDATE illness_windows SET start_date = $1, data = $2, updated = $3 WHERE id = $4 AND owner = $5 AND data = $6",
          )
          .bind(startDate, row.data, now, change.id, person, current)
      : db
          .prepare(
            "INSERT INTO illness_windows (id, owner, start_date, data, updated) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO NOTHING",
          )
          .bind(change.id, person, startDate, row.data, now);
  } else if (change.table === "appointments" && "at" in row) {
    write = current
      ? db
          .prepare(
            "UPDATE appointments SET at = $1, data = $2, updated = $3 WHERE id = $4 AND owner = $5 AND data = $6",
          )
          .bind(row.at, row.data, now, change.id, person, current)
      : db
          .prepare(
            "INSERT INTO appointments (id, owner, at, data, updated) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO NOTHING",
          )
          .bind(change.id, person, row.at, row.data, now);
  } else if (change.table === "entries" && "plan" in row) {
    write = current
      ? db
          .prepare(
            "UPDATE entries SET at = $1, data = $2, updated = $3 WHERE id = $4 AND owner = $5 AND data = $6",
          )
          .bind(row.at, row.data, now, change.id, person, current)
      : db
          .prepare(
            "INSERT INTO entries (id, owner, at, data, plan, updated) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(id) DO NOTHING",
          )
          .bind(change.id, person, row.at, row.data, row.plan, now);
  } else return result("rejected", { error: "The record failed validation." });
  const results = await db.batch(
    action ? [write, audit(db, person, actor, change.id, action, current, incoming)] : [write],
  );
  return results[0].meta.changes
    ? result("applied")
    : result("conflict", { theirs: null, error: "It was changed here while this was being sent." });
}

const REVISION_SQL = (table: SyncTable) =>
  TRACKED.has(table)
    ? `(SELECT data::jsonb->>'revision' FROM ${table} WHERE id = $3 AND owner = $1)`
    : "NULL";

/**
 * Statements that queue these records for sending, for the same batch as the change and ahead
 * of it, so `previous` reads each record before the change. Empty when this deployment doesn't
 * send, or sends a different person.
 */
export function queueSyncStatements(
  db: Database,
  config: PushConfig | null,
  owner: string,
  refs: readonly SyncRef[],
): Statement[] {
  if (!config || owner !== config.person) return [];
  return refs.map((ref) =>
    db
      .prepare(
        `INSERT INTO sync_outbox (owner, tbl, record_id, previous, queued, state) VALUES ($1, $2, $3, ${REVISION_SQL(ref.table)}, $4, 'pending') ON CONFLICT (owner, tbl, record_id) DO UPDATE SET queued = excluded.queued, state = 'pending', error = NULL`,
      )
      .bind(owner, ref.table, ref.id, `${new Date().toISOString()} ${crypto.randomUUID()}`),
  );
}

type OutboxRow = { tbl: SyncTable; record_id: string; previous: string | null; queued: string };

/** The record as it now stands here, as a change to send. */
async function outgoing(db: Database, owner: string, row: OutboxRow): Promise<SyncChange> {
  const base = { id: row.record_id, previous: row.previous };
  const find = <T>(sql: string, ...args: unknown[]) =>
    db
      .prepare(sql)
      .bind(...args)
      .first<T>();
  switch (row.tbl) {
    case "entries":
      return {
        ...base,
        table: row.tbl,
        row: await find<{ at: string; data: string; plan: string }>(
          "SELECT at, data, plan FROM entries WHERE id = $1 AND owner = $2",
          row.record_id,
          owner,
        ),
      };
    case "plans": {
      const plan = await find<{ data: string; created: string }>(
        "SELECT data, created FROM plans WHERE id = $1 AND owner = $2",
        row.record_id,
        owner,
      );
      if (!plan) throw new Error("plan missing");
      return { ...base, table: row.tbl, row: plan };
    }
    case "saved_foods":
      return {
        ...base,
        table: row.tbl,
        row: await find<{ data: string }>(
          "SELECT data FROM saved_foods WHERE id = $1 AND owner = $2",
          row.record_id,
          owner,
        ),
      };
    case "illness_windows":
      return {
        ...base,
        table: row.tbl,
        row: await find<{ data: string }>(
          "SELECT data FROM illness_windows WHERE id = $1 AND owner = $2",
          row.record_id,
          owner,
        ),
      };
    case "appointments":
      return {
        ...base,
        table: row.tbl,
        row: await find<{ at: string; data: string }>(
          "SELECT at, data FROM appointments WHERE id = $1 AND owner = $2",
          row.record_id,
          owner,
        ),
      };
    case "profiles": {
      const profile = await find<{ id: string; data: string }>(
        "SELECT id, data FROM profiles WHERE owner = $1",
        owner,
      );
      if (!profile) throw new Error("profile missing");
      return { ...base, id: profile.id, table: row.tbl, row: { data: profile.data } };
    }
  }
}

const running = new Map<string, Promise<void>>();

/**
 * Sends everything queued for `owner`, oldest first, until nothing is pending or a request
 * fails. One flush per owner runs at a time; a call while one runs waits for it.
 */
export function flushSync(
  db: Database,
  config: PushConfig | null,
  owner: string,
  send: typeof fetch = fetch,
): Promise<void> {
  if (!config || owner !== config.person) return Promise.resolve();
  const active = running.get(owner);
  if (active) return active;
  const run = (async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rows = (
        await db
          .prepare(
            "SELECT tbl, record_id, previous, queued FROM sync_outbox WHERE owner = $1 AND state = 'pending' ORDER BY queued LIMIT $2",
          )
          .bind(owner, BATCH)
          .all<OutboxRow>()
      ).results;
      if (!rows.length) return;
      const changes: SyncChange[] = [];
      for (const row of rows) {
        try {
          changes.push(await outgoing(db, owner, row));
        } catch {
          await db
            .prepare("DELETE FROM sync_outbox WHERE owner = $1 AND tbl = $2 AND record_id = $3")
            .bind(owner, row.tbl, row.record_id)
            .run();
        }
      }
      if (!changes.length) continue;
      let results: SyncResult[];
      try {
        const response = await send(`${config.url}/api/sync`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ changes }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body: unknown = await response.json().catch(() => null);
        if (
          !response.ok ||
          !body ||
          typeof body !== "object" ||
          !("results" in body) ||
          !Array.isArray(body.results)
        )
          throw new Error(
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : `The other Carby answered ${response.status}.`,
          );
        results = body.results as SyncResult[];
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not reach the other Carby.";
        await db
          .prepare("UPDATE sync_outbox SET error = $2 WHERE owner = $1 AND state = 'pending'")
          .bind(owner, message.slice(0, 300))
          .run();
        return;
      }
      for (const [index, sent] of changes.entries()) {
        const row = rows.find(
          (r) => r.tbl === sent.table && (r.record_id === sent.id || r.tbl === "profiles"),
        )!;
        const outcome = results[index];
        if (!outcome || outcome.table !== sent.table || outcome.id !== sent.id) continue;
        if (outcome.status === "applied" || outcome.status === "same") {
          // Clear it, unless it changed again while sending: then what the receiver now holds is
          // the revision just sent.
          const cleared = await db
            .prepare(
              "DELETE FROM sync_outbox WHERE owner = $1 AND tbl = $2 AND record_id = $3 AND queued = $4",
            )
            .bind(owner, row.tbl, row.record_id, row.queued)
            .run();
          if (!cleared.meta.changes)
            await db
              .prepare(
                "UPDATE sync_outbox SET previous = $4 WHERE owner = $1 AND tbl = $2 AND record_id = $3",
              )
              .bind(owner, row.tbl, row.record_id, revisionOf(sent.row?.data ?? null))
              .run();
        } else
          await db
            .prepare(
              "UPDATE sync_outbox SET state = $4, theirs = $5, error = $6 WHERE owner = $1 AND tbl = $2 AND record_id = $3 AND queued = $7",
            )
            .bind(
              owner,
              row.tbl,
              row.record_id,
              outcome.status,
              outcome.theirs ?? null,
              (outcome.error ?? "").slice(0, 300),
              row.queued,
            )
            .run();
      }
    }
  })().finally(() => running.delete(owner));
  running.set(owner, run);
  return run;
}

export type SyncStatus = {
  target: string;
  pending: number;
  /** Why the last attempt to send failed, while changes are still waiting. */
  error: string | null;
  held: { table: SyncTable; id: string; state: "conflict" | "rejected"; error: string | null }[];
};

export async function syncStatus(
  db: Database,
  config: PushConfig | null,
  owner: string,
): Promise<SyncStatus | null> {
  if (!config || owner !== config.person) return null;
  const rows = (
    await db
      .prepare(
        "SELECT tbl, record_id, state, error FROM sync_outbox WHERE owner = $1 ORDER BY queued",
      )
      .bind(owner)
      .all<{ tbl: SyncTable; record_id: string; state: string; error: string | null }>()
  ).results;
  const pending = rows.filter((r) => r.state === "pending");
  return {
    target: new URL(config.url).host,
    pending: pending.length,
    error: pending.find((r) => r.error)?.error ?? null,
    held: rows.flatMap((r) =>
      r.state === "conflict" || r.state === "rejected"
        ? [{ table: r.tbl, id: r.record_id, state: r.state, error: r.error }]
        : [],
    ),
  };
}

/** "Send mine anyway" sends held changes against the receiver's copy; "keep theirs" drops them. */
export function resolveHeld(db: Database, owner: string, choice: "send" | "discard") {
  return db
    .prepare(
      choice === "send"
        ? "UPDATE sync_outbox SET state = 'pending', previous = theirs, theirs = NULL, error = NULL WHERE owner = $1 AND state = 'conflict'"
        : "DELETE FROM sync_outbox WHERE owner = $1 AND state IN ('conflict', 'rejected')",
    )
    .bind(owner)
    .run();
}
