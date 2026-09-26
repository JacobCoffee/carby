import type { CorrectionReview } from "./correction-review";
import type { NightlyReminder } from "./nightly-reminder";
import type { OvernightCheck } from "./overnight-check";
import type { LowRecheck } from "./low-treatment";
import type { SickDayStatus } from "./sick-day";

/** How close to a reminder's time the collapsed reminder strip opens itself. */
export const REMINDER_ATTENTION_MINUTES = 30;

/**
 * Keys for the header reminders that need to be seen now: within ±30 minutes of their time, or
 * in a state that needs action (still high, not logged, missed, still low, overdue). A key names
 * one occurrence, so collapsing the strip acknowledges it without hiding the next one, and an
 * approaching reminder that turns urgent gets a new key.
 */
export function reminderAttention(o: {
  correction: CorrectionReview | null;
  stillHigh: boolean;
  nightly: NightlyReminder | null;
  overnight: OvernightCheck | null;
  lowRecheck: LowRecheck | null;
  sickDay: SickDayStatus | null;
  now: number;
}): string[] {
  const { correction, nightly, overnight, lowRecheck, sickDay, now } = o;
  const near = (at: string) =>
    Math.abs(Date.parse(at) - now) <= REMINDER_ATTENTION_MINUTES * 60_000;
  const keys: string[] = [];
  if (correction) {
    if (o.stillHigh) keys.push(`correction:${correction.at}:urgent`);
    else if (near(correction.at)) keys.push(`correction:${correction.at}`);
  }
  if (nightly?.visible && nightly.state !== "logged") {
    if (nightly.state === "unlogged") keys.push(`nightly:${nightly.at}:urgent`);
    else if (near(nightly.at)) keys.push(`nightly:${nightly.at}`);
  }
  if (overnight && overnight.state !== "logged") {
    if (overnight.state === "missed") keys.push(`overnight:${overnight.at}:urgent`);
    else if (near(overnight.at)) keys.push(`overnight:${overnight.at}`);
  }
  if (lowRecheck && lowRecheck.state !== "recovered") {
    if (lowRecheck.state !== "waiting") keys.push(`low:${lowRecheck.dueAt}:${lowRecheck.state}`);
    else if (near(lowRecheck.dueAt)) keys.push(`low:${lowRecheck.dueAt}`);
  }
  for (const [name, due] of Object.entries(sickDay?.checks ?? {})) {
    if (due.overdue) keys.push(`sick-${name}:${due.dueAt}:urgent`);
    else if (near(due.dueAt)) keys.push(`sick-${name}:${due.dueAt}`);
  }
  return keys;
}

/** The strip is open unless collapsed, and a collapsed strip reopens for any key it hasn't seen. */
export function remindersOpen(acknowledged: string[] | null, attention: string[]): boolean {
  return acknowledged === null || attention.some((key) => !acknowledged.includes(key));
}
