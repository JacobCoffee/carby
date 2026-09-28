import { tokenAccess, type TokenAccess } from "@/app/access";
import { database } from "@/db/raw";
import { rateLimiter } from "@/lib/nightscout";
import { UploadError, type Uploader } from "@/lib/nightscout-store";
import { acceptConfig, flushSync, pushConfig, queueSyncStatements, syncQueues } from "@/lib/sync";

/**
 * What the Nightscout API routes (/api/v1 and /api/v3) share. Every request carries a Carby API
 * token, which names the person; nothing here reads a session.
 */

// Tokens travel in headers, never cookies, so any site's scripts may call this API.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "api-secret, authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};
export function reply(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...CORS, ...headers },
  });
}
function withCors(response: Response) {
  for (const [key, value] of Object.entries(CORS)) response.headers.set(key, value);
  return response;
}
export const notFound = () => reply({ status: 404, message: "Not found." }, 404);
export const options = () => new Response(null, { status: 204, headers: CORS });

/** Per token: generous for a loop app's few calls each 5 minutes, and for a backfill. */
const allow = rateLimiter(600, 60000);
export async function access(request: Request, scope: "read" | "upload") {
  const granted = await tokenAccess(request, scope);
  if (granted instanceof Response) return withCors(granted);
  if (!allow(granted.token.id, Date.now()))
    return reply({ status: 429, message: "Too many requests. Try again in a minute." }, 429);
  return granted;
}
/** A token with either scope, for checks that report what the token may do. */
export async function anyAccess(request: Request) {
  const writer = await access(request, "upload");
  return writer instanceof Response && writer.status !== 429 ? access(request, "read") : writer;
}

export function uploader(granted: TokenAccess): Uploader {
  return {
    person: granted.person,
    account: granted.user.userId,
    name: granted.user.displayName,
    token: granted.token.id,
    label: granted.token.label,
  };
}

/** Uploaded log entries join the Carby-to-Carby sync like any other change. */
export function sync(owner: string) {
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

export function failed(e: unknown, what: string) {
  if (e instanceof UploadError) return reply({ status: e.status, message: e.message }, e.status);
  console.error(`nightscout ${what} failed`, e);
  return reply({ status: 503, message: "Carby is unavailable right now. Please retry." }, 503);
}
