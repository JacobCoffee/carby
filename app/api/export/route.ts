import { getCurrentUser } from "@/app/auth";
import { accessFor } from "@/app/access";
import { database } from "@/db/raw";
import { z } from "zod";
import { dateKey, timeZoneSchema } from "@/lib/care";

export const dynamic = "force-dynamic";

const tables = [
  "plans",
  "saved_foods",
  "entries",
  "cgm_readings",
  "dexcom_events",
  "dexcom_connections",
  "care_audit",
  "illness_windows",
  "profiles",
  "appointments",
] as const;
type Table = (typeof tables)[number];
type ExportRow = { id?: string; [key: string]: unknown };

/** Stream all rows belonging to the signed-in owner without a response-size cap. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user)
    return Response.json(
      { error: "Sign in to download your records." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  // A backup holds sealed device logins, so only owners download one.
  const access = await accessFor(request, user, "manage");
  if (access instanceof Response) return access;
  const owner = access.person;
  let db: ReturnType<typeof database>;
  try {
    db = database();
  } catch {
    return Response.json({ error: "Storage is unavailable." }, { status: 503 });
  }
  const encoder = new TextEncoder();
  const page = 250;
  let tableIndex = 0,
    lastId = "",
    started = false,
    finished = false;
  const counts: Record<Table, number> = Object.fromEntries(
    tables.map((table) => [table, 0]),
  ) as Record<Table, number>;
  const stream = new ReadableStream<Uint8Array>({
    // A pull that enqueues nothing is never re-invoked, so each pull runs until it emits rows or the footer.
    async pull(controller) {
      if (finished) return;
      try {
        if (!started) {
          started = true;
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                kind: "header",
                format: "carby-d1-ndjson",
                version: 1,
                exportedAt: new Date().toISOString(),
                tables,
              }) + "\n",
            ),
          );
          return;
        }
        while (tableIndex < tables.length) {
          const table = tables[tableIndex];
          let rows: ExportRow[];
          if (table === "dexcom_connections") {
            rows = (
              await db
                .prepare("SELECT * FROM dexcom_connections WHERE owner = $1")
                .bind(owner)
                .all<ExportRow>()
            ).results;
            tableIndex++;
          } else {
            // Table names are fixed above, never supplied by a request.
            rows = (
              await db
                .prepare(
                  `SELECT * FROM "${table}" WHERE owner = $1 AND id > $2 ORDER BY id LIMIT ${page}`,
                )
                .bind(owner, lastId)
                .all<ExportRow>()
            ).results;
            if (rows.length < page) {
              tableIndex++;
              lastId = "";
            } else lastId = String(rows[rows.length - 1].id);
          }
          if (!rows.length) continue;
          counts[table] += rows.length;
          controller.enqueue(
            encoder.encode(
              rows.map((row) => JSON.stringify({ kind: "row", table, row }) + "\n").join(""),
            ),
          );
          return;
        }
        finished = true;
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ kind: "footer", counts, completedAt: new Date().toISOString() }) +
              "\n",
          ),
        );
        controller.close();
      } catch (error) {
        finished = true;
        controller.error(error);
      }
    },
  });
  // The file is named for today in the care plan's zone (UTC when no usable plan is saved).
  const planRow = await db
    .prepare("SELECT data FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 1")
    .bind(owner)
    .first<{ data: string }>();
  let saved: unknown = null;
  try {
    saved = planRow ? JSON.parse(planRow.data) : null;
  } catch {
    saved = null;
  }
  const plan = z.object({ timezone: timeZoneSchema }).safeParse(saved);
  const filename = `carby-backup-${dateKey(new Date(), plan.success ? plan.data.timezone : "UTC")}.ndjson`;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
