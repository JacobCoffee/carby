import { getCurrentUser } from "@/app/auth";
import { accessFor } from "@/app/access";
import { database } from "@/db/raw";
import { illnessSchema, validateIllnessDates } from "@/lib/illness";
import { appointmentSchema } from "@/lib/appointments";
import { conditionalJson } from "@/lib/conditional-json";
import {
  entrySchema,
  planDraft,
  planSchema,
  savedFoodSchema,
  cgmSchema,
  dexcomEventSchema,
} from "@/lib/care";
import { profileSchema } from "@/lib/profile";
import { preserveEntryContext, sameEntry } from "@/lib/entry-integrity";
import {
  attachMealFood,
  calculationRecords,
  insertMealFoodSql,
  attachMealFoodSql,
} from "@/lib/meal-log";
import { clarityReadingStatements, clarityEventStatements } from "@/lib/cgm-sql";
import { tombstoneFor } from "@/lib/nightscout-store";
import type { ClarityFreshness, SensorSession } from "@/lib/cgm-summary";
import {
  acceptConfig,
  flushSync,
  pullSync,
  pushConfig,
  queueSyncStatements,
  resolveHeld,
  resolvePulled,
  syncQueues,
  syncStatus,
  type SyncRef,
} from "@/lib/sync";
export const dynamic = "force-dynamic";
/** Actions that change the care plan, the profile or imported device history: owners only. */
const MANAGE_ACTIONS = new Set([
  "plan",
  "profile",
  "importCgm",
  "importDexcomEvents",
  "syncResend",
  "syncDiscard",
  "syncPullSend",
  "syncPullDiscard",
]);
function audit(
  db: ReturnType<typeof database>,
  owner: string,
  actorId: string,
  actorName: string,
  entryId: string,
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
      owner,
      entryId,
      actorId,
      actorName,
      action,
      before,
      after,
      new Date().toISOString(),
    );
}

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in to access your care log." }, 401);
  const access = await accessFor(request, user, "read");
  if (access instanceof Response) return access;
  const owner = access.person;
  try {
    const db = database();
    // The longer history is read only when Insights needs a 30-day comparison.
    if (new URL(request.url).searchParams.get("scope") === "insights") {
      const since = new Date(Date.now() - 65 * 86400000).toISOString();
      // Prefer numeric/Clarity values at the same instant before applying the row cap.
      // Both Share and Clarity may have stored each five-minute point.
      const cgm = await db
        .prepare(
          "SELECT at, value, source FROM (SELECT at, value, source, ROW_NUMBER() OVER (PARTITION BY at ORDER BY CASE WHEN value IN ('High','Low') THEN 1 ELSE 0 END, CASE WHEN source = 'Dexcom Clarity' THEN 0 ELSE 1 END) AS chosen FROM cgm_readings WHERE owner = $1 AND at >= $2) AS ranked WHERE chosen = 1 ORDER BY at DESC LIMIT 22000",
        )
        .bind(owner, since)
        .all<{ at: string; value: string; source: string }>();
      return conditionalJson(request, {
        cgm: cgm.results.map((r) => ({
          at: r.at,
          value: r.value === "High" || r.value === "Low" ? null : Number(r.value),
          status: r.value === "High" || r.value === "Low" ? r.value : null,
          source: r.source,
        })),
        limited: cgm.results.length === 22000,
      });
    }
    const since = new Date(Date.now() - 45 * 86400000).toISOString();
    const [
      records,
      plan,
      history,
      foods,
      cgm,
      events,
      illnesses,
      profileRow,
      appointmentRows,
      sensor,
      clarity,
    ] = await Promise.all([
      db
        .prepare("SELECT data, updated FROM entries WHERE owner = $1 ORDER BY at DESC")
        .bind(owner)
        .all<{ data: string; updated?: string }>(),
      db
        .prepare("SELECT data FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 1")
        .bind(owner)
        .first<{ data: string }>(),
      db
        .prepare("SELECT data, created FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 20")
        .bind(owner)
        .all<{ data: string; created: string }>(),
      db
        .prepare("SELECT data FROM saved_foods WHERE owner = $1 ORDER BY name")
        .bind(owner)
        .all<{ data: string }>(),
      db
        .prepare(
          "SELECT at, value, source FROM (SELECT at, value, source, ROW_NUMBER() OVER (PARTITION BY at ORDER BY CASE WHEN value IN ('High','Low') THEN 1 ELSE 0 END, CASE WHEN source = 'Dexcom Clarity' THEN 0 ELSE 1 END) AS chosen FROM cgm_readings WHERE owner = $1 AND at >= $2) AS ranked WHERE chosen = 1 ORDER BY at DESC LIMIT 15000",
        )
        .bind(owner, since)
        .all<{ at: string; value: string; source: string }>(),
      db
        .prepare(
          "SELECT data FROM dexcom_events WHERE owner = $1 AND at >= $2 ORDER BY at DESC LIMIT 5000",
        )
        .bind(owner, since)
        .all<{ data: string }>(),
      db
        .prepare("SELECT data FROM illness_windows WHERE owner = $1 ORDER BY start_date DESC")
        .bind(owner)
        .all<{ data: string }>(),
      db
        .prepare("SELECT data FROM profiles WHERE owner = $1")
        .bind(owner)
        .first<{ data: string }>(),
      db
        .prepare("SELECT data FROM appointments WHERE owner = $1 ORDER BY at")
        .bind(owner)
        .all<{ data: string }>(),
      db
        .prepare(
          "SELECT sensor_id, source, first_at, last_at FROM sensor_sessions WHERE owner = $1 ORDER BY last_at DESC LIMIT 1",
        )
        .bind(owner)
        .first<{ sensor_id: string; source: string | null; first_at: string; last_at: string }>(),
      db
        .prepare(
          "SELECT last_sync, last_error, (SELECT MAX(at) FROM cgm_readings WHERE owner = $1 AND source = 'Dexcom Clarity') AS latest_at FROM clarity_connections WHERE owner = $1",
        )
        .bind(owner)
        .first<{ last_sync: string | null; last_error: string | null; latest_at: string | null }>(),
    ]);
    const push = pushConfig(process.env);
    const sync = await syncStatus(db, push, owner);
    // Anything still waiting, say after the other Carby was unreachable, goes on each refresh,
    // and the other Carby's own changes, when it sends them back, come in the same way.
    if (sync?.pending)
      void flushSync(db, push, owner).catch((e: unknown) => console.warn("sync send failed", e));
    void pullSync(db, push, owner).catch((e: unknown) => console.warn("sync pull failed", e));
    const savedPlan: unknown = plan ? JSON.parse(plan.data) : null;
    const parsedPlan = plan ? planSchema.safeParse(savedPlan) : null;
    return conditionalJson(request, {
      illnessWindows: illnesses.results.map((r) => JSON.parse(r.data)),
      appointments: appointmentRows.results.map((r) => JSON.parse(r.data)),
      entries: records.results.map((r) => ({
        ...JSON.parse(r.data),
        revision: JSON.parse(r.data).revision ?? r.updated,
      })),
      plan: parsedPlan && parsedPlan.success ? parsedPlan.data : null,
      profile: (() => {
        const parsed = profileRow ? profileSchema.safeParse(JSON.parse(profileRow.data)) : null;
        return parsed && parsed.success ? parsed.data : null;
      })(),
      // Only the checked fields of an incomplete plan, so setup can prefill them for review.
      ...(parsedPlan && !parsedPlan.success ? { planDraft: planDraft(savedPlan) } : {}),
      history: history.results.map((r) => ({ plan: JSON.parse(r.data), at: r.created })),
      historyLimited: cgm.results.length === 15000,
      sync,
      savedFoods: foods.results.map((r) => JSON.parse(r.data)),
      dexcomEvents: events.results.map((r) => JSON.parse(r.data)),
      cgm: cgm.results.map((r) => ({
        at: r.at,
        value: r.value === "High" || r.value === "Low" ? null : Number(r.value),
        status: r.value === "High" || r.value === "Low" ? r.value : null,
        source: r.source,
      })),
      sensor: sensor
        ? ({
            sensorId: sensor.sensor_id,
            source: sensor.source,
            firstAt: sensor.first_at,
            lastAt: sensor.last_at,
          } satisfies SensorSession)
        : null,
      clarity: clarity
        ? ({
            lastSync: clarity.last_sync,
            lastError: clarity.last_error,
            latestAt: clarity.latest_at,
          } satisfies ClarityFreshness)
        : null,
    });
  } catch (e) {
    console.error("care load failed", e);
    return reply({ error: "Your log could not load. Please retry." }, 503);
  }
}
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in to save." }, 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return reply({ error: "Request origin rejected." }, 403);
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== "object") return reply({ error: "Invalid request." }, 400);
    const body = raw as Record<string, unknown>;
    const access = await accessFor(
      request,
      user,
      MANAGE_ACTIONS.has(String(body.action)) ? "manage" : "log",
    );
    if (access instanceof Response) return access;
    const owner = access.person;
    const db = database();
    // With sync on, each change queues its records to be sent (or pulled) in the same batch.
    const push = pushConfig(process.env);
    const queues = syncQueues(owner, push, acceptConfig(process.env));
    const queue = (...refs: SyncRef[]) => queueSyncStatements(db, queues, owner, refs);
    const send = () =>
      void flushSync(db, push, owner).catch((e: unknown) => console.warn("sync send failed", e));
    if (body.action === "plan") {
      const plan = planSchema.parse(body.plan);
      const prior = await db
        .prepare("SELECT data FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 1")
        .bind(owner)
        .first<{ data: string }>();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.batch([
        ...queue({ table: "plans", id }),
        db
          .prepare("INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4)")
          .bind(id, owner, JSON.stringify(plan), now),
        audit(
          db,
          owner,
          user.userId,
          user.displayName,
          id,
          "plan updated",
          prior?.data ?? null,
          JSON.stringify(plan),
        ),
      ]);
    } else if (body.action === "entry") {
      const requested = entrySchema.parse(body.entry);
      const existing = await db
        .prepare("SELECT owner, data, updated FROM entries WHERE id = $1")
        .bind(requested.id)
        .first<{ owner: string; data: string; updated: string }>();
      if (existing && existing.owner !== owner)
        return reply({ error: "Entry is unavailable." }, 403);
      const previous = existing ? entrySchema.parse(JSON.parse(existing.data)) : null;
      const entry = preserveEntryContext(requested, previous);
      if (previous && sameEntry(entry, previous)) return reply({ ok: true, replayed: true });
      if (existing && requested.revision !== (previous?.revision ?? existing.updated))
        return reply(
          {
            error:
              "This record changed in another window. Your input is preserved. Close and reopen the latest entry before saving.",
          },
          409,
        );
      const revision = crypto.randomUUID();
      const next = JSON.stringify({ ...entry, revision });
      const plan = await db
        .prepare("SELECT data FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 1")
        .bind(owner)
        .first<{ data: string }>();
      const parsedPlan = plan ? planSchema.safeParse(JSON.parse(plan.data)) : null;
      if (!existing && (!parsedPlan || !parsedPlan.success))
        return reply({ error: "Configure your care plan before saving entries." }, 400);
      const changed = existing
        ? db
            .prepare(
              "UPDATE entries SET at = $1, data = $2, updated = $3 WHERE id = $4 AND owner = $5 AND data = $6 AND updated = $7",
            )
            .bind(
              entry.at,
              next,
              new Date().toISOString(),
              entry.id,
              owner,
              existing.data,
              existing.updated,
            )
        : db
            .prepare(
              "INSERT INTO entries (id, owner, at, data, plan, updated) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(id) DO NOTHING",
            )
            .bind(entry.id, owner, entry.at, next, plan!.data, new Date().toISOString());
      const queued = queue({ table: "entries", id: entry.id });
      const results = await db.batch([
        ...queued,
        changed,
        db
          .prepare(
            'INSERT INTO care_audit (id, owner, entry_id, actor_id, actor_name, action, "before", "after", at) SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9 WHERE EXISTS (SELECT 1 FROM entries WHERE id = $10 AND owner = $11 AND data = $12)',
          )
          .bind(
            crypto.randomUUID(),
            owner,
            entry.id,
            user.userId,
            user.displayName,
            existing ? "updated" : "created",
            existing?.data ?? null,
            next,
            new Date().toISOString(),
            entry.id,
            owner,
            next,
          ),
      ]);
      if (!results[queued.length].meta.changes)
        return reply(
          {
            error:
              "This record changed while saving. Your input is preserved; reopen the latest entry.",
          },
          409,
        );
    } else if (body.action === "logCalculation") {
      const dose = entrySchema.parse(body.dose);
      const glucose = body.glucoseEntry == null ? null : entrySchema.parse(body.glucoseEntry);
      const food = body.foodEntry == null ? null : entrySchema.parse(body.foodEntry);
      if (
        dose.kind !== "insulin" ||
        dose.insulin !== "Rapid-acting" ||
        !dose.calculation ||
        dose.units === null ||
        dose.units <= 0 ||
        (glucose && glucose.kind !== "glucose")
      )
        return reply({ error: "Invalid calculated dose entries." }, 400);
      const calc = dose.calculation;
      let proposed: ReturnType<typeof calculationRecords>;
      try {
        proposed = calculationRecords(dose, glucose, food);
      } catch (e) {
        return reply({ error: e instanceof Error ? e.message : "Invalid linked entries." }, 400);
      }
      if (calc.adjustment && calc.adjustment.actualUnits !== dose.units)
        return reply({ error: "The adjustment must match the actual recorded dose." }, 400);
      if (
        (calc.mode === "Carbs" && (calc.glucose !== null || calc.source !== null)) ||
        (calc.mode === "Correction" && calc.carbs !== 0) ||
        (calc.mode !== "Carbs" && (calc.glucose === null || !calc.source))
      )
        return reply({ error: "Calculation inputs do not match the selected mode." }, 400);
      if (
        glucose &&
        (glucose.glucose !== calc.glucose ||
          glucose.source !== calc.source ||
          glucose.id === dose.id)
      )
        return reply({ error: "Glucose entry does not match the reviewed reading." }, 400);
      if (new Set(calc.foodEntryIds).size !== calc.foodEntryIds.length)
        return reply({ error: "Duplicate food links." }, 400);
      if (calc.foodEntryIds.length) {
        const linked = await Promise.all(
          calc.foodEntryIds.map((id) =>
            food?.id === id
              ? Promise.resolve({ data: JSON.stringify(food) })
              : db
                  .prepare("SELECT data FROM entries WHERE id = $1 AND owner = $2")
                  .bind(id, owner)
                  .first<{ data: string }>(),
          ),
        );
        const foods = linked.map((row) => (row ? entrySchema.parse(JSON.parse(row.data)) : null));
        if (
          foods.some((food) => !food || food.kind !== "food") ||
          Math.abs(foods.reduce((sum, food) => sum + (food?.carbs ?? 0), 0) - calc.carbs) > 0.02
        )
          return reply(
            { error: "Selected food entries changed. Review them and calculate again." },
            409,
          );
      }
      const plan = await db
        .prepare("SELECT data FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 1")
        .bind(owner)
        .first<{ data: string }>();
      const parsedPlan = plan ? planSchema.safeParse(JSON.parse(plan.data)) : null;
      if (!parsedPlan || !parsedPlan.success)
        return reply({ error: "Configure your care plan before saving entries." }, 400);
      const snapshot = plan!.data;
      const updated = new Date().toISOString();
      const duplicates = await Promise.all(
        proposed.map((entry) =>
          db
            .prepare("SELECT owner, data FROM entries WHERE id = $1")
            .bind(entry.id)
            .first<{ owner: string; data: string }>(),
        ),
      );
      if (duplicates.some(Boolean)) {
        if (
          duplicates.every(
            (row, index) =>
              row &&
              row.owner === owner &&
              sameEntry(proposed[index], entrySchema.parse(JSON.parse(row.data))),
          )
        )
          return reply({ ok: true, replayed: true });
        return reply(
          {
            error:
              "One of these records already exists with different information. Refresh and review the log.",
          },
          409,
        );
      }
      const items = proposed.map((entry) =>
        db
          .prepare(
            "INSERT INTO entries (id, owner, at, data, plan, updated) VALUES ($1, $2, $3, $4, $5, $6)",
          )
          .bind(entry.id, owner, entry.at, JSON.stringify(entry), snapshot, updated),
      );
      await db.batch([
        ...queue(...proposed.map((entry) => ({ table: "entries" as const, id: entry.id }))),
        ...items,
        ...proposed.map((entry) =>
          audit(
            db,
            owner,
            user.userId,
            user.displayName,
            entry.id,
            "created",
            null,
            JSON.stringify(entry),
          ),
        ),
      ]);
    } else if (body.action === "logMealFood") {
      const food = entrySchema.parse(body.food);
      if (typeof body.doseId !== "string" || typeof body.doseRevision !== "string")
        return reply({ error: "Open the latest dose before adding its food." }, 400);
      const stored = await db
        .prepare("SELECT owner, data, plan, updated FROM entries WHERE id = $1")
        .bind(body.doseId)
        .first<{ owner: string; data: string; plan: string; updated: string }>();
      if (!stored || stored.owner !== owner) return reply({ error: "Dose is unavailable." }, 403);
      const previous = entrySchema.parse(JSON.parse(stored.data));
      const existing = await db
        .prepare("SELECT owner, data FROM entries WHERE id = $1")
        .bind(food.id)
        .first<{ owner: string; data: string }>();
      if (existing) {
        if (
          existing.owner === owner &&
          previous.calculation?.foodEntryIds.includes(food.id) &&
          sameEntry(food, entrySchema.parse(JSON.parse(existing.data)))
        )
          return reply({ ok: true, replayed: true });
        return reply(
          { error: "This food entry already exists. Reopen the dose to review its linked food." },
          409,
        );
      }
      if (body.doseRevision !== (previous.revision ?? stored.updated))
        return reply({ error: "This dose changed. Reopen it before adding food." }, 409);
      let linked: ReturnType<typeof attachMealFood>;
      try {
        linked = attachMealFood(previous, food);
      } catch (e) {
        return reply({ error: e instanceof Error ? e.message : "Cannot link this food." }, 400);
      }
      const next = JSON.stringify({ ...linked, revision: crypto.randomUUID() }),
        foodData = JSON.stringify(food),
        updated = new Date().toISOString();
      const queued = queue(
        { table: "entries", id: food.id },
        { table: "entries", id: previous.id },
      );
      const results = await db.batch([
        ...queued,
        db
          .prepare(insertMealFoodSql)
          .bind(
            food.id,
            owner,
            food.at,
            foodData,
            stored.plan,
            updated,
            previous.id,
            owner,
            stored.data,
            stored.updated,
          ),
        db
          .prepare(attachMealFoodSql)
          .bind(
            next,
            updated,
            previous.id,
            owner,
            stored.data,
            stored.updated,
            food.id,
            owner,
            foodData,
          ),
        ...[
          { id: food.id, action: "created", before: null, after: foodData },
          { id: previous.id, action: "updated", before: stored.data, after: next },
        ].map((record) =>
          db
            .prepare(
              'INSERT INTO care_audit (id, owner, entry_id, actor_id, actor_name, action, "before", "after", at) SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9 WHERE EXISTS (SELECT 1 FROM entries WHERE id = $10 AND owner = $11 AND data = $12)',
            )
            .bind(
              crypto.randomUUID(),
              owner,
              record.id,
              user.userId,
              user.displayName,
              record.action,
              record.before,
              record.after,
              updated,
              previous.id,
              owner,
              next,
            ),
        ),
      ]);
      if (!results[queued.length].meta.changes || !results[queued.length + 1].meta.changes)
        return reply(
          { error: "This dose changed while saving. Reopen it before adding food." },
          409,
        );
    } else if (body.action === "illness" || body.action === "deleteIllness") {
      const requested = illnessSchema.parse(body.illness);
      if (body.action === "illness") {
        try {
          validateIllnessDates(requested, Date.now());
        } catch (e) {
          return reply({ error: e instanceof Error ? e.message : "Check the illness dates." }, 400);
        }
      }
      const existing = await db
        .prepare("SELECT owner, data, updated FROM illness_windows WHERE id = $1")
        .bind(requested.id)
        .first<{ owner: string; data: string; updated: string }>();
      if (existing && existing.owner !== owner)
        return reply({ error: "Illness record is unavailable." }, 403);
      if (body.action === "deleteIllness" && !existing)
        return reply({ error: "Illness record no longer exists." }, 404);
      if (existing && requested.revision !== JSON.parse(existing.data).revision)
        return reply(
          {
            error:
              "This illness range changed in another window. Your input is preserved; reopen the latest record.",
          },
          409,
        );
      if (!existing && requested.revision)
        return reply({ error: "This illness record was removed. Reopen the log." }, 409);
      const deleting = body.action === "deleteIllness";
      const illness = { ...requested, revision: crypto.randomUUID() };
      const next = JSON.stringify(illness),
        updated = new Date().toISOString();
      const [guarded, guardArgs]: [string, unknown[]] = deleting
        ? [
            "DELETE FROM illness_windows WHERE id = $1 AND owner = $2 AND data = $3",
            [requested.id, owner, existing!.data],
          ]
        : existing
          ? [
              "UPDATE illness_windows SET start_date = $1, data = $2, updated = $3 WHERE id = $4 AND owner = $5 AND data = $6",
              [requested.startDate, next, updated, requested.id, owner, existing.data],
            ]
          : [
              "INSERT INTO illness_windows (id, owner, start_date, data, updated) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO NOTHING",
              [requested.id, owner, requested.startDate, next, updated],
            ];
      // One statement: the audit row is written only when the guarded change applied. The audit
      // values are numbered after the guarded statement's own parameters.
      const auditValues = Array.from({ length: 9 }, (_, i) => `$${guardArgs.length + i + 1}`);
      const [result] = (
        await db.batch([
          ...queue({ table: "illness_windows", id: requested.id }),
          db
            .prepare(
              `WITH changed AS (${guarded} RETURNING id) INSERT INTO care_audit (id, owner, entry_id, actor_id, actor_name, action, "before", "after", at) SELECT ${auditValues.join(", ")} WHERE EXISTS (SELECT 1 FROM changed)`,
            )
            .bind(
              ...guardArgs,
              crypto.randomUUID(),
              owner,
              requested.id,
              user.userId,
              user.displayName,
              deleting ? "deleted" : existing ? "updated" : "created",
              existing?.data ?? null,
              deleting ? null : next,
              updated,
            ),
        ])
      ).slice(-1);
      if (!result.meta.changes)
        return reply(
          { error: "This illness record changed while saving. Reopen the latest range." },
          409,
        );
      send();
      return reply({ ok: true, illness: deleting ? null : illness });
    } else if (body.action === "saveAppointment") {
      const requested = appointmentSchema.parse(body.appointment);
      const existing = await db
        .prepare("SELECT owner, data, updated FROM appointments WHERE id = $1")
        .bind(requested.id)
        .first<{ owner: string; data: string; updated: string }>();
      if (existing && existing.owner !== owner)
        return reply({ error: "Appointment is unavailable." }, 403);
      if (existing && requested.revision !== JSON.parse(existing.data).revision)
        return reply(
          {
            error:
              "This appointment changed in another window. Your input is preserved; reopen the latest appointment.",
          },
          409,
        );
      if (!existing && requested.revision)
        return reply({ error: "This appointment was removed. Reopen the log." }, 409);
      const appointment = { ...requested, revision: crypto.randomUUID() };
      const next = JSON.stringify(appointment),
        updated = new Date().toISOString();
      const changed = existing
        ? db
            .prepare(
              "UPDATE appointments SET at = $1, data = $2, updated = $3 WHERE id = $4 AND owner = $5 AND data = $6",
            )
            .bind(appointment.at, next, updated, requested.id, owner, existing.data)
        : db
            .prepare(
              "INSERT INTO appointments (id, owner, at, data, updated) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO NOTHING",
            )
            .bind(requested.id, owner, appointment.at, next, updated);
      const queued = queue({ table: "appointments", id: requested.id });
      const results = await db.batch([
        ...queued,
        changed,
        db
          .prepare(
            'INSERT INTO care_audit (id, owner, entry_id, actor_id, actor_name, action, "before", "after", at) SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9 WHERE EXISTS (SELECT 1 FROM appointments WHERE id = $10 AND owner = $11 AND data = $12)',
          )
          .bind(
            crypto.randomUUID(),
            owner,
            requested.id,
            user.userId,
            user.displayName,
            existing ? "updated" : "created",
            existing?.data ?? null,
            next,
            updated,
            requested.id,
            owner,
            next,
          ),
      ]);
      if (!results[queued.length].meta.changes)
        return reply(
          {
            error:
              "This appointment changed while saving. Your input is preserved; reopen the latest appointment.",
          },
          409,
        );
      send();
      return reply({ ok: true, appointment });
    } else if (body.action === "deleteAppointment" && typeof body.id === "string") {
      const previous = await db
        .prepare("SELECT data FROM appointments WHERE id = $1 AND owner = $2")
        .bind(body.id, owner)
        .first<{ data: string }>();
      if (!previous) return reply({ error: "Appointment no longer exists." }, 404);
      await db.batch([
        ...queue({ table: "appointments", id: body.id }),
        db.prepare("DELETE FROM appointments WHERE id = $1 AND owner = $2").bind(body.id, owner),
        audit(db, owner, user.userId, user.displayName, body.id, "deleted", previous.data, null),
      ]);
    } else if (body.action === "food") {
      const food = savedFoodSchema.parse(body.food);
      await db.batch([
        ...queue({ table: "saved_foods", id: food.id }),
        db
          .prepare(
            "INSERT INTO saved_foods (id, owner, name, data, updated) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated = excluded.updated WHERE saved_foods.owner = excluded.owner",
          )
          .bind(food.id, owner, food.name, JSON.stringify(food), new Date().toISOString()),
      ]);
    } else if (body.action === "deleteFood" && typeof body.id === "string") {
      await db.batch([
        ...queue({ table: "saved_foods", id: body.id }),
        db.prepare("DELETE FROM saved_foods WHERE id = $1 AND owner = $2").bind(body.id, owner),
      ]);
    } else if (body.action === "profile") {
      const profile = profileSchema.parse(body.profile);
      await db.batch([
        ...queue({ table: "profiles", id: profile.id }),
        db
          .prepare(
            "INSERT INTO profiles (id, owner, data, updated) VALUES ($1, $2, $3, $4) ON CONFLICT (owner) DO UPDATE SET id = excluded.id, data = excluded.data, updated = excluded.updated",
          )
          .bind(profile.id, owner, JSON.stringify(profile), new Date().toISOString()),
      ]);
    } else if (body.action === "importCgm") {
      if (!Array.isArray(body.readings) || body.readings.length === 0 || body.readings.length > 250)
        return reply({ error: "Import 1–250 readings per batch." }, 400);
      const readings = body.readings.map((v) => cgmSchema.parse(v));
      if (readings.some((v) => v.source !== "Dexcom Clarity"))
        return reply({ error: "The CSV import only accepts Dexcom Clarity readings." }, 400);
      if (readings.some((v) => Date.parse(v.at) > Date.now() + 300000))
        return reply(
          { error: "CSV readings are in the future. Check the export time zone before importing." },
          400,
        );
      const { saves, cleanups } = await clarityReadingStatements(db, owner, readings);
      const results = await db.batch([...saves, ...cleanups]);
      const changed = results
        .slice(0, saves.length)
        .reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0);
      const legacyDuplicatesRemoved = results
        .slice(saves.length)
        .reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0);
      return reply({
        ok: true,
        processed: readings.length,
        changed,
        unchanged: readings.length - changed,
        legacyDuplicatesRemoved,
      });
    } else if (body.action === "importDexcomEvents") {
      if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > 250)
        return reply({ error: "Import 1–250 events per batch." }, 400);
      const events = body.events.map((v) => dexcomEventSchema.parse(v));
      if (events.some((v) => Date.parse(v.at) > Date.now() + 300000))
        return reply(
          { error: "CSV events are in the future. Check the export time zone before importing." },
          400,
        );
      const results = await db.batch(await clarityEventStatements(db, owner, events));
      const changed = results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0);
      return reply({
        ok: true,
        processed: events.length,
        changed,
        unchanged: events.length - changed,
      });
    } else if (body.action === "delete" && typeof body.id === "string") {
      const previous = await db
        .prepare("SELECT data FROM entries WHERE id = $1 AND owner = $2")
        .bind(body.id, owner)
        .first<{ data: string }>();
      if (!previous) return reply({ error: "Entry no longer exists." }, 404);
      const now = new Date().toISOString();
      await db.batch([
        ...queue({ table: "entries", id: body.id }),
        db.prepare("DELETE FROM entries WHERE id = $1 AND owner = $2").bind(body.id, owner),
        audit(db, owner, user.userId, user.displayName, body.id, "deleted", previous.data, null),
        tombstoneFor(db, owner, body.id, now),
      ]);
    } else if (body.action === "syncResend" || body.action === "syncDiscard") {
      await resolveHeld(db, owner, body.action === "syncResend" ? "send" : "discard");
    } else if (body.action === "syncPullSend" || body.action === "syncPullDiscard") {
      if (!push) return reply({ error: "Sync is not set up here." }, 400);
      try {
        await resolvePulled(push, body.action === "syncPullSend" ? "send" : "discard");
      } catch (e) {
        return reply(
          { error: e instanceof Error ? e.message : "Could not reach the other Carby." },
          503,
        );
      }
      // Take their copies now, so the notice reflects the choice on the next refresh.
      await pullSync(db, push, owner);
    } else {
      return reply({ error: "Invalid action." }, 400);
    }
    send();
    return reply({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.name === "ZodError")
      return reply({ error: "Check the values and event time before saving." }, 400);
    console.error("care save failed", e);
    return reply({ error: "Could not save. Your input is still here; please retry." }, 503);
  }
}
