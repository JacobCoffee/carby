import type { CgmReading, Entry, Plan } from "./care";
import { illnessBounds, isSick, type IllnessWindow } from "./illness";

/** Descriptive check-due tracking only; never a dosing calculation. */
export type Due = { lastAt: string | null; dueAt: string; overdue: boolean };
export type SickDayStatus = {
  illness: IllnessWindow;
  checks: null | { glucose: Due; ketones: Due };
};

function due(lastAt: string | null, illnessStart: number, hours: number, now: number): Due {
  const anchor = lastAt ? Date.parse(lastAt) : illnessStart;
  const dueAt = new Date(anchor + hours * 60 * 60 * 1000).toISOString();
  return { lastAt, dueAt, overdue: Date.parse(dueAt) <= now };
}

function isActiveNow(illness: IllnessWindow, now: number): boolean {
  try {
    const { start, end } = illnessBounds(illness, now);
    return start <= now && (illness.endDate === null || end >= now);
  } catch {
    return false;
  }
}

/** The currently active sick period covering `now`, or null when none is active. */
export function sickDayStatus(o: {
  illnesses: IllnessWindow[];
  entries: Entry[];
  cgm: CgmReading[];
  plan: Pick<Plan, "sickDayChecks">;
  now: number;
}): SickDayStatus | null {
  const { illnesses, entries, cgm, plan, now } = o;
  const active = illnesses.find((illness) => isSick(illness) && isActiveNow(illness, now));
  if (!active) return null;
  if (!plan.sickDayChecks) return { illness: active, checks: null };
  const { start } = illnessBounds(active, now);
  const glucoseAt = [...entries.filter((e) => e.kind === "glucose"), ...cgm]
    .map((e) => e.at)
    .filter((at) => Date.parse(at) >= start && Date.parse(at) <= now)
    .sort()
    .at(-1);
  const ketoneAt = entries
    .filter(
      (e) =>
        e.kind === "glucose" &&
        e.ketones &&
        e.ketones !== "Not checked" &&
        Date.parse(e.at) >= start &&
        Date.parse(e.at) <= now,
    )
    .map((e) => e.at)
    .sort()
    .at(-1);
  return {
    illness: active,
    checks: {
      glucose: due(glucoseAt ?? null, start, plan.sickDayChecks.glucoseHours, now),
      ketones: due(ketoneAt ?? null, start, plan.sickDayChecks.ketoneHours, now),
    },
  };
}
