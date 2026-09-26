import type { CgmReading } from "./care";
import { isRecentReading } from "./reading-freshness";

/** Return only a current numeric Share value from the connected publisher. */
export function currentShareForCorrection(
  readings: CgmReading[],
  connected: boolean,
  latestShareAt: string | null,
  nowMs: number,
): CgmReading | null {
  if (!connected || !isRecentReading(latestShareAt, nowMs)) return null;
  const newest = readings
    .filter((reading) => reading.source === "Dexcom Share")
    .reduce<CgmReading | null>(
      (latest, reading) => (!latest || reading.at > latest.at ? reading : latest),
      null,
    );
  if (!newest || !isRecentReading(newest.at, nowMs) || newest.value === null) return null;
  // An older numeric value must not override a newer HIGH/LOW status or a stale sync.
  if (Date.parse(newest.at) < Date.parse(latestShareAt!) - 60_000) return null;
  return newest;
}
