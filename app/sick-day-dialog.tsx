"use client";
import { ClipboardPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { careContactLines, careContactLinks, type Plan } from "@/lib/care";
import { illnessLabel, type IllnessCheckIn } from "@/lib/illness";
import type { SickDayStatus } from "@/lib/sick-day";
import { CarePlanInstructions } from "./emergency-instructions";
import { CheckInList } from "./illness-check-in-dialog";
import "./clinic-features.css";

function readable(at: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

/** Sick-day check timing plus the plan's illness instructions and contacts, opened from the
 * sick-day header reminder. Renders nothing outside a sick period (status null). */
export default function SickDayDialog({
  status,
  plan,
  open,
  onOpenChange,
  onLogGlucose,
  onLogKetones,
  onCheckIn,
}: {
  status: SickDayStatus | null;
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogGlucose: () => void;
  onLogKetones: () => void;
  /** Open the check-in editor for this illness (null = new check-in). */
  onCheckIn: (illnessId: string, checkIn: IllnessCheckIn | null) => void;
}) {
  if (!status) return null;
  const contactLines = careContactLines(plan.contacts);
  const [emergencyLink] = careContactLinks(plan.contacts, ["emergencyPhone"]);
  const rows = status.checks
    ? ([
        { key: "glucose", label: "Glucose check", due: status.checks.glucose, onLog: onLogGlucose },
        { key: "ketones", label: "Ketone check", due: status.checks.ketones, onLog: onLogKetones },
      ] as const)
    : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="care-dialog sick-day-dialog">
        <DialogHeader>
          <DialogTitle>Sick-day checks</DialogTitle>
          <DialogDescription>
            {illnessLabel(status.illness, plan.timezone)}
            {status.illness.note ? ` · ${status.illness.note}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="sick-day-body">
          {rows.length > 0 ? (
            <div className="sick-day-checks">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className={`sick-day-check${row.due.overdue ? " is-overdue" : ""}`}
                >
                  <div>
                    <strong>{row.label}</strong>
                    {row.due.overdue && (
                      <span className="sick-day-overdue-badge">
                        {row.due.lastAt ? "Overdue" : "Check now"}
                      </span>
                    )}
                    <span className="care-reminder-detail">
                      {row.due.lastAt
                        ? `Last logged ${readable(row.due.lastAt, plan.timezone)} · Due ${readable(row.due.dueAt, plan.timezone)}`
                        : row.due.overdue
                          ? "Not logged since this illness started"
                          : `Not logged yet · Due ${readable(row.due.dueAt, plan.timezone)}`}
                    </span>
                  </div>
                  <button type="button" className="button outline" onClick={row.onLog}>
                    Log {row.label.toLowerCase()}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="helper">
              Turn on sick-day check reminders in care-plan settings to see check timing here.
            </p>
          )}
          <p className="notice">Check ketones above {plan.ketoneCheckAbove} mg/dL.</p>
          <section className="illness-check-ins" aria-label="Check-ins">
            <div>
              <h3>Check-ins</h3>
              <button
                type="button"
                className="button outline"
                onClick={() => onCheckIn(status.illness.id, null)}
              >
                <ClipboardPlus size={17} aria-hidden="true" />
                Log a check-in
              </button>
            </div>
            {status.illness.checkIns?.length ? (
              <CheckInList
                checkIns={status.illness.checkIns.slice(-3)}
                timezone={plan.timezone}
                unit={plan.temperatureUnit}
                onEdit={(checkIn) => onCheckIn(status.illness.id, checkIn)}
              />
            ) : (
              <p>No check-ins yet for this illness.</p>
            )}
          </section>
          {plan.emergencyInstructions?.sickDay && (
            <CarePlanInstructions text={plan.emergencyInstructions.sickDay} />
          )}
          {contactLines.length > 0 && (
            <ul className="call-notices-contacts">
              {contactLines.map((contact) => (
                <li key={contact.key}>
                  <strong>{contact.title}</strong>
                  {contact.phone && <a href={contact.phone.href}>{contact.phone.number}</a>}
                  {contact.availability && <span> · {contact.availability}</span>}
                </li>
              ))}
            </ul>
          )}
          {emergencyLink && (
            <a className="button outline full" href={emergencyLink.href}>
              Call {emergencyLink.label}: {emergencyLink.number}
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
