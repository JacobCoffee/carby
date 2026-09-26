import { getCurrentUser } from "@/app/auth";
import { database, type QueryResult, type Statement } from "@/db/raw";
import {
  BackupError,
  IMPORT_LIMITS,
  IMPORT_TABLES,
  importColumns,
  parseFooter,
  parseHeader,
  parseRow,
  planIsReady,
  tableLabels,
  type BackupTable,
  type ImportTable,
} from "@/lib/backup-import";
import {
  ACCOUNT_TABLES,
  careRecordKinds,
  cleanupImports,
  emptyAccountGuard,
} from "@/lib/care-records";

export const dynamic = "force-dynamic";

type DB = ReturnType<typeof database>;
type Session = {
  id: string;
  state: string;
  tables: string;
  source_owner: string | null;
  next_chunk: number;
  last_chunk: string | null;
  connection_rows: number;
  staged_rows: number;
  staged_bytes: number;
  summary: string | null;
  replace_existing: number;
  updated: string;
};
type StagedRow = { t: ImportTable; i: string; r: Record<string, string | null> };
type Outcome = {
  imported: Record<ImportTable, number>;
  total: number;
  planReady: boolean;
  connectionSkipped: boolean;
  replaced?: boolean;
};

const SESSION_TTL = 24 * 3600000;
const limits = {
  chunkRows: IMPORT_LIMITS.chunkRows,
  chunkBytes: IMPORT_LIMITS.chunkBytes,
  maxRows: IMPORT_LIMITS.maxRows,
  maxBytes: IMPORT_LIMITS.maxBytes,
  maxLineLength: IMPORT_LIMITS.maxLineLength,
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nothingChanged = "No records were added.";
const keptRecords = "Your current records were not changed.";
const sessionColumns =
  "id, state, tables, source_owner, next_chunk, last_chunk, connection_rows, staged_rows, staged_bytes, summary, replace_existing, updated";
const unchanged = (session: Pick<Session, "replace_existing"> | null) =>
  session?.replace_existing === 1 ? keptRecords : nothingChanged;

class RequestError extends Error {
  status: number;
  code?: string;
  extra?: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin";
}
/** A unique or primary key violation (SQLSTATE 23505). */
function isConstraint(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "23505";
}

/** Read at most `max` bytes; a larger upload is refused before it is buffered. */
async function readJson(request: Request, max: number): Promise<{ value: unknown; size: number }> {
  if (!/^application\/json(\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    throw new RequestError("Send the import as JSON.", 415);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max)
    throw new RequestError("This part of the import is too large.", 413);
  if (!request.body) throw new RequestError("Invalid request.", 400);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new RequestError("This part of the import is too large.", 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), size };
  } catch {
    throw new RequestError("Invalid JSON request.", 400);
  }
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Glucose readings and Dexcom events use IDs derived from the owner so later syncs recognize
 * the same point. Re-derive recognized IDs for the new owner. Any other ID in those tables is
 * namespaced to the new owner, so a backup cannot claim an ID another account will need later.
 * Every other table keeps its exported IDs, which keeps entry links and audit references intact.
 */
async function destinationId(
  table: ImportTable,
  row: Record<string, string | null>,
  source: string,
  owner: string,
): Promise<string> {
  const id = row.id as string;
  let key: ((who: string) => string) | null = null;
  if (table === "cgm_readings") key = (who) => who + "|" + row.at;
  else if (table === "dexcom_events") {
    const event = JSON.parse(row.data as string) as {
      at: string;
      type: string;
      details: string;
      value: number | null;
    };
    key = (who) =>
      who + "|" + event.at + "|" + event.type + "|" + event.details + "|" + String(event.value);
  }
  if (!key) return id;
  if (id === (await sha256Hex(key(source)))) return source === owner ? id : sha256Hex(key(owner));
  return sha256Hex(`${owner}|import|${table}|${id}`);
}

function listKinds(kinds: readonly BackupTable[]) {
  const names = kinds.map((kind) => tableLabels[kind].many);
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
function notEmpty(kinds: BackupTable[]) {
  return new RequestError(
    `This account already has ${listKinds(kinds)}, so nothing was changed. A backup is only added to an account with no records. To keep these records, enter your current care plan settings. To use the backup instead, choose to replace the records in this account.`,
    409,
    "not-empty",
    { existing: kinds },
  );
}

/** Replacement is opt in: a request asks with `mode: "replace"` and `confirmReplace: true`. */
function replaceRequested(body: Record<string, unknown>) {
  if (body.mode === undefined && body.confirmReplace === undefined) return false;
  if (body.mode !== "replace") throw new RequestError("Invalid import mode.", 400);
  if (body.confirmReplace !== true)
    throw new RequestError(
      `Confirm that the backup replaces every record in this account. ${keptRecords}`,
      400,
      "confirm-replace",
    );
  return true;
}

async function loadSession(db: DB, id: unknown, owner: string): Promise<Session> {
  if (typeof id !== "string" || !uuid.test(id)) throw new RequestError("Invalid import.", 400);
  const session = await db
    .prepare(`SELECT ${sessionColumns} FROM import_sessions WHERE id = $1 AND owner = $2`)
    .bind(id, owner)
    .first<Session>();
  if (!session)
    throw new RequestError(
      `This import is no longer available. Start again. ${nothingChanged}`,
      404,
      "gone",
    );
  return session;
}
function requireState(session: Session, states: string[]) {
  if (states.includes(session.state) && Date.parse(session.updated) > Date.now() - SESSION_TTL)
    return;
  const kept = unchanged(session);
  if (session.state === "complete")
    throw new RequestError("This import already finished.", 409, "complete");
  if (session.state === "cancelled")
    throw new RequestError(
      `This import was cancelled or replaced by a newer one. ${kept}`,
      409,
      "cancelled",
    );
  if (session.state === "failed")
    throw new RequestError(
      `This import stopped because of an earlier problem. Start again. ${kept}`,
      409,
      "failed",
    );
  throw new RequestError(`This import expired. Start again. ${kept}`, 409, "expired");
}
function storedOutcome(session: Session): Outcome | null {
  try {
    return session.summary ? (JSON.parse(session.summary) as Outcome) : null;
  } catch {
    return null;
  }
}

const cleanup = (db: DB, owner: string) => cleanupImports(db, owner);

async function fail(db: DB, session: string, owner: string) {
  await db
    .prepare(
      "UPDATE import_sessions SET state = 'failed', updated = $1 WHERE id = $2 AND owner = $3 AND state IN ('staging','ready')",
    )
    .bind(new Date().toISOString(), session, owner)
    .run();
  return cleanup(db, owner);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in to import a backup." }, 401);
  try {
    const existing = await careRecordKinds(database(), user.userId);
    return reply({ empty: existing.length === 0, existing, limits });
  } catch {
    return reply({ error: "Import is unavailable right now. Please retry." }, 503);
  }
}

async function start(db: DB, owner: string, body: Record<string, unknown>) {
  const header = parseHeader(body.header);
  const replacing = replaceRequested(body);
  if (!replacing) {
    const existing = await careRecordKinds(db, owner);
    if (existing.length) throw notEmpty(existing);
  }
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE import_sessions SET state = 'cancelled', updated = $1 WHERE owner = $2 AND state IN ('staging','ready')",
      )
      .bind(now, owner),
    db
      .prepare(
        "INSERT INTO import_sessions (id, owner, state, tables, exported_at, replace_existing, created, updated) VALUES ($1, $2, 'staging', $3, $4, $5, $6, $7)",
      )
      .bind(
        id,
        owner,
        JSON.stringify(header.tables),
        header.exportedAt,
        replacing ? 1 : 0,
        now,
        now,
      ),
  ]);
  const cleanupPending = await cleanup(db, owner);
  return reply({ sessionId: id, limits, cleanupPending });
}

