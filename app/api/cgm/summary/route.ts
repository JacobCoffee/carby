import { getCurrentUser } from "@/app/auth";
import { accessFor } from "@/app/access";
import { database } from "@/db/raw";
import { fromLocal, glucoseRanges, planSchema } from "@/lib/care";
import type { ClarityDevice } from "@/lib/clarity";
import { addDays } from "@/lib/clarity-client";
import { isDate, localDate, spanDays } from "@/lib/clarity-sync";
import {
  MAX_SUMMARY_DAYS,
  cgmSummary,
  type CgmSummaryResponse,
  type SensorSession,
} from "@/lib/cgm-summary";
import { conditionalJson } from "@/lib/conditional-json";

export const dynamic = "force-dynamic";

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * CGM statistics for inclusive local dates: GET /api/cgm/summary?start=YYYY-MM-DD&end=YYYY-MM-DD.
 * The server reads up to a year of readings so the browser receives only the summaries.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in to access your care log." }, 401);
  const access = await accessFor(request, user, "read");
  if (access instanceof Response) return access;
  const owner = access.person;
  const params = new URL(request.url).searchParams;
  const startDay = params.get("start"),
    endDay = params.get("end");
  if (
    !isDate(startDay) ||
    !isDate(endDay) ||
    startDay > endDay ||
    spanDays(startDay, endDay) > MAX_SUMMARY_DAYS
  )
    return reply({ error: `Choose a date range of up to ${MAX_SUMMARY_DAYS} days.` }, 400);
  try {
    const db = database();
    const saved = await db
      .prepare("SELECT data FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 1")
      .bind(owner)
      .first<{ data: string }>();
    const plan = saved ? planSchema.safeParse(JSON.parse(saved.data)) : null;
    if (!plan?.success) return reply({ error: "Configure your care plan first." }, 409);
    const { timezone } = plan.data;
    if (endDay > addDays(localDate(timezone), 1))
      return reply({ error: "The date range ends in the future." }, 400);
    const from = fromLocal(`${startDay}T00:00`, timezone),
      to = fromLocal(`${addDays(endDay, 1)}T00:00`, timezone);
    const [cgm, sensors, device] = await Promise.all([
      // One reading per instant, preferring a number and then Clarity, as the care snapshot does.
      db
        .prepare(
          "SELECT at, value, source FROM (SELECT at, value, source, ROW_NUMBER() OVER (PARTITION BY at ORDER BY CASE WHEN value IN ('High','Low') THEN 1 ELSE 0 END, CASE WHEN source = 'Dexcom Clarity' THEN 0 ELSE 1 END) AS chosen FROM cgm_readings WHERE owner = $1 AND at >= $2 AND at < $3) AS ranked WHERE chosen = 1 ORDER BY at",
        )
        .bind(owner, from, to)
        .all<{ at: string; value: string; source: string }>(),
      db
        .prepare(
          "SELECT sensor_id, source, first_at, last_at FROM sensor_sessions WHERE owner = $1 ORDER BY first_at",
        )
        .bind(owner)
        .all<{ sensor_id: string; source: string | null; first_at: string; last_at: string }>(),
      db
        .prepare("SELECT data FROM cgm_device_settings WHERE owner = $1")
        .bind(owner)
        .first<{ data: string }>(),
    ]);
    const ranges = glucoseRanges(plan.data);
    const summary: CgmSummaryResponse = {
      ...cgmSummary({
        readings: cgm.results.map((r) => ({
          at: r.at,
          value: r.value === "High" || r.value === "Low" ? null : Number(r.value),
          status: r.value === "High" || r.value === "Low" ? r.value : null,
          source: r.source,
        })),
        startDay,
        endDay,
        timezone,
        now: Date.now(),
        planRange: ranges.standard ? undefined : { low: ranges.low, high: ranges.high },
      }),
      sensors: sensors.results.map((s): SensorSession => ({
        sensorId: s.sensor_id,
        source: s.source,
        firstAt: s.first_at,
        lastAt: s.last_at,
      })),
      device: device ? (JSON.parse(device.data) as ClarityDevice) : null,
    };
    return conditionalJson(request, summary);
  } catch {
    return reply({ error: "CGM summary is unavailable." }, 503);
  }
}
