"use client";
import { useSyncExternalStore } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Droplet,
  Moon,
  Thermometer,
} from "lucide-react";
import { CORRECTION_REVIEW_WINDOW_MINUTES, type CorrectionReview } from "@/lib/correction-review";
import type { NightlyReminder } from "@/lib/nightly-reminder";
import type { OvernightCheck } from "@/lib/overnight-check";
import type { LowRecheck } from "@/lib/low-treatment";
import type { SickDayStatus } from "@/lib/sick-day";
import { illnessLabel } from "@/lib/illness";
import { meterStatusLabel, type Plan } from "@/lib/care";
import { reminderAttention, remindersOpen } from "@/lib/reminder-attention";
import "./care-header-reminders.css";

// Collapsing is a device UI preference, like the theme: the reminder keys acknowledged when the
// strip was collapsed, kept in localStorage. Absent means expanded.
const COLLAPSED_KEY = "carby-reminders-collapsed";
const collapseListeners = new Set<() => void>();
function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    collapseListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY);
  } catch {
    return null;
  }
}
function writeCollapsed(acknowledged: string[] | null) {
  try {
    if (acknowledged) window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(acknowledged));
    else window.localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Storage unavailable (private mode): the strip simply stays expanded.
  }
  for (const listener of collapseListeners) listener();
}
function parseCollapsed(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((key) => typeof key === "string") ? value : null;
  } catch {
    return null;
  }
}

function reminderFormat(timezone: string, now: number) {
  const time = (at: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(at));
  const date = (at: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
    }).format(new Date(at));
  // "in 1h 47m" until a future time ("in 0m" once passed), joined with no-break spaces so a
  // narrow chip wraps before the countdown rather than inside it.
  const until = (at: string) => {
    const minutes = Math.max(0, Math.ceil((Date.parse(at) - now) / 60000));
    return `in\u00a0${
      minutes >= 60
        ? `${Math.floor(minutes / 60)}h${minutes % 60 ? `\u00a0${minutes % 60}m` : ""}`
        : `${minutes}m`
    }`;
  };
  return { time, date, until };
}

/** Full-width strip above the header while the overnight check is close, due or missed. */
export function OvernightBanner({
  check,
  now,
  timezone,
  stale,
  onLog,
}: {
  check: OvernightCheck;
  now: number;
  timezone: string;
  stale: boolean;
  onLog: () => void;
}) {
  const { time, date, until } = reminderFormat(timezone, now);
  return (
    <div
      className={`overnight-banner is-${check.state}`}
      role={check.state === "missed" ? "alert" : "status"}
    >
      {check.state === "missed" ? (
        <AlertTriangle size={19} aria-hidden="true" />
      ) : (
        <Moon size={19} aria-hidden="true" />
      )}
      <p className="overnight-banner-copy">
        <strong>
          {check.state === "missed"
            ? "Overnight check missed"
            : check.state === "due"
              ? "Overnight check due now"
              : `Overnight check at ${time(check.at)} · ${until(check.at)}`}
        </strong>
        <span>
          {check.state === "upcoming"
            ? date(check.at)
            : `Scheduled ${date(check.at)}, ${time(check.at)}`}
          {check.reason === "severe-low" ? " · after a rescue dose" : ""}
          {stale ? " · Last loaded log" : ""}
        </span>
      </p>
      <button type="button" className="button subtle" onClick={onLog}>
        <Droplet size={17} aria-hidden="true" />
        Log glucose
      </button>
    </div>
  );
}