async function chunk(
  db: DB,
  owner: string,
  body: Record<string, unknown>,
  size: number,
  track: (session: Session | null) => void,
) {
  const session = await loadSession(db, body.sessionId, owner);
  const { index, firstLine, rows } = body;
  if (
    typeof index !== "number" ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    typeof firstLine !== "number" ||
    !Number.isSafeInteger(firstLine) ||
    firstLine < 2 ||
    !Array.isArray(rows) ||
    rows.length < 1 ||
    rows.length > IMPORT_LIMITS.chunkRows
  )
    throw new RequestError("Invalid import part.", 400);
  const hash = await sha256Hex(`${session.id}|${index}|${JSON.stringify(rows)}`);
  // Finishing freezes the session as ready, and a retried part can still arrive after that.
  const open = (current: Session) => current.state === "staging" || current.state === "ready";
  const replayed = (current: Session) =>
    open(current) && index === current.next_chunk - 1 && current.last_chunk === hash;
  // A delayed copy of a part that already arrived cannot change staging, so it never fails the import.
  const stale = (current: Session) => open(current) && index < current.next_chunk;
  const duplicate = () =>
    new RequestError("This part of the import already arrived.", 409, "duplicate");
  if (replayed(session)) return reply({ ok: true, replayed: true, next: session.next_chunk });
  if (stale(session)) throw duplicate();
  track(session);
  requireState(session, ["staging"]);
  if (index !== session.next_chunk)
    throw new RequestError(
      `Parts of the import arrived out of order. Start again. ${unchanged(session)}`,
      409,
      "order",
    );
  const lastLine = firstLine + rows.length - 1;
  const tables = JSON.parse(session.tables) as BackupTable[];
  const parsed = rows.map((item, offset) => parseRow(item, tables, firstLine + offset, "stub"));
  const source = session.source_owner ?? parsed[0].owner;
  const mixed = parsed.findIndex((row) => row.owner !== source);
  if (mixed >= 0)
    throw new BackupError(
      `Line ${firstLine + mixed} belongs to a different account than earlier lines. Carby imports a backup from one account at a time.`,
    );
  const seen = new Set<string>(),
    staged: StagedRow[] = [];
  let connections = 0;
  for (const [offset, item] of parsed.entries()) {
    if (item.table === "dexcom_connections") {
      connections++;
      continue;
    }
    const id = await destinationId(item.table, item.row, source, owner);
    const key = item.table + "|" + id;
    if (seen.has(key))
      throw new BackupError(
        `Line ${firstLine + offset} repeats a record that appears earlier in the backup. The backup may be damaged.`,
      );
    seen.add(key);
    // The source owner is not stored; activation binds the signed-in owner instead.
    const row: Record<string, string | null> = { ...item.row, id };
    delete row.owner;
    staged.push({ t: item.table, i: id, r: row });
  }
  const now = new Date().toISOString(),
    expired = new Date(Date.now() - SESSION_TTL).toISOString();
  const advance =
    "UPDATE import_sessions SET next_chunk = next_chunk + 1, last_chunk = $1, source_owner = COALESCE(source_owner, $2), connection_rows = connection_rows + $3, staged_rows = staged_rows + $4, staged_bytes = staged_bytes + $5, updated = $6 WHERE id = $7 AND owner = $8 AND state = 'staging' AND next_chunk = $9 AND (source_owner IS NULL OR source_owner = $10) AND connection_rows + $11 <= 1 AND staged_rows + $12 <= $13 AND staged_bytes + $14 <= $15 AND updated > $16";
  const advanceArgs = [
    hash,
    source,
    connections,
    rows.length,
    size,
    now,
    session.id,
    owner,
    index,
    source,
    connections,
    rows.length,
    IMPORT_LIMITS.maxRows,
    size,
    IMPORT_LIMITS.maxBytes,
    expired,
  ];
  // One statement. Rows are staged only from this request's own cursor update, so a concurrent
  // copy of this part inserts nothing. A plain INSERT: a repeated ID aborts the whole statement,
  // including the cursor update.
  const statement = staged.length
    ? db
        .prepare(
          `WITH advanced AS (${advance} RETURNING id) INSERT INTO import_rows (session, tbl, row_id, payload) SELECT advanced.id, item->>'t', item->>'i', item->'r' FROM advanced CROSS JOIN jsonb_array_elements($${advanceArgs.length + 1}::jsonb) AS item`,
        )
        .bind(...advanceArgs, JSON.stringify(staged))
    : db.prepare(advance).bind(...advanceArgs);
  let changes: number;
  try {
    changes = (await statement.run()).meta.changes;
  } catch (error) {
    if (isConstraint(error))
      throw new BackupError(
        `Lines ${firstLine} to ${lastLine} repeat records that appear earlier in the backup. The backup may be damaged.`,
      );
    throw error;
  }
  // Zero means the cursor update did not apply; otherwise every staged row (or the cursor) counts.
  if (changes === 0) {
    const current = await loadSession(db, session.id, owner);
    if (replayed(current)) return reply({ ok: true, replayed: true, next: current.next_chunk });
    if (stale(current)) {
      track(null);
      throw duplicate();
    }
    requireState(current, ["staging"]);
    if (current.connection_rows + connections > 1)
      throw new BackupError(
        `Line ${firstLine + parsed.findIndex((row) => row.table === "dexcom_connections")} is a second Dexcom Share connection. A backup has at most one.`,
      );
    if (current.source_owner && current.source_owner !== source)
      throw new BackupError(
        `Line ${firstLine} belongs to a different account than earlier lines. Carby imports a backup from one account at a time.`,
      );
    if (
      current.staged_rows + rows.length > IMPORT_LIMITS.maxRows ||
      current.staged_bytes + size > IMPORT_LIMITS.maxBytes
    )
      throw new BackupError(
        `This backup is larger than Carby can import at once (${IMPORT_LIMITS.maxRows.toLocaleString("en-US")} records or ${Math.round(IMPORT_LIMITS.maxBytes / 1048576)} MB).`,
      );
    throw new RequestError(
      `Parts of the import arrived out of order. Start again. ${unchanged(current)}`,
      409,
      "order",
    );
  }
  if (changes !== Math.max(staged.length, 1)) throw new Error("staged row count mismatch");
  return reply({ ok: true, next: index + 1 });
}

