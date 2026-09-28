import type { Database, Statement } from "../db/postgres";
import { entrySchema, planSchema } from "./care";
import { cgmRowId } from "./cgm-sql";
import {
  canonical,
  dedupeKey,
  docTime,
  entryId,
  FUTURE_SLACK_MS,
  isDoc,
  MAX_QUERY_COUNT,
  MAX_UPLOAD_DOCS,
  project,
  sha256,
  stableObjectId,
  validId,
  type Condition,
  type Doc,
  type NightscoutCollection,
  type NightscoutQuery,
} from "./nightscout";
import type { SyncRef } from "./sync";

/** Who writes: the token's person, the account it acts as, and how history names them. */
export type Uploader = {
  person: string;
  account: string;
  name: string;
  token: string;
  label: string;
};
/** Queue statements for the Carby-to-Carby sync, as the care route makes them. */
export type Queue = (refs: SyncRef[]) => Statement[];

/** A refused upload, with the status and message Nightscout clients read. */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type CgmLink = { table: "cgm_readings"; id: string; source: string };
type Link = { table: "entries"; id: string } | CgmLink;
type StoredRow = {
  id: string;
  identifier: string | null;
  dedupe_key: string;
  data: string;
  carby: string;
  deleted: string | null;
  deleted_by: string | null;
};

function publicDoc(id: string, identifier: string | null, data: Doc): Doc {
  return { ...data, _id: id, ...(identifier ? { identifier } : {}) };
}

const AUDIT_COLUMNS =
  'INSERT INTO care_audit (id, owner, entry_id, actor_id, actor_name, action, "before", "after", at)';

/** Each entry change carries its history row in the same statement, so history is written only when the entry changed. */
function entryInsert(
  db: Database,
  u: Uploader,
  id: string,
  at: string,
  data: string,
  plan: string,
  now: string,
) {
  return db
    .prepare(
      `WITH changed AS (INSERT INTO entries (id, owner, at, data, plan, updated) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING RETURNING id) ${AUDIT_COLUMNS} SELECT $7, $2, $1, $8, $9, 'created', NULL, $4, $6 FROM changed`,
    )
    .bind(id, u.person, at, data, plan, now, crypto.randomUUID(), u.account, u.name);
}
function entryUpdate(db: Database, u: Uploader, id: string, at: string, data: string, now: string) {
  return db
    .prepare(
      `WITH old AS (SELECT data FROM entries WHERE id = $1 AND owner = $2), changed AS (UPDATE entries SET at = $3, data = $4, updated = $5 WHERE id = $1 AND owner = $2 RETURNING id) ${AUDIT_COLUMNS} SELECT $6, $2, $1, $7, $8, 'updated', (SELECT data FROM old), $4, $5 FROM changed`,
    )
    .bind(id, u.person, at, data, now, crypto.randomUUID(), u.account, u.name);
}
function entryDelete(db: Database, u: Uploader, id: string, now: string) {
  return db
    .prepare(
      `WITH changed AS (DELETE FROM entries WHERE id = $1 AND owner = $2 RETURNING data) ${AUDIT_COLUMNS} SELECT $3, $2, $1, $4, $5, 'deleted', changed.data, NULL, $6 FROM changed`,
    )
    .bind(id, u.person, crypto.randomUUID(), u.account, u.name, now);
}
/** Only readings this upload saved are removed; another source's reading at that time stays. */
function cgmDelete(db: Database, owner: string, link: CgmLink) {
  return db
    .prepare("DELETE FROM cgm_readings WHERE id = $1 AND owner = $2 AND source = $3")
    .bind(link.id, owner, link.source);
}

/** An entry's content, without the per-save revision, for comparing. */
function entryContent(data: string) {
  const { revision: _revision, ...rest } = JSON.parse(data) as Record<string, unknown>;
  return canonical(rest);
}

type Prepared = {
  clientId: string | null;
  identifier: string | null;
  time: number;
  key: string;
  data: Doc;
  /** Dated in the future: answered with an id, but not saved. */
  future: boolean;
};

