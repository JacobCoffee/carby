/** Minute-precision times and a periodic `now` can put a just-taken reading slightly ahead of `now`. */
const CLOCK_SKEW_MS = 60_000;
/** Check that a measured glucose timestamp is within the ten-minute review window. */
export function isRecentReading(measuredAt: string | null | undefined, nowMs: number): boolean {
  if (!measuredAt || !Number.isFinite(nowMs)) return false;
  const measuredMs = Date.parse(measuredAt);
  return (
    Number.isFinite(measuredMs) &&
    measuredMs <= nowMs + CLOCK_SKEW_MS &&
    nowMs - measuredMs <= 10 * 60_000
  );
}
