import { dateKey, fromLocal, type Entry, type Plan } from "./care";

/** Descriptive overnight-check reminder only; never a dosing calculation. */
export type OvernightCheck = {
  at: string;
  state: "upcoming" | "due" | "logged" | "missed";
  reason: "plan" | "severe-low";
};

const minute = 60_000;
const hour = 60 * minute;
/** A finger-stick this close to the scheduled time counts as the check; past it, the night is over. */
const WINDOW = 90 * minute;
function adjacentDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * The next overnight check whose window has not closed. It applies while its night is on or before
 * `plan.overnightCheck.until` (a check before noon belongs to the previous evening's night), or when
 * a rescue entry was logged in the 24 hours before it (reason "severe-low").
 */
export function overnightCheck(o: {
  entries: Entry[];
  plan: Pick<Plan, "overnightCheck" | "timezone">;
  now: number;
}): OvernightCheck | null {
  const { entries, plan, now } = o;
  if (!plan.overnightCheck || !Number.isFinite(now)) return null;
  const { time, until } = plan.overnightCheck;
  try {
    const today = dateKey(new Date(now), plan.timezone);
    const day = [-1, 0, 1]
      .map((offset) => adjacentDay(today, offset))
      .find((d) => Date.parse(fromLocal(`${d}T${time}`, plan.timezone)) + WINDOW > now)!;
    const scheduled = Date.parse(fromLocal(`${day}T${time}`, plan.timezone));
    const night = time < "12:00" ? adjacentDay(day, -1) : day;
    const reason =
      night <= until
        ? "plan"
        : entries.some(
              (e) =>
                e.kind === "rescue" &&
                Date.parse(e.at) <= scheduled &&
                scheduled - Date.parse(e.at) <= 24 * hour,
            )
          ? "severe-low"
          : null;
    if (!reason) return null;
    const logged = entries.some(
      (e) =>
        e.kind === "glucose" &&
        e.source === "Finger-stick" &&
        Math.abs(Date.parse(e.at) - scheduled) <= WINDOW,
    );
    const state = logged
      ? "logged"
      : now < scheduled
        ? "upcoming"
        : now < scheduled + 15 * minute
          ? "due"
          : "missed";
    return { at: new Date(scheduled).toISOString(), state, reason };
  } catch {
    return null;
  }
}

/**
 * Promote the reminder to a full-width banner from the moment a finger-stick would count as the
 * check (the window before it) until it is logged or the window closes.
 */
export function overnightBannerShown(check: OvernightCheck | null, now: number) {
  return !!check && check.state !== "logged" && Date.parse(check.at) - now <= WINDOW;
}