async function prepare(
  collection: NightscoutCollection,
  raw: unknown,
  now: number,
): Promise<Prepared> {
  if (!isDoc(raw)) throw new UploadError("Each document must be a JSON object.");
  const { _id: clientId, ...data } = raw;
  if (clientId !== undefined && clientId !== null && !validId(clientId))
    throw new UploadError("Invalid _id.");
  const identifier = data.identifier;
  if (identifier !== undefined && identifier !== null && !validId(identifier))
    throw new UploadError("Invalid identifier.");
  const time = docTime(collection, data);
  if (time === null) throw new UploadError("Each document needs a date.");
  return {
    clientId: typeof clientId === "string" ? clientId : null,
    identifier: typeof identifier === "string" ? identifier : null,
    time,
    key: await sha256(dedupeKey(collection, data, time)),
    data,
    future: time > now + FUTURE_SLACK_MS,
  };
}

/**
 * Save uploaded documents and the Carby records they become, in one transaction.
 *
 * A document is the same record as a stored one with its `_id` or `identifier`; one sent with
 * neither (or any sensor entry, one reading per type and time) matches by its natural key. An
 * identical re-upload changes nothing. A record deleted in Carby stays deleted; one the uploader
 * deleted comes back when it sends it again, as Loop and Juggluco do to update a record.
 *
 * The answer has one document per document sent, in order, each with its `_id`, as Loop
 * requires. A document dated in the future is answered but not saved.
 */
