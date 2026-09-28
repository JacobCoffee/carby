import type { TokenAccess } from "@/app/access";
import {
  access,
  anyAccess,
  failed,
  notFound,
  options,
  reply,
  sync,
  uploader,
} from "@/app/nightscout-api";
import { database } from "@/db/raw";
import {
  API3_VERSION,
  docTime,
  isDoc,
  MAX_QUERY_COUNT,
  nightscoutCollections,
  NIGHTSCOUT_VERSION,
  parseQuery,
  parseV3Query,
  SERVER_FIELDS,
  v3Identifier,
  v3Route,
  type Doc,
  type NightscoutCollection,
} from "@/lib/nightscout";
import {
  deleteDocs,
  findDocs,
  findRecord,
  historyDocs,
  lastModified,
  uploadDocs,
} from "@/lib/nightscout-store";

/**
 * The Nightscout API v3, which AAPS and Juggluco use: one document per write, identified by
 * `identifier`, with a history of changes (deletions included) that clients sync from.
 */
export const dynamic = "force-dynamic";

export const OPTIONS = options;

const gone = () => reply({ status: 410 }, 410);
/** Fields a client can't change once a document is stored, as Nightscout enforces. */
const IMMUTABLE = ["identifier", "date", "utcOffset", "eventType", "device", "app"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const route = v3Route(url.pathname);
  if (!route) return notFound();
  if (route.kind === "status") {
    const granted = await anyAccess(request);
    if (granted instanceof Response) return granted;
    // Nightscout writes permissions as "crud" letters; AAPS uploads only when every collection has all four.
    const scopes = granted.token.scopes;
    const perms = ["c", "r", "u", "d"]
      .filter((letter) => scopes.includes(letter === "r" ? "read" : "upload"))
      .join("");
    return reply({
      status: 200,
      result: {
        version: NIGHTSCOUT_VERSION,
        apiVersion: API3_VERSION,
        srvDate: Date.now(),
        storage: { storage: "postgresql" },
        apiPermissions: Object.fromEntries(nightscoutCollections.map((c) => [c, perms])),
      },
    });
  }
  const granted = await access(request, "read");
  if (granted instanceof Response) return granted;
  const db = database();
  try {
    if (route.kind === "lastModified")
      return reply({
        status: 200,
        result: { srvDate: Date.now(), collections: await lastModified(db, granted.person) },
      });
    if (route.kind === "document") {
      const found = await findRecord(db, granted.person, route.collection, route.identifier);
      if (!found) return notFound();
      return found.deleted ? gone() : reply({ status: 200, result: found.doc });
    }
    if (route.kind === "history") {
      const limit = Number(url.searchParams.get("limit"));
      const docs = await historyDocs(
        db,
        granted.person,
        route.collection,
        route.since,
        Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_QUERY_COUNT) : MAX_QUERY_COUNT,
      );
      const latest = docs.at(-1)?.srvModified;
      // AAPS reads the next `since` from the ETag, so it must be exactly W/"<ms>".
      return reply(
        { status: 200, result: docs },
        200,
        typeof latest === "number"
          ? { ETag: `W/"${latest}"`, "Last-Modified": new Date(latest).toUTCString() }
          : {},
      );
    }
    const query = parseV3Query(route.collection, url.searchParams);
    return reply({
      status: 200,
      result: await findDocs(db, granted.person, route.collection, query, "v3"),
    });
  } catch (e) {
    return failed(e, "read");
  }
}

async function body(request: Request): Promise<Doc | Response> {
  try {
    const parsed: unknown = await request.json();
    if (isDoc(parsed)) return parsed;
  } catch {
    // Answered below.
  }
  return reply({ status: 400, message: "Send one document as a JSON object." }, 400);
}

