import type { Database } from "../db/postgres";
import type { CgmReading, DexcomEvent } from "./care";

/** Prefer an exact Clarity export over an earlier Share status at the same instant. */
export const saveCgmSql = `INSERT INTO cgm_readings (id, owner, at, value, source)
 VALUES ($1, $2, $3, $4, $5)
 ON CONFLICT(id) DO UPDATE SET value = excluded.value, source = excluded.source
 WHERE cgm_readings.owner = excluded.owner AND (
  (cgm_readings.value IN ('High','Low') AND excluded.value NOT IN ('High','Low'))
  OR (cgm_readings.source = 'Dexcom Share' AND excluded.source = 'Dexcom Clarity'
      AND excluded.value NOT IN ('High','Low') AND cgm_readings.value NOT IN ('High','Low'))
 )`;

/** The previous CSV reader discarded seconds; remove only a matching old Clarity row after saving its precise replacement. */
export const cleanupLegacyClaritySql = `DELETE FROM cgm_readings
 WHERE owner = $1 AND source = 'Dexcom Clarity' AND `;
export function legacyRoundedAt(at: string): string | null {
  const rounded = at.replace(/:\d{2}\.\d{3}Z$/, ":00.000Z");
  return rounded === at ? null : rounded;
}

async function rowId(key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Save Clarity readings, then remove any matching minute-rounded rows the old CSV reader left.
 * Run `saves` and `cleanups` in one batch; only the saves' changes count as new readings.
 */
export async function clarityReadingStatements(
  db: Database,
  owner: string,
  readings: readonly CgmReading[],
) {
  const saves = await Promise.all(
    readings.map(async (v) =>
      db
        .prepare(saveCgmSql)
        .bind(await rowId(owner + "|" + v.at), owner, v.at, v.status ?? String(v.value), v.source),
    ),
  );
  const legacyRows = readings.flatMap((v) => {
    const rounded = legacyRoundedAt(v.at);
    return rounded ? [[rounded, v.status ?? String(v.value)]] : [];
  });
  const cleanups = [];
  for (let i = 0; i < legacyRows.length; i += 40) {
    const group = legacyRows.slice(i, i + 40);
    // cleanupLegacyClaritySql binds the owner as $1; each pair follows it.
    const conditions = group
      .map((_, j) => ` (at = $${2 + 2 * j} AND value = $${3 + 2 * j}) `)
      .join(" OR ");
    cleanups.push(
      db.prepare(`${cleanupLegacyClaritySql}(${conditions})`).bind(owner, ...group.flat()),
    );
  }
  return { saves, cleanups };
}

/** Insert Clarity device events once each; an identical event is skipped. */
export function clarityEventStatements(
  db: Database,
  owner: string,
  events: readonly DexcomEvent[],
) {
  return Promise.all(
    events.map(async (v) =>
      db
        .prepare(
          "INSERT INTO dexcom_events (id, owner, at, data) VALUES ($1, $2, $3, $4) ON CONFLICT(id) DO NOTHING",
        )
        .bind(
          await rowId(owner + "|" + v.at + "|" + v.type + "|" + v.details + "|" + String(v.value)),
          owner,
          v.at,
          JSON.stringify(v),
        ),
    ),
  );
}
