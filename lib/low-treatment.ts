import type { CgmReading, Entry, Plan } from "./care";

/** Descriptive recheck tracking only; never a dosing calculation. */
export type LowRecheck = {
  treatedAt: string;
  dueAt: string;
  state: "waiting" | "due" | "still-low" | "recovered";
  reading?: { at: string; value: number | null; status: "High" | "Low" | null };
};

const hour = 60 * 60 * 1000;

/** The most recent low-treatment food entry, and whether a recheck is due, still low, or recovered. */
export function lowRecheck(o: {
  entries: Entry[];
  cgm: CgmReading[];
  plan: Pick<Plan, "lowThreshold" | "lowTreatment">;
  now: number;
}): LowRecheck | null {
  const { entries, cgm, plan, now } = o;
  if (!plan.lowTreatment) return null;
  const treated = entries
    .filter(
      (e) =>
        e.kind === "food" &&
        e.meal === "Low treatment" &&
        now - Date.parse(e.at) <= 2 * hour &&
        Date.parse(e.at) <= now,
    )
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!treated) return null;
  const dueAt = new Date(
    Date.parse(treated.at) + plan.lowTreatment.recheckMinutes * 60_000,
  ).toISOString();
  const readings = [
    ...entries
      .filter((e) => e.kind === "glucose")
      .map((e) => ({ at: e.at, value: e.glucose, status: e.status ?? null })),
    ...cgm.map((r) => ({ at: r.at, value: r.value, status: r.status })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  // A recheck reading is anything at or after the due time, minus a 2-minute grace for logging lag.
  const recheckReading = readings.find(
    (r) => Date.parse(r.at) >= Date.parse(dueAt) - 2 * 60_000 && Date.parse(r.at) <= now,
  );
  const stillLow = recheckReading
    ? recheckReading.status === "Low" ||
      (recheckReading.value !== null && recheckReading.value < plan.lowThreshold)
    : false;
  const state = recheckReading
    ? stillLow
      ? "still-low"
      : "recovered"
    : now >= Date.parse(dueAt)
      ? "due"
      : "waiting";
  return { treatedAt: treated.at, dueAt, state, reading: recheckReading };
}
