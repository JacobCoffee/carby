import { createHash, timingSafeEqual } from "node:crypto";
import { database } from "@/db/raw";
import { acceptConfig, applySyncChange, syncRequestSchema, type SyncResult } from "@/lib/sync";

export const dynamic = "force-dynamic";

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Receives care records from another Carby deployment (see lib/sync.ts). Off unless
 * CARBY_SYNC_ACCEPT_TOKEN and CARBY_SYNC_ACCEPT_PERSON are set. The token stands in for sign-in,
 * and every record lands on the configured person, whatever owner it had where it was saved.
 */
export async function POST(request: Request) {
  const config = acceptConfig(process.env);
  if (!config) return reply({ error: "This Carby does not accept synced records." }, 404);
  const given = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  if (!timingSafeEqual(digest(given), digest(config.token)))
    return reply({ error: "The sync token doesn't match." }, 401);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return reply({ error: "Invalid request." }, 400);
  }
  const parsed = syncRequestSchema.safeParse(raw);
  if (!parsed.success) return reply({ error: "Invalid sync request." }, 400);
  try {
    const db = database();
    const results: SyncResult[] = [];
    // In order: a meal's food is applied before the dose that links it.
    for (const change of parsed.data.changes)
      results.push(await applySyncChange(db, config.person, "Carby sync", change));
    return reply({ results });
  } catch (e) {
    console.error("sync receive failed", e);
    return reply({ error: "Could not save synced records. They will be sent again." }, 503);
  }
}
