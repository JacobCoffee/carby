import { dateKey, fromLocal, type Entry, type Plan } from "./care";

export type NightlyReminder = {
  at: string;
  state: "upcoming" | "due" | "unlogged" | "logged";
  visible: boolean;
  logged: Entry[];
};

const hour = 60 * 60 * 1000;
function adjacentDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** Display-only association: each actual dose belongs to its nearest scheduled
 * occurrence (midpoint boundaries). This includes early and after-midnight logs
 * without using today's calendar date as evidence for tonight's dose.
 * No administration or dose recommendation is inferred from a missing record. */
export function nightlyReminder(
  entries: Entry[],
  now: number,
  plan: Pick<Plan, "basal" | "basalTime" | "timezone" | "longActingReminderHours">,
): NightlyReminder | null {
  if (!Number.isFinite(now) || plan.basal === 0) return null;
  try {
    const today = dateKey(new Date(now), plan.timezone);
    const occurrence = (offset: number) =>
      Date.parse(fromLocal(`${adjacentDay(today, offset)}T${plan.basalTime}`, plan.timezone));
    // Retain the prior night through midnight until the next reminder window opens.
    const offset = now >= occurrence(1) - 2 * hour ? 1 : now >= occurrence(0) - 2 * hour ? 0 : -1;
    const scheduled = occurrence(offset);
    const start = (occurrence(offset - 1) + scheduled) / 2;
    const end = (scheduled + occurrence(offset + 1)) / 2;
    const logged = entries
      .filter((entry) => {
        const at = Date.parse(entry.at);
        return (
          entry.kind === "insulin" &&
          entry.insulin === "Long-acting" &&
          (entry.units ?? 0) > 0 &&
          at >= start &&
          at < end &&
          at <= now
        );
      })
      .sort((a, b) => b.at.localeCompare(a.at));
    const state = logged.length
      ? "logged"
      : now >= scheduled + 15 * 60 * 1000
        ? "unlogged"
        : now >= scheduled
          ? "due"
          : "upcoming";
    // With a reminder window set, the chip shows only that close to the scheduled time.
    const inWindow =
      plan.longActingReminderHours === undefined ||
      Math.abs(now - scheduled) <= plan.longActingReminderHours * hour;
    return {
      at: new Date(scheduled).toISOString(),
      state,
      visible: (offset >= 0 || !logged.length) && inWindow,
      logged,
    };
  } catch {
    return null;
  }
}

/** Every scheduled long-acting time from `from` to `to` (inclusive), in the plan's zone. */
export function nightlySchedule(
  plan: Pick<Plan, "basal" | "basalTime" | "timezone">,
  from: number,
  to: number,
): string[] {
  if (plan.basal === 0 || !Number.isFinite(from) || !Number.isFinite(to)) return [];
  const times: string[] = [];
  const last = dateKey(new Date(to), plan.timezone);
  for (let day = dateKey(new Date(from), plan.timezone); day <= last; day = adjacentDay(day, 1)) {
    try {
      const at = Date.parse(fromLocal(`${day}T${plan.basalTime}`, plan.timezone));
      if (at >= from && at <= to) times.push(new Date(at).toISOString());
    } catch {
      // A clock change skipped this day's scheduled time.
    }
  }
  return times;
}