export default function CareHeaderReminders({
  correction,
  nightly,
  overnight,
  lowRecheck,
  sickDay,
  now,
  plan,
  loading,
  unavailable,
  stale,
  stillHigh,
  onCorrection,
  onNightly,
  onOvernight,
  onLowRecheck,
  onSickDay,
}: {
  correction: CorrectionReview | null;
  nightly: NightlyReminder | null;
  overnight: OvernightCheck | null;
  lowRecheck: LowRecheck | null;
  sickDay: SickDayStatus | null;
  now: number;
  plan: Plan;
  loading: boolean;
  unavailable: boolean;
  stale: boolean;
  /** Current above-range reading ("335 mg/dL" or "HIGH") once the review time has arrived. */
  stillHigh: string | null;
  onCorrection: () => void;
  onNightly: () => void;
  onOvernight: () => void;
  onLowRecheck: () => void;
  onSickDay: () => void;
}) {
  const { time, date, until } = reminderFormat(plan.timezone, now);
  const sickChecks = sickDay?.checks
    ? [
        { name: "Glucose", due: sickDay.checks.glucose },
        { name: "Ketone", due: sickDay.checks.ketones },
      ]
    : [];
  const sickOverdue = sickChecks.filter((check) => check.due.overdue);
  const sickNext = sickChecks.reduce<(typeof sickChecks)[number] | undefined>(
    (soonest, check) => (!soonest || check.due.dueAt < soonest.due.dueAt ? check : soonest),
    undefined,
  );
  const pending = loading || !Number.isFinite(now);
  const escalated = !pending && !unavailable && !!correction && !!stillHigh;
  const attention =
    pending || unavailable
      ? []
      : reminderAttention({
          correction,
          stillHigh: escalated,
          nightly,
          overnight,
          lowRecheck,
          sickDay,
          now,
        });
  const acknowledged = parseCollapsed(
    useSyncExternalStore(subscribeCollapsed, readCollapsed, () => null),
  );
  const open = remindersOpen(acknowledged, attention);
  return (
    <div
      className={`care-header-reminders${open ? "" : " is-collapsed"}`}
      role="group"
      aria-label="Current care reminders"
    >
      <button
        type="button"
        className={`care-header-reminder correction-reminder${escalated ? " is-escalated" : ""}`}
        disabled={pending || unavailable}
        onClick={onCorrection}
        title={correction?.notice}
      >
        {escalated ? (
          <span className="care-reminder-alert-icon" aria-hidden="true">
            <AlertTriangle size={21} />
          </span>
        ) : (
          <Clock3 size={21} aria-hidden="true" />
        )}
        <span className="care-reminder-copy">
          <span className="care-reminder-label">
            {correction?.state === "upcoming" ? "Next correction review" : "Correction review"}
          </span>
          <strong>
            {unavailable
              ? "Log unavailable"
              : pending
                ? "Loading timing…"
                : !correction
                  ? "No correction logged"
                  : escalated
                    ? correction.state === "window"
                      ? `Still ${stillHigh} at review time`
                      : `Still ${stillHigh} after review time`
                    : correction.state === "upcoming"
                      ? `${time(correction.at)} · ${until(correction.at)}`
                      : correction.state === "window"
                        ? "Review window"
                        : "Review window passed"}
          </strong>
          <span className="care-reminder-detail">
            {escalated
              ? `Review time ${time(correction!.at)}. Recheck glucose and ketones, then follow your care plan · timing only`
              : correction
                ? correction.state === "upcoming"
                  ? `${date(correction.at)} · ${plan.correctionHours} hours after last correction`
                  : correction.state === "window"
                    ? `${date(correction.at)}, ${time(correction.at)} · ±${CORRECTION_REVIEW_WINDOW_MINUTES} min · timing only`
                    : `${date(correction.at)}, ${time(correction.at)} · window ended`
                : "Based on the last logged correction"}
            {stale ? " · Last loaded log" : ""}
          </span>
        </span>
        <ArrowUpRight className="care-reminder-arrow" size={16} aria-hidden="true" />
      </button>
      {!pending && !unavailable && nightly?.visible && (
        <button
          type="button"
          className={`care-header-reminder nightly-reminder is-${nightly.state}`}
          onClick={onNightly}
        >
          {nightly.state === "logged" ? (
            <Check size={21} aria-hidden="true" />
          ) : (
            <Moon size={21} aria-hidden="true" />
          )}
          <span className="care-reminder-copy">
            <span className="care-reminder-label">Long-acting reminder</span>
            <strong>
              {nightly.state === "logged"
                ? "Logged"
                : nightly.state === "unlogged"
                  ? "Not logged"
                  : nightly.state === "due"
                    ? "Scheduled time reached"
                    : `${time(nightly.at)} · ${until(nightly.at)}`}
            </strong>
            <span className="care-reminder-detail">
              {nightly.state === "logged"
                ? `${nightly.logged[0].units} units logged · ${date(nightly.logged[0].at)}, ${time(nightly.logged[0].at)}`
                : `${date(nightly.at)}${nightly.state === "upcoming" ? "" : `, ${time(nightly.at)}`} · ${plan.basal} units prescribed`}
              {stale ? " · Last loaded log" : ""}
            </span>
          </span>
          <ArrowUpRight className="care-reminder-arrow" size={16} aria-hidden="true" />
        </button>
      )}
      {!pending && !unavailable && overnight && (
        <button
          type="button"
          className={`care-header-reminder overnight-reminder is-${overnight.state}`}
          onClick={onOvernight}
        >
          {overnight.state === "logged" ? (
            <Check size={21} aria-hidden="true" />
          ) : (
            <Moon size={21} aria-hidden="true" />
          )}
          <span className="care-reminder-copy">
            <span className="care-reminder-label">Overnight check</span>
            <strong>
              {overnight.state === "logged"
                ? "Logged"
                : overnight.state === "missed"
                  ? "Missed"
                  : overnight.state === "due"
                    ? "Check due now"
                    : `${time(overnight.at)} · ${until(overnight.at)}`}
            </strong>
            <span className="care-reminder-detail">
              {date(overnight.at)}
              {overnight.state === "upcoming" ? "" : `, ${time(overnight.at)}`}
              {overnight.reason === "severe-low" ? " · after a rescue dose" : ""}
              {stale ? " · Last loaded log" : ""}
            </span>
          </span>
          <ArrowUpRight className="care-reminder-arrow" size={16} aria-hidden="true" />
        </button>
      )}
      {!pending && !unavailable && lowRecheck && (
        <button
          type="button"
          className={`care-header-reminder low-recheck-reminder is-${lowRecheck.state}`}
          onClick={onLowRecheck}
          role={lowRecheck.state === "still-low" ? "alert" : undefined}
        >
          {lowRecheck.state === "recovered" ? (
            <Check size={21} aria-hidden="true" />
          ) : lowRecheck.state === "still-low" ? (
            <AlertTriangle size={21} aria-hidden="true" />
          ) : (
            <Droplet size={21} aria-hidden="true" />
          )}
          <span className="care-reminder-copy">
            <span className="care-reminder-label">
              Low recheck · treated {time(lowRecheck.treatedAt)}
            </span>
            <strong>
              {lowRecheck.state === "recovered"
                ? "No longer low at recheck"
                : lowRecheck.state === "still-low"
                  ? "Still low at recheck"
                  : lowRecheck.state === "due"
                    ? "Recheck due"
                    : `Recheck in ${Math.max(1, Math.ceil((Date.parse(lowRecheck.dueAt) - now) / 60000))} min`}
            </strong>
            <span className="care-reminder-detail">
              {lowRecheck.reading
                ? `${lowRecheck.reading.status ? meterStatusLabel(lowRecheck.reading.status) : `${lowRecheck.reading.value} mg/dL`} at ${time(lowRecheck.reading.at)}`
                : `Due ${time(lowRecheck.dueAt)}`}
              {stale ? " · Last loaded log" : ""}
            </span>
          </span>
          <ArrowUpRight className="care-reminder-arrow" size={16} aria-hidden="true" />
        </button>
      )}
      {!pending && !unavailable && sickDay && (
        <button
          type="button"
          className={`care-header-reminder sick-day-reminder${sickOverdue.length ? " is-overdue" : ""}`}
          onClick={onSickDay}
          title={sickDay.illness.note}
          role={sickOverdue.length ? "alert" : undefined}
        >
          {sickOverdue.length ? (
            <AlertTriangle size={21} aria-hidden="true" />
          ) : (
            <Thermometer size={21} aria-hidden="true" />
          )}
          <span className="care-reminder-copy">
            <span className="care-reminder-label">Sick day</span>
            <strong>
              {sickOverdue.length
                ? sickOverdue.length > 1
                  ? "Glucose & ketone checks overdue"
                  : `${sickOverdue[0].name} check overdue`
                : sickNext
                  ? `${sickNext.name} check ${time(sickNext.due.dueAt)} · ${until(sickNext.due.dueAt)}`
                  : "Illness period open"}
            </strong>
            <span className="care-reminder-detail">
              {illnessLabel(sickDay.illness, plan.timezone)}
              {stale ? " · Last loaded log" : ""}
            </span>
          </span>
          <ArrowUpRight className="care-reminder-arrow" size={16} aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="button subtle care-reminders-toggle"
        aria-expanded={open}
        aria-label={open ? "Collapse reminders" : "Expand reminders"}
        title={
          open
            ? "Collapse reminders. They reopen within 30 minutes of a reminder's time."
            : "Expand reminders"
        }
        onClick={() => writeCollapsed(open ? attention : null)}
      >
        {open ? (
          <ChevronUp size={17} aria-hidden="true" />
        ) : (
          <ChevronDown size={17} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
