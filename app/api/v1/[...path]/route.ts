import { tokenAccess } from "@/app/access";
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
import { namesDocuments, NIGHTSCOUT_VERSION, nightscoutRoute, parseQuery } from "@/lib/nightscout";
import { deleteDocs, findDocs, uploadDocs } from "@/lib/nightscout-store";

/** The Nightscout API v1, for uploaders such as xDrip+, Juggluco, Loop and Trio. */
export const dynamic = "force-dynamic";

export const OPTIONS = options;

export async function GET(request: Request) {
  const route = nightscoutRoute(new URL(request.url).pathname);
  if (!route) return notFound();
  if (route.kind === "status") return status();
  if (route.kind === "verifyauth") return verifyauth(request);
  if (route.kind === "test") {
    const granted = await anyAccess(request);
    return granted instanceof Response ? granted : reply({ status: "ok" });
  }
  const granted = await access(request, "read");
  if (granted instanceof Response) return granted;
  try {
    const query = parseQuery(route.collection, new URL(request.url).searchParams, route);
    return reply(await findDocs(database(), granted.person, route.collection, query, "v1"));
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
    return reply(saved.map((s) => s.doc));
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
