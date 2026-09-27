import { createHash, timingSafeEqual } from "node:crypto";
import { database } from "@/db/raw";
import {
  acceptConfig,
  applySyncChange,
  offerChanges,
  pullAckSchema,
  pullResolveSchema,
  resolveHeld,
  settlePulled,
  syncRequestSchema,
  type AcceptConfig,
  type SyncResult,
} from "@/lib/sync";

export const dynamic = "force-dynamic";

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** The receiver settings, or the reply refusing this request. */
function accepted(request: Request): AcceptConfig | Response {
  const config = acceptConfig(process.env);
  if (!config) return reply({ error: "This Carby does not accept synced records." }, 404);
  const given = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  if (!timingSafeEqual(digest(given), digest(config.token)))
    return reply({ error: "The sync token doesn't match." }, 401);
  return config;
}
const noSendBack = () => reply({ error: "This Carby does not send its changes back." }, 404);

/**
 * Receives care records from another Carby deployment (see lib/sync.ts). Off unless
 * CARBY_SYNC_ACCEPT_TOKEN and CARBY_SYNC_ACCEPT_PERSON are set. The token stands in for sign-in,
 * and every record lands on the configured person, whatever owner it had where it was saved.
 * With CARBY_SYNC_ACCEPT_SEND_BACK=1 the sender also reports here what it did with the changes
 * it pulled, and chooses what happens to ones it held back.
 */
export async function POST(request: Request) {
  const config = accepted(request);
  if (config instanceof Response) return config;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return reply({ error: "Invalid request." }, 400);
  }
  const changes = syncRequestSchema.safeParse(raw);
  const pulled = pullAckSchema.safeParse(raw);
  const resolve = pullResolveSchema.safeParse(raw);
  if (!changes.success && !pulled.success && !resolve.success)
    return reply({ error: "Invalid sync request." }, 400);
  if (!changes.success && !config.sendBack) return noSendBack();
  try {
    const db = database();
    if (changes.success) {
      const results: SyncResult[] = [];
      // In order: a meal's food is applied before the dose that links it.
      for (const change of changes.data.changes)
        results.push(await applySyncChange(db, config.person, "Carby sync", change));
      return reply({ results });
    }
    if (pulled.success) await settlePulled(db, config.person, pulled.data.pulled);
    else if (resolve.success) await resolveHeld(db, config.person, resolve.data.resolve);
    return reply({ ok: true });
  } catch (e) {
    console.error("sync receive failed", e);
    return reply({ error: "Could not save synced records. They will be sent again." }, 503);
  }
}

/** With send-back on, the sender pulls this Carby's own changes from here. */
export async function GET(request: Request) {
  const config = accepted(request);
  if (config instanceof Response) return config;
  if (!config.sendBack) return noSendBack();
  try {
    return reply(await offerChanges(database(), config.person));
  } catch (e) {
    console.error("sync offer failed", e);
    return reply({ error: "Could not read the changes to send back." }, 503);
  }
}