/** Save one document; `identifier` is the one the path names, if any. */
async function save(
  granted: TokenAccess,
  collection: NightscoutCollection,
  doc: Doc,
  identifier: string | null,
) {
  try {
    const now = Date.now();
    const time = docTime(collection, doc, now);
    if (time === null) return reply({ status: 400, message: "Bad or missing date field" }, 400);
    const withId = {
      ...doc,
      identifier:
        identifier ??
        (typeof doc.identifier === "string" ? doc.identifier : await v3Identifier(doc, time)),
    };
    const { queue, send } = sync(granted.person);
    const [saved] = await uploadDocs(
      database(),
      uploader(granted),
      collection,
      withId,
      new Date(now),
      queue,
    );
    send();
    if (!saved) return reply({ status: 400, message: "Nothing to save." }, 400);
    return saved.existed
      ? reply({
          status: 200,
          identifier: saved.identifier,
          lastModified: saved.modified,
          ...(identifier ? {} : { isDeduplication: true }),
        })
      : reply({ status: 201, identifier: saved.identifier, lastModified: saved.modified }, 201, {
          Location: `/api/v3/${collection}/${encodeURIComponent(saved.identifier)}`,
        });
  } catch (e) {
    return failed(e, "upload");
  }
}

/** Create a document, or update the one it duplicates (by identifier or natural key). */
export async function POST(request: Request) {
  const route = v3Route(new URL(request.url).pathname);
  if (route?.kind !== "search") return notFound();
  const doc = await body(request);
  if (doc instanceof Response) return doc;
  const granted = await access(request, "upload");
  return granted instanceof Response ? granted : save(granted, route.collection, doc, null);
}

/** Replace or create the document the path names. A deleted one stays deleted (410). */
export async function PUT(request: Request) {
  const route = v3Route(new URL(request.url).pathname);
  if (route?.kind !== "document") return notFound();
  const doc = await body(request);
  if (doc instanceof Response) return doc;
  const granted = await access(request, "upload");
  if (granted instanceof Response) return granted;
  const found = await findRecord(database(), granted.person, route.collection, route.identifier);
  if (found?.deleted) return gone();
  return save(granted, route.collection, doc, route.identifier);
}

/** Change some fields of a stored document. AAPS updates this way. */
export async function PATCH(request: Request) {
  const route = v3Route(new URL(request.url).pathname);
  if (route?.kind !== "document") return notFound();
  const patch = await body(request);
  if (patch instanceof Response) return patch;
  const granted = await access(request, "upload");
  if (granted instanceof Response) return granted;
  try {
    const found = await findRecord(database(), granted.person, route.collection, route.identifier);
    if (!found) return notFound();
    if (found.deleted) return gone();
    for (const field of IMMUTABLE)
      if (patch[field] !== undefined && patch[field] !== found.doc[field])
        return reply(
          { status: 400, message: `Field ${field} cannot be modified by the client` },
          400,
        );
    const changes = Object.fromEntries(
      Object.entries(patch).filter(([key]) => !SERVER_FIELDS.includes(key)),
    );
    const { queue, send } = sync(granted.person);
    await uploadDocs(
      database(),
      uploader(granted),
      route.collection,
      { ...found.data, ...changes, _id: found.id },
      new Date(),
      queue,
    );
    send();
    return reply({ status: 200 });
  } catch (e) {
    return failed(e, "upload");
  }
}

/** Mark the document deleted; history then reports it with `isValid: false`. */
export async function DELETE(request: Request) {
  const route = v3Route(new URL(request.url).pathname);
  if (route?.kind !== "document") return notFound();
  const granted = await access(request, "upload");
  if (granted instanceof Response) return granted;
  try {
    const { queue, send } = sync(granted.person);
    const query = parseQuery(route.collection, new URLSearchParams(), {
      type: null,
      id: route.identifier,
    });
    const found = await findRecord(database(), granted.person, route.collection, route.identifier);
    if (!found) return notFound();
    if (!found.deleted)
      await deleteDocs(database(), uploader(granted), route.collection, query, new Date(), queue);
    send();
    return reply({ status: 200 });
  } catch (e) {
    return failed(e, "delete");
  }
}