export async function uploadDocs(
  db: Database,
  u: Uploader,
  collection: NightscoutCollection,
  body: unknown,
  now: Date,
  queue: Queue,
): Promise<Doc[]> {
  const raw = Array.isArray(body) ? body : [body];
  if (raw.length === 0) return [];
  if (raw.length > MAX_UPLOAD_DOCS)
    throw new UploadError(`Send at most ${MAX_UPLOAD_DOCS} documents per request.`, 413);
  const stamp = now.toISOString();
  const all = await Promise.all(raw.map((doc) => prepare(collection, doc, now.getTime())));
  // The same document twice in one request is saved once, as its last copy.
  const matchKey = (p: Prepared) =>
    p.clientId ?? (p.identifier ? `identifier|${p.identifier}` : `key|${p.key}`);
  const docs = [...new Map(all.map((p) => [matchKey(p), p])).values()];

  const found = await db
    .prepare(
      "SELECT id, identifier, dedupe_key, data, carby, deleted, deleted_by FROM nightscout_records WHERE owner = $1 AND collection = $2 AND (id = ANY($3) OR identifier = ANY($3) OR dedupe_key = ANY($4))",
    )
    .bind(
      u.person,
      collection,
      docs.flatMap((p) => [p.clientId, p.identifier].filter((v): v is string => v !== null)),
      docs.map((p) => p.key),
    )
    .all<StoredRow>();
  const byId = new Map(found.results.map((row) => [row.id, row]));
  const byIdentifier = new Map(
    found.results.flatMap((row) => (row.identifier ? [[row.identifier, row] as const] : [])),
  );
  const byKey = new Map(found.results.map((row) => [row.dedupe_key, row]));
  const named = (id: string | null) => (id ? (byId.get(id) ?? byIdentifier.get(id)) : undefined);
  const match = (p: Prepared) =>
    named(p.clientId) ??
    named(p.identifier) ??
    (collection === "entries" || (!p.clientId && !p.identifier) ? byKey.get(p.key) : undefined);

  type Plan = {
    p: Prepared;
    row: StoredRow | undefined;
    id: string;
    identifier: string | null;
    entries: { id: string; at: string; content: Doc }[];
    cgm: { link: CgmLink; value: string; at: string } | null;
    old: Link[];
  };
  const answers = new Map<string, Doc>();
  const plans: Plan[] = [];
  for (const p of docs) {
    const row = match(p);
    const id =
      row?.id ??
      p.clientId ??
      (await stableObjectId(
        p.identifier ? `identifier|${p.identifier}` : `${collection}|${p.key}`,
      ));
    const identifier = p.identifier ?? row?.identifier ?? null;
    answers.set(matchKey(p), publicDoc(id, identifier, p.data));
    if (p.future || row?.deleted_by === "carby") continue;
    if (row && !row.deleted && canonical(JSON.parse(row.data)) === canonical(p.data)) continue;
    const projection = project(collection, p.data, p.time, u.label);
    plans.push({
      p,
      row,
      id,
      identifier,
      entries: await Promise.all(
        projection.entries.map(async (part) => ({
          id: await entryId(`${u.person}|${collection}|${id}|${part.part}`),
          at: part.entry.at,
          content: part.entry,
        })),
      ),
      cgm: projection.cgm
        ? {
            link: {
              table: "cgm_readings",
              id: await cgmRowId(`${u.person}|${projection.cgm.at}`),
              source: projection.cgm.source,
            },
            value: projection.cgm.status ?? String(projection.cgm.value),
            at: projection.cgm.at,
          }
        : null,
      // A deleted record's Carby records are already gone.
      old: row && !row.deleted ? (JSON.parse(row.carby) as Link[]) : [],
    });
  }

  const entryIds = plans.flatMap((plan) => [
    ...plan.entries.map((e) => e.id),
    ...plan.old.flatMap((link) => (link.table === "entries" ? [link.id] : [])),
  ]);
  const current = entryIds.length
    ? await db
        .prepare("SELECT id, data FROM entries WHERE owner = $1 AND id = ANY($2)")
        .bind(u.person, entryIds)
        .all<{ id: string; data: string }>()
    : { results: [] };
  const existing = new Map(current.results.map((row) => [row.id, row.data]));
  let planData = "";
  if (plans.some((plan) => plan.entries.some((e) => !existing.has(e.id)))) {
    const plan = await db
      .prepare("SELECT data FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 1")
      .bind(u.person)
      .first<{ data: string }>();
    if (!plan || !planSchema.safeParse(JSON.parse(plan.data)).success)
      throw new UploadError("Set up the care plan in Carby before uploading treatments.", 422);
    planData = plan.data;
  }

  const statements: Statement[] = [];
  for (const plan of plans) {
    const links: Link[] = [];
    const refs: SyncRef[] = [];
    const changes: Statement[] = [];
    for (const e of plan.entries) {
      links.push({ table: "entries", id: e.id });
      const before = existing.get(e.id);
      const content = entrySchema.parse({ ...e.content, id: e.id });
      if (before !== undefined && entryContent(before) === canonical(content)) continue;
      const data = JSON.stringify({ ...content, revision: crypto.randomUUID() });
      refs.push({ table: "entries", id: e.id });
      changes.push(
        before === undefined
          ? entryInsert(db, u, e.id, e.at, data, planData, stamp)
          : entryUpdate(db, u, e.id, e.at, data, stamp),
      );
    }
    for (const link of plan.old) {
      if (link.table === "entries") {
        if (plan.entries.some((e) => e.id === link.id) || !existing.has(link.id)) continue;
        refs.push({ table: "entries", id: link.id });
        changes.push(entryDelete(db, u, link.id, stamp));
      } else if (link.id !== plan.cgm?.link.id) {
        changes.push(cgmDelete(db, u.person, link));
      }
    }
    if (plan.cgm) {
      links.push(plan.cgm.link);
      changes.push(
        db
          .prepare(
            "INSERT INTO cgm_readings (id, owner, at, value, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET value = excluded.value WHERE cgm_readings.owner = excluded.owner AND cgm_readings.source = excluded.source",
          )
          .bind(plan.cgm.link.id, u.person, plan.cgm.at, plan.cgm.value, plan.cgm.link.source),
      );
    }
    const values = [
      u.person,
      collection,
      plan.id,
      plan.identifier,
      plan.p.key,
      new Date(plan.p.time).toISOString(),
      JSON.stringify(plan.p.data),
      JSON.stringify(links),
      u.token,
      stamp,
    ];
    changes.push(
      plan.row
        ? db
            .prepare(
              "UPDATE nightscout_records SET identifier = $4, dedupe_key = $5, at = $6, data = $7, carby = $8, token = $9, modified = $10, deleted = NULL, deleted_by = NULL WHERE owner = $1 AND collection = $2 AND id = $3 AND (deleted_by IS NULL OR deleted_by = 'upload')",
            )
            .bind(...values)
        : db
            .prepare(
              "INSERT INTO nightscout_records (owner, collection, id, identifier, dedupe_key, at, data, carby, token, created, modified) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)",
            )
            .bind(...values),
    );
    statements.push(...queue(refs), ...changes);
  }
  if (statements.length) await db.batch(statements);
  return all.flatMap((p): Doc[] => {
    const doc = answers.get(matchKey(p));
    return doc ? [doc] : [];
  });
}

