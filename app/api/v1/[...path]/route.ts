import { tokenAccess, type TokenAccess } from "@/app/access";
import { database } from "@/db/raw";
import {
  namesDocuments,
  NIGHTSCOUT_VERSION,
  nightscoutRoute,
  parseQuery,
  rateLimiter,
} from "@/lib/nightscout";
import {
  deleteDocs,
  findDocs,
  uploadDocs,
  UploadError,
  type Uploader,
} from "@/lib/nightscout-store";
import { acceptConfig, flushSync, pushConfig, queueSyncStatements, syncQueues } from "@/lib/sync";

/**
 * The Nightscout API v1, for uploaders such as xDrip+, Juggluco, Loop, AAPS and Trio. Every
 * request carries a Carby API token, which names the person; nothing here reads a session.
 */
export const dynamic = "force-dynamic";

// Tokens travel in headers, never cookies, so any site's scripts may call this API.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "api-secret, authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};
function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...CORS } });
}
function withCors(response: Response) {
  for (const [key, value] of Object.entries(CORS)) response.headers.set(key, value);
  return response;
}
const notFound = () => reply({ status: 404, message: "Not found." }, 404);

/** Per token: generous for a loop app's few calls each 5 minutes, and for a backfill. */
const allow = rateLimiter(600, 60000);
async function access(request: Request, scope: "read" | "upload") {
  const granted = await tokenAccess(request, scope);
  if (granted instanceof Response) return withCors(granted);
  if (!allow(granted.token.id, Date.now()))
    return reply({ status: 429, message: "Too many requests. Try again in a minute." }, 429);
  return granted;
}

function uploader(granted: TokenAccess): Uploader {
  return {
    person: granted.person,
    account: granted.user.userId,
    name: granted.user.displayName,
    token: granted.token.id,
    label: granted.token.label,
  };
}
/** Uploaded log entries join the Carby-to-Carby sync like any other change. */
function sync(owner: string) {
  const db = database();
  const push = pushConfig(process.env);
  const queues = syncQueues(owner, push, acceptConfig(process.env));
  return {
    queue: (refs: Parameters<typeof queueSyncStatements>[3]) =>
      queueSyncStatements(db, queues, owner, refs),
    send: () =>
      void flushSync(db, push, owner).catch((e: unknown) => console.warn("sync send failed", e)),
  };
}

function failed(e: unknown, what: string) {
  if (e instanceof UploadError) return reply({ status: e.status, message: e.message }, e.status);
  console.error(`nightscout ${what} failed`, e);
  return reply({ status: 503, message: "Carby is unavailable right now. Please retry." }, 503);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  const route = nightscoutRoute(new URL(request.url).pathname);
  if (!route) return notFound();
  if (route.kind === "status") return status();
  if (route.kind === "verifyauth") return verifyauth(request);
  if (route.kind === "test") {
    const granted = await access(request, "upload");
    if (!(granted instanceof Response)) return reply({ status: "ok" });
    const reader = await access(request, "read");
    return reader instanceof Response ? reader : reply({ status: "ok" });
  }
  const granted = await access(request, "read");
  if (granted instanceof Response) return granted;
  try {
    const query = parseQuery(route.collection, new URL(request.url).searchParams, route);
    return reply(await findDocs(database(), granted.person, route.collection, query));
  } catch (e) {
    return failed(e, "read");
  }
}

async function save(request: Request) {
  const route = nightscoutRoute(new URL(request.url).pathname);
  if (route?.kind !== "collection" || route.type || route.id) return notFound();
  const granted = await access(request, "upload");
  if (granted instanceof Response) return granted;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply({ status: 400, message: "Send the documents as JSON." }, 400);
  }
  try {
    const { queue, send } = sync(granted.person);
    const saved = await uploadDocs(
      database(),
      uploader(granted),
      route.collection,
      body,
      new Date(),
      queue,
    );
    send();
    return reply(saved);
  } catch (e) {
    return failed(e, "upload");
  }
}
export const POST = save;
export const PUT = save;

/**
 * Delete by id (/api/v1/treatments/<id>) or by query (Trio's `?find[id][$eq]=<uuid>`). A query
 * must name what it deletes: a bare DELETE never empties a collection.
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const route = nightscoutRoute(url.pathname);
  if (route?.kind !== "collection") return notFound();
  const query = parseQuery(route.collection, url.searchParams, route);
  if (!namesDocuments(query))
    return reply({ status: 400, message: "Name the documents to delete." }, 400);
  const granted = await access(request, "upload");
  if (granted instanceof Response) return granted;
  try {
    const { queue, send } = sync(granted.person);
    const n = await deleteDocs(
      database(),
      uploader(granted),
      route.collection,
      query,
      new Date(),
      queue,
    );
    send();
    return reply({ n, ok: 1 });
  } catch (e) {
    return failed(e, "delete");
  }
}

/** What clients check before they upload. Carby always stores mg/dL. */
function status() {
  const now = new Date();
  return reply({
    status: "ok",
    name: "Carby",
    version: NIGHTSCOUT_VERSION,
    serverTime: now.toISOString(),
    serverTimeEpoch: now.getTime(),
    apiEnabled: true,
    careportalEnabled: true,
    boluscalcEnabled: false,
    settings: { units: "mg/dl", authDefaultRoles: "denied", enable: ["careportal"] },
    extendedSettings: {},
    authorized: null,
  });
}

/** Nightscout answers 200 either way and says in the body what the token can do. */
async function verifyauth(request: Request) {
  const canRead = !((await tokenAccess(request, "read")) instanceof Response);
  const canWrite = !((await tokenAccess(request, "upload")) instanceof Response);
  const found = canRead || canWrite;
  return reply({
    status: 200,
    message: {
      canRead,
      canWrite,
      isAdmin: false,
      message: found ? "OK" : "UNAUTHORIZED",
      rolefound: found ? "FOUND" : "NOTFOUND",
      permissions: found ? "ROLE" : "DEFAULT",
    },
  });
}
