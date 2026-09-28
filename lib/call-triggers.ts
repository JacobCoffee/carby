import type { CgmReading, Entry, Plan } from "./care";
import { isCorrectionDose } from "./correction-review";

/**
 * Descriptive call-the-team triggers only; never a dosing calculation.
 * Each trigger is evaluated independently and none are mutually exclusive.
 */
export type CallTrigger =
  | {
      kind: "above-after-correction";
      at: string;
      value: number | null;
      correctionAt: string;
      above: number;
      hours: number;
    }
  | { kind: "ketones"; at: string; level: "Moderate" | "Large" }
  | { kind: "rescue"; at: string; medication: string };

const hour = 60 * 60 * 1000;

/** 15-minute freshness window, per the clinic's after-correction check (distinct from the
 * 10-minute dose-review window in reading-freshness.ts). */
function isCurrent(at: string, now: number): boolean {
  const ms = Date.parse(at);
  return Number.isFinite(ms) && ms <= now + 60_000 && now - ms <= 15 * 60_000;
}
function currentReading(
  entries: Entry[],
  cgm: CgmReading[],
  now: number,
): { at: string; value: number | null; status: "High" | "Low" | null } | null {
  const finger = entries
    .filter((e) => e.kind === "glucose")
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const share = cgm
    .filter((r) => r.source === "Dexcom Share")
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const candidate =
    finger && share
      ? finger.at > share.at
        ? { at: finger.at, value: finger.glucose, status: finger.status ?? null }
        : { at: share.at, value: share.value, status: share.status }
      : finger
        ? { at: finger.at, value: finger.glucose, status: finger.status ?? null }
        : share
          ? { at: share.at, value: share.value, status: share.status }
          : null;
  return candidate && isCurrent(candidate.at, now) ? candidate : null;
}

export function callTriggers(o: {
  entries: Entry[];
  cgm: CgmReading[];
  plan: Plan;
  now: number;
}): CallTrigger[] {
  const { entries, cgm, plan, now } = o;
  const triggers: CallTrigger[] = [];

  if (plan.correctionCallCheck) {
    const { above, hours } = plan.correctionCallCheck;
    const reading = currentReading(entries, cgm, now);
    const corrections = entries.filter(isCorrectionDose).sort((a, b) => b.at.localeCompare(a.at));
    const lastCorrection = corrections[0];
    if (reading && lastCorrection) {
      const abovePlan =
        reading.status === "High" || (reading.value !== null && reading.value > above);
      const elapsedHours = (Date.parse(reading.at) - Date.parse(lastCorrection.at)) / hour;
      if (abovePlan && elapsedHours >= hours)
        triggers.push({
          kind: "above-after-correction",
          at: reading.at,
          value: reading.value,
          correctionAt: lastCorrection.at,
          above,
          hours,
        });
    }
  }

  const ketoneHit = entries.find(
    (e) =>
      e.kind === "glucose" &&
      (e.ketones === "Moderate" || e.ketones === "Large") &&
      now - Date.parse(e.at) <= 12 * hour &&
      Date.parse(e.at) <= now,
  );
  if (ketoneHit)
    triggers.push({
      kind: "ketones",
      at: ketoneHit.at,
      level: ketoneHit.ketones as "Moderate" | "Large",
    });

  const rescueHit = entries
    .filter(
      (e) => e.kind === "rescue" && now - Date.parse(e.at) <= 24 * hour && Date.parse(e.at) <= now,
    )
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (rescueHit && rescueHit.medication)
    triggers.push({ kind: "rescue", at: rescueHit.at, medication: rescueHit.medication });

  return triggers;
}