/** SQL for the documents a query names, with its arguments appended to `args`. */
function whereFor(
  collection: NightscoutCollection,
  query: NightscoutQuery,
  args: unknown[],
): string {
  const where = ["owner = $1", "collection = $2", "deleted IS NULL"];
  const arg = (value: unknown) => {
    args.push(value);
    return `$${args.length}`;
  };
  // MATCH_FIELDS is a fixed list, so the field names are safe in SQL.
  const sql = (c: Condition) => {
    const value = arg(c.value);
    if (c.field === "_id") return `(id = ${value} OR identifier = ${value})`;
    return c.field === "at" ? `at = ${value}` : `data::jsonb->>'${c.field}' = ${value}`;
  };
  if (query.from) where.push(`at ${query.from.inclusive ? ">=" : ">"} ${arg(query.from.at)}`);
  if (query.to) where.push(`at ${query.to.inclusive ? "<=" : "<"} ${arg(query.to.at)}`);
  if (query.type)
    where.push(
      `data::jsonb->>'${collection === "treatments" ? "eventType" : "type"}' = ${arg(query.type)}`,
    );
  for (const c of query.all) where.push(sql(c));
  if (query.any.length) where.push(`(${query.any.map(sql).join(" OR ")})`);
  return where.join(" AND ");
}

/** Uploaded documents, newest first, as Nightscout returns them. Deleted ones are left out. */
export async function findDocs(
  db: Database,
  owner: string,
  collection: NightscoutCollection,
  query: NightscoutQuery,
): Promise<Doc[]> {
  const args: unknown[] = [owner, collection];
  const where = whereFor(collection, query, args);
  args.push(query.count);
  const rows = await db
    .prepare(
      `SELECT id, identifier, data FROM nightscout_records WHERE ${where} ORDER BY at DESC LIMIT $${args.length}`,
    )
    .bind(...args)
    .all<{ id: string; identifier: string | null; data: string }>();
  return rows.results.map((row) => publicDoc(row.id, row.identifier, JSON.parse(row.data) as Doc));
}

/**
 * Delete the uploaded documents a query names (at most MAX_QUERY_COUNT), and the Carby records
 * they became. Each stays as a tombstone, which a later upload of the same document may lift.
 * Returns how many documents were deleted.
 */
export async function deleteDocs(
  db: Database,
  u: Uploader,
  collection: NightscoutCollection,
  query: NightscoutQuery,
  now: Date,
  queue: Queue,
): Promise<number> {
  const args: unknown[] = [u.person, collection];
  const where = whereFor(collection, query, args);
  args.push(MAX_QUERY_COUNT);
  const rows = await db
    .prepare(
      `SELECT id, carby FROM nightscout_records WHERE ${where} ORDER BY at DESC LIMIT $${args.length}`,
    )
    .bind(...args)
    .all<{ id: string; carby: string }>();
  if (!rows.results.length) return 0;
  const stamp = now.toISOString();
  const links = rows.results.flatMap((row) => JSON.parse(row.carby) as Link[]);
  await db.batch([
    ...queue(links.flatMap((link) => (link.table === "entries" ? [link] : []))),
    ...links.map((link) =>
      link.table === "entries" ? entryDelete(db, u, link.id, stamp) : cgmDelete(db, u.person, link),
    ),
    db
      .prepare(
        "UPDATE nightscout_records SET deleted = $4, deleted_by = 'upload', modified = $4 WHERE owner = $1 AND collection = $2 AND id = ANY($3) AND deleted IS NULL",
      )
      .bind(
        u.person,
        collection,
        rows.results.map((row) => row.id),
        stamp,
      ),
  ]);
  return rows.results.length;
}

/**
 * Deleting an uploaded entry in Carby deletes the document it came from, for good, so the
 * uploader's next sync can't bring it back.
 */
export function tombstoneFor(db: Database, owner: string, entry: string, now: string) {
  return db
    .prepare(
      "UPDATE nightscout_records SET deleted = $3, deleted_by = 'carby', modified = $3 WHERE owner = $1 AND (deleted IS NULL OR deleted_by = 'upload') AND carby::jsonb @> $2::jsonb",
    )
    .bind(owner, JSON.stringify([{ table: "entries", id: entry }]), now);
}