/** A concurrent finish may already have completed the import; report that instead of an error. */
async function finish(
  db: DB,
  owner: string,
  body: Record<string, unknown>,
  track: (session: Session | null) => void,
) {
  try {
    return await finishOnce(db, owner, body, track);
  } catch (error) {
    if (
      !(error instanceof BackupError || error instanceof RequestError) ||
      typeof body.sessionId !== "string" ||
      !uuid.test(body.sessionId)
    )
      throw error;
    const current = await db
      .prepare(`SELECT ${sessionColumns} FROM import_sessions WHERE id = $1 AND owner = $2`)
      .bind(body.sessionId, owner)
      .first<Session>();
    const outcome = current && current.state === "complete" ? storedOutcome(current) : null;
    if (!outcome) throw error;
    track(null);
    return reply({
      ok: true,
      replayed: true,
      ...outcome,
      cleanupPending: await cleanup(db, owner).catch(() => true),
    });
  }
}

async function finishOnce(
  db: DB,
  owner: string,
  body: Record<string, unknown>,
  track: (session: Session | null) => void,
) {
  let session = await loadSession(db, body.sessionId, owner);
  const done = storedOutcome(session);
  if (session.state === "complete" && done)
    return reply({ ok: true, replayed: true, ...done, cleanupPending: await cleanup(db, owner) });
  // The mode comes only from the session; a finish request can neither add nor drop replacement.
  const replacing = session.replace_existing === 1;
  if (replaceRequested(body) !== replacing)
    throw new RequestError(
      replacing
        ? `Confirm that the backup replaces every record in this account. ${keptRecords}`
        : `This import was not started as a replacement. Start again. ${nothingChanged}`,
      400,
      replacing ? "confirm-replace" : "mode-mismatch",
    );
  track(session);
  requireState(session, ["staging", "ready"]);
  if (session.next_chunk !== body.chunks)
    throw new BackupError("Some parts of the import did not arrive.");
  if (session.state === "staging") {
    // Freeze the session first so no late part can change what is checked below.
    const frozen = await db
      .prepare(
        "UPDATE import_sessions SET state = 'ready', updated = $1 WHERE id = $2 AND owner = $3 AND state = 'staging' AND next_chunk = $4",
      )
      .bind(new Date().toISOString(), session.id, owner, session.next_chunk)
      .run();
    session = await loadSession(db, session.id, owner);
    if ((frozen.meta.changes ?? 0) !== 1) {
      const outcome = storedOutcome(session);
      if (session.state === "complete" && outcome)
        return reply({ ok: true, replayed: true, ...outcome, cleanupPending: false });
      requireState(session, ["ready"]);
    }
  }
  const tables = JSON.parse(session.tables) as BackupTable[];
  const expected = parseFooter(body.footer, tables);
  const staged = await db
    .prepare("SELECT tbl, COUNT(*) AS n FROM import_rows WHERE session = $1 GROUP BY tbl")
    .bind(session.id)
    .all<{ tbl: string; n: string }>();
  const actual = new Map(staged.results.map((row) => [row.tbl, Number(row.n)]));
  for (const table of tables) {
    const count =
      table === "dexcom_connections" ? session.connection_rows : (actual.get(table) ?? 0);
    if (count !== expected[table])
      throw new BackupError(
        `The backup is incomplete: it should have ${expected[table].toLocaleString("en-US")} ${tableLabels[table].many} but ${count.toLocaleString("en-US")} arrived. Download it again from your other deployment.`,
      );
  }
  if ((actual.get("profiles") ?? 0) > 1)
    throw new BackupError("This backup has more than one profile. A backup has at most one.");
  const imported = Object.fromEntries(
    IMPORT_TABLES.map((table) => [table, actual.get(table) ?? 0]),
  ) as Record<ImportTable, number>;
  const total = Object.values(imported).reduce((sum, count) => sum + count, 0);
  if (total === 0) throw new BackupError("This backup has no records to import.");
  const present = IMPORT_TABLES.filter((table) => imported[table] > 0);
  // IDs are unique across the whole deployment. An empty account owns none, so any match belongs
  // to another account. A replacement deletes this owner's rows first, so its own IDs may match.
  let param = 0;
  const collisions = await db
    .prepare(
      present
        .map(
          (table) =>
            `SELECT COUNT(*) AS n FROM import_rows s JOIN "${table}" x ON x.id = s.row_id WHERE s.session = $${++param} AND s.tbl = '${table}'${replacing ? ` AND x.owner <> $${++param}` : ""}`,
        )
        .join(" UNION ALL "),
    )
    .bind(...present.flatMap(() => (replacing ? [session.id, owner] : [session.id])))
    .all<{ n: string }>();
  if (collisions.results.some((row) => Number(row.n) > 0))
    throw new RequestError(
      `Some records in this backup already exist in this Carby deployment under another account. This usually means the backup came from this same deployment. ${unchanged(session)}`,
      409,
      "id-conflict",
    );
  const latest = await db
    .prepare(
      "SELECT payload->>'data' AS data FROM import_rows WHERE session = $1 AND tbl = 'plans' ORDER BY payload->>'created' DESC LIMIT 1",
    )
    .bind(session.id)
    .first<{ data: string }>();
  const outcome: Outcome = {
    imported,
    total,
    planReady: !!latest && planIsReady(latest.data),
    connectionSkipped: session.connection_rows > 0,
    ...(replacing ? { replaced: true } : {}),
  };
  const now = new Date().toISOString();
  // Each copy binds the owner as $1 and the session as $2, so its guard is numbered from $3.
  const copy = (guard: (first: number) => string, ...guardArgs: string[]) =>
    present.map((table) => {
      const columns = importColumns[table];
      const values = columns
        .map((column) => (column === "owner" ? "$1" : `payload->>'${column}'`))
        .join(", ");
      return db
        .prepare(
          `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) SELECT ${values} FROM import_rows WHERE session = $2 AND tbl = '${table}' AND ${guard(3)}`,
        )
        .bind(owner, session.id, ...guardArgs);
    });
  let statements: Statement[];
  if (!replacing) {
    const activating = (first: number) =>
      `EXISTS (SELECT 1 FROM import_sessions WHERE id = $${first} AND owner = $${first + 1} AND state = 'activating')`;
    // One transaction: claim the still-empty account, copy every staged table, mark complete.
    statements = [
      db
        .prepare(
          `UPDATE import_sessions SET state = 'activating', updated = $1 WHERE id = $2 AND owner = $3 AND state = 'ready' AND ${emptyAccountGuard(4)}`,
        )
        .bind(now, session.id, owner, ...ACCOUNT_TABLES.map(() => owner)),
      ...copy(activating, session.id, owner),
      db
        .prepare(
          "UPDATE import_sessions SET state = 'complete', summary = $1, updated = $2 WHERE id = $3 AND owner = $4 AND state = 'activating'",
        )
        .bind(JSON.stringify(outcome), now, session.id, owner),
    ];
  } else {
    // One transaction: claim the ready replacement with a token unique to this request, delete
    // every record this owner has at this moment, copy every staged table, mark complete. Each
    // later statement requires this token, so a losing concurrent finish, a cancel or a replay
    // deletes and adds nothing. Any failure rolls back the deletes with everything else.
    const claim = crypto.randomUUID();
    const claimed = (first: number) =>
      `EXISTS (SELECT 1 FROM import_sessions WHERE id = $${first} AND owner = $${first + 1} AND state = 'activating' AND replace_existing = 1 AND activation_claim = $${first + 2})`;
    statements = [
      db
        .prepare(
          "UPDATE import_sessions SET state = 'activating', activation_claim = $1, updated = $2 WHERE id = $3 AND owner = $4 AND state = 'ready' AND replace_existing = 1",
        )
        .bind(claim, now, session.id, owner),
      ...ACCOUNT_TABLES.map((table) =>
        db
          .prepare(`DELETE FROM "${table}" WHERE owner = $1 AND ${claimed(2)}`)
          .bind(owner, session.id, owner, claim),
      ),
      ...copy(claimed, session.id, owner, claim),
      db
        .prepare(
          "UPDATE import_sessions SET state = 'complete', summary = $1, updated = $2 WHERE id = $3 AND owner = $4 AND state = 'activating' AND activation_claim = $5",
        )
        .bind(JSON.stringify(outcome), now, session.id, owner, claim),
    ];
  }
  let results: QueryResult[];
  try {
    results = await db.batch(statements);
  } catch (error) {
    if (isConstraint(error))
      throw new RequestError(
        `Some records in this backup already exist in this Carby deployment under another account. ${unchanged(session)}`,
        409,
        "id-conflict",
      );
    // The batch rolled back and the session is still ready, so finishing can be retried.
    track(null);
    throw error;
  }
  if ((results[0].meta.changes ?? 0) !== 1) {
    if (!replacing) {
      const existing = await careRecordKinds(db, owner);
      if (existing.length) throw notEmpty(existing);
    }
    requireState(await loadSession(db, session.id, owner), ["ready"]);
    track(null);
    throw new RequestError(
      replacing
        ? `The replacement could not finish. ${keptRecords} Please retry.`
        : "The import could not finish. Please retry.",
      503,
    );
  }
  const first = 1 + (replacing ? ACCOUNT_TABLES.length : 0);
  const inserted = results
    .slice(first, first + present.length)
    .reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
  if (inserted !== total) console.error("backup import count mismatch");
  track(null);
  const cleanupPending = await cleanup(db, owner).catch(() => true);
  return reply({ ok: true, ...outcome, cleanupPending });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in to import a backup." }, 401);
  if (!sameOrigin(request)) return reply({ error: "Request origin rejected." }, 403);
  const owner = user.userId;
  let db: DB;
  try {
    db = database();
  } catch {
    return reply({ error: "Storage is unavailable." }, 503);
  }
  // Set once a request has touched a session; a rejected backup then fails that session.
  const touched: { session: Session | null } = { session: null };
  const track = (session: Session | null) => {
    touched.session = session;
  };
  try {
    const { value, size } = await readJson(request, IMPORT_LIMITS.requestBytes);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new RequestError("Invalid request.", 400);
    const body = value as Record<string, unknown>;
    if (body.action === "start") return await start(db, owner, body);
    if (body.action === "chunk") return await chunk(db, owner, body, size, track);
    if (body.action === "finish") return await finish(db, owner, body, track);
    if (body.action === "cancel") {
      const session = await loadSession(db, body.sessionId, owner);
      const outcome = storedOutcome(session);
      if (session.state === "complete" && outcome)
        return reply({
          ok: true,
          state: "complete",
          ...outcome,
          cleanupPending: await cleanup(db, owner),
        });
      await db
        .prepare(
          "UPDATE import_sessions SET state = 'cancelled', updated = $1 WHERE id = $2 AND owner = $3 AND state IN ('staging','ready')",
        )
        .bind(new Date().toISOString(), session.id, owner)
        .run();
      return reply({ ok: true, state: "cancelled", cleanupPending: await cleanup(db, owner) });
    }
    if (body.action === "cleanup")
      return reply({ ok: true, cleanupPending: await cleanup(db, owner) });
    throw new RequestError("Invalid action.", 400);
  } catch (error) {
    if (error instanceof BackupError || error instanceof RequestError) {
      const status = error instanceof RequestError ? error.status : 422;
      const code = error instanceof RequestError ? error.code : "invalid-backup";
      let cleanupPending = false;
      if (touched.session && status !== 400) {
        try {
          cleanupPending = await fail(db, touched.session.id, owner);
        } catch {
          cleanupPending = true;
        }
      }
      const message =
        error instanceof BackupError && touched.session
          ? `${error.message} ${unchanged(touched.session)}`
          : error.message;
      return reply(
        {
          error: message,
          code,
          cleanupPending,
          ...(error instanceof RequestError ? error.extra : {}),
        },
        status,
      );
    }
    // Never log backup content; the error name is enough to trace a failure. Staging stays as it
    // was, so the same request can be retried.
    console.error("backup import failed", error instanceof Error ? error.name : "unknown");
    return reply({ error: "The import could not continue. Please retry.", retry: true }, 503);
  }
}
