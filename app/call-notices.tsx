"use client";
import { PhoneCall } from "lucide-react";
import { careContactLines, careContactLinks, type Plan } from "@/lib/care";
import type { CallTrigger } from "@/lib/call-triggers";
import { glucoseUnitOf, glucoseWithUnit, type GlucoseUnit } from "@/lib/glucose-units";
import { CarePlanInstructions } from "./emergency-instructions";
import "./clinic-features.css";

function triggerText(trigger: CallTrigger, timezone: string, unit: GlucoseUnit) {
  const time = (at: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(at));
  if (trigger.kind === "above-after-correction")
    return `Still ${trigger.value !== null ? glucoseWithUnit(trigger.value, unit) : "HI"} at ${time(trigger.at)}, above ${glucoseWithUnit(trigger.above, unit)} and ${trigger.hours} h after the last correction at ${time(trigger.correctionAt)} with no correction since.`;
  if (trigger.kind === "ketones") return `Ketones ${trigger.level} logged at ${time(trigger.at)}.`;
  return `Severe low: ${trigger.medication} given at ${time(trigger.at)}.`;
}

/** Descriptive "call the care team" alerts: current correction-check, ketone, or rescue triggers,
 * plus the care-team / after-hours numbers and the plan's when-to-call instructions verbatim. */
export default function CallNotices({ triggers, plan }: { triggers: CallTrigger[]; plan: Plan }) {
  if (triggers.length === 0) return null;
  const contactLines = careContactLines(plan.contacts);
  const [emergencyLink] = careContactLinks(plan.contacts, ["emergencyPhone"]);
  return (
    <section className="call-notices" aria-label="Call the care team">
      <strong className="call-notices-title">Check when your care plan says to call</strong>
      <ul className="call-notice-list">
        {triggers.map((trigger, i) => (
          <li
            key={`${trigger.kind}-${trigger.at}-${i}`}
            className={`call-notice is-${trigger.kind}`}
            role="alert"
          >
            <PhoneCall size={18} aria-hidden="true" />
            <span>{triggerText(trigger, plan.timezone, glucoseUnitOf(plan))}</span>
          </li>
        ))}
      </ul>
      {!plan.emergencyInstructions?.whenToCall && contactLines.length === 0 && (
        <small>
          Add when-to-call instructions and care contacts in Care plan to show them here.
        </small>
      )}
      {plan.emergencyInstructions?.whenToCall && (
        <CarePlanInstructions text={plan.emergencyInstructions.whenToCall} />
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
    </section>
  );
}
