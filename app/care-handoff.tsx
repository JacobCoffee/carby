"use client";
import { apiFetch } from "@/lib/person-request";
import {
  careContactLinks,
  careContactLines,
  dateKey,
  entryGlucoseLabel,
  ratioSummary,
} from "@/lib/care";
import { escapeHtml, handoffEmergencyHtml } from "@/lib/handoff";
import { illnessOverlap, illnessLabel, isSick, type IllnessWindow } from "@/lib/illness";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Entry, CgmReading, Plan } from "@/lib/care";
import { CarePlanInstructions } from "./emergency-instructions";

type Change = { entry_id: string; actor_name: string; action: string; at: string };
function readable(at: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}
export default function CareHandoff({
  open,
  onClose,
  entries,
  cgm,
  plan,
  patientName,
  illnesses = [],
}: {
  open: boolean;
  onClose: () => void;
  entries: Entry[];
  cgm: CgmReading[];
  plan: Plan;
  patientName?: string;
  illnesses?: IllnessWindow[];
}) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [auditError, setAuditError] = useState("");
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    void apiFetch("/api/audit?limit=30", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Change history is unavailable.");
        return response.json() as Promise<{ changes: Change[] }>;
      })
      .then((data) => {
        if (mounted) {
          setChanges(data.changes);
          setAuditError("");
        }
      })
      .catch(() => {
        if (mounted) setAuditError("Change history is unavailable.");
      });
    return () => {
      mounted = false;
    };
  }, [open]);
  const [generatedAt] = useState(() => new Date());
  const recent = useMemo(
    () =>
      entries
        .filter((e) => Date.parse(e.at) >= generatedAt.getTime() - 24 * 3600000)
        .sort((a, b) => b.at.localeCompare(a.at)),
    [entries, generatedAt],
  );
  const lastShare = useMemo(
    () =>
      cgm.filter((e) => e.source === "Dexcom Share").sort((a, b) => b.at.localeCompare(a.at))[0],
    [cgm],
  );
  const lastRapid = entries
    .filter((e) => e.kind === "insulin" && e.insulin === "Rapid-acting")
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const lastBasal = entries
    .filter((e) => e.kind === "insulin" && e.insulin === "Long-acting")
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const lastFinger = entries
    .filter((e) => e.kind === "glucose" && e.source === "Finger-stick")
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const contactLines = careContactLines(plan.contacts);
  const [emergencyLink] = careContactLinks(plan.contacts, ["emergencyPhone"]);
  const instructions = plan.emergencyInstructions ?? {};
  const activeIllness = illnesses.find(
    (illness) =>
      isSick(illness) &&
      illnessOverlap(
        illness,
        generatedAt.getTime() - 24 * 3600000,
        generatedAt.getTime(),
        generatedAt.getTime(),
      ),
  );
  const sickNote = activeIllness
    ? `Currently sick: ${illnessLabel(activeIllness, plan.timezone)}${activeIllness.note ? ` · ${activeIllness.note}` : ""} — glucose patterns may differ from usual.`
    : null;
  const renderEntry = (entry: Entry) => {
    const detail =
      entry.kind === "insulin"
        ? `${entry.insulin} ${entry.units} units actually given${entry.purpose ? ` · ${entry.purpose}` : ""}`
        : entry.kind === "food"
          ? `${entry.meal} · ${entry.carbs} g carbs${entry.lowSeverity ? ` · ${entry.lowSeverity} low` : ""}${entry.foodItems?.length ? ` · ${entry.foodItems.map((item) => `${item.name} (${item.amount} ${item.unit})`).join(", ")}` : ""}`
          : entry.kind === "glucose"
            ? `${entry.source} glucose ${entryGlucoseLabel(entry, plan.meter)}${entry.ketones && entry.ketones !== "Not checked" ? ` · ketones ${entry.ketones}` : ""}`
            : entry.kind === "exercise"
              ? `Exercise${entry.minutes ? ` · ${entry.minutes} min` : ""}${entry.intensity ? ` · ${entry.intensity}` : ""}`
              : `Rescue medication given${entry.medication ? ` · ${entry.medication}` : ""}`;
    return detail + (entry.note ? ` · ${entry.note}` : "");
  };
  const snapshot = `<h1>Carby · caregiver handoff${patientName ? ` for ${escapeHtml(patientName)}` : ""}</h1><p>Prepared ${escapeHtml(readable(generatedAt.toISOString(), plan.timezone))} · ${escapeHtml(plan.timezone)}. This is a snapshot; check the G7 app or receiver for current glucose and the current care plan before acting.</p>${sickNote ? `<p><b>${escapeHtml(sickNote)}</b></p>` : ""}<h2>What happened · past 24 hours</h2>${
    recent.length
      ? `<ul>${recent
          .slice(0, 30)
          .map(
            (e) =>
              `<li><b>${escapeHtml(readable(e.at, plan.timezone))}</b> — ${escapeHtml(renderEntry(e))}</li>`,
          )
          .join("")}</ul>`
      : "<p>No manually recorded actions in the past 24 hours.</p>"
  }<h2>What was given</h2><p>Last Rapid-acting: ${lastRapid ? escapeHtml(`${lastRapid.units} units at ${readable(lastRapid.at, plan.timezone)}`) : "none recorded"}. Last Long-acting: ${lastBasal ? escapeHtml(`${lastBasal.units} units at ${readable(lastBasal.at, plan.timezone)}`) : "none recorded"}.</p><h2>What needs checking</h2><ul><li>Current glucose on the G7 app or primary device. Last imported Share reading: ${lastShare ? escapeHtml(`${lastShare.status ? lastShare.status.toUpperCase() + " (exact value unknown)" : lastShare.value + " mg/dL"} at ${readable(lastShare.at, plan.timezone)}`) : "none"}.</li><li>Last recorded finger-stick: ${lastFinger ? escapeHtml(`${entryGlucoseLabel(lastFinger, plan.meter)} at ${readable(lastFinger.at, plan.timezone)}`) : "none"}.</li><li>Check the current clinician care plan and confirm recent insulin before any dose. A calculated dose is never a dose given.</li></ul>${handoffEmergencyHtml(plan)}<h2>Current saved plan · verify against clinician instructions</h2><p>Target ${plan.target} mg/dL · ${escapeHtml(ratioSummary(plan))} · correction factor ${plan.factor} mg/dL/unit · ${plan.basal > 0 ? `prescribed long-acting ${plan.basal} units at ${escapeHtml(plan.basalTime)} (${escapeHtml(plan.timezone)})` : "no long-acting reminder configured"}.</p><p>Plan note: ${escapeHtml(plan.note || "None recorded")}</p>`;
  function download() {
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Carby caregiver handoff</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#243249;max-width:760px;margin:auto;padding:20px}h1{color:#234ac7}h2{margin-top:28px;border-bottom:1px solid #dae3ee;padding-bottom:6px}h3{margin:18px 0 4px;font-size:17px}.care-plan-instructions{white-space:pre-wrap}li{margin:9px 0}p,li{overflow-wrap:anywhere}@media print{body{padding:0}}</style><main>${snapshot}</main></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `carby-handoff-${dateKey(new Date(), plan.timezone)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="care-dialog handoff-dialog">
        <DialogHeader>
          <DialogTitle>Caregiver handoff</DialogTitle>
          <DialogDescription>
            A phone-friendly snapshot. Download it to share with a caregiver who does not use Carby.
            They will receive only this saved copy, which does not update automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="handoff-actions">
          <button type="button" className="button primary" onClick={download}>
            Download shareable handoff
          </button>
          <button type="button" className="button outline" onClick={() => window.print()}>
            Print / save PDF
          </button>
        </div>
        <article className="handoff-sheet">
          <header>
            <strong>Carby · caregiver handoff{patientName ? ` for ${patientName}` : ""}</strong>
            <small>
              Prepared {readable(generatedAt.toISOString(), plan.timezone)} · {plan.timezone}
            </small>
          </header>
          <p>
            Use the primary G7 app or receiver for current glucose. Confirm the current clinician
            care plan before any treatment.
          </p>
          {sickNote && (
            <p className="handoff-sick">
              <strong>{sickNote}</strong>
            </p>
          )}
          <h3>What happened · past 24 hours</h3>
          {recent.length ? (
            <ol>
              {recent.slice(0, 30).map((entry) => (
                <li key={entry.id}>
                  <time>{readable(entry.at, plan.timezone)}</time>
                  <span>{renderEntry(entry)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>No manually recorded actions in the past 24 hours.</p>
          )}
          <h3>What was given</h3>
          <p>
            Last Rapid-acting:{" "}
            <strong>
              {lastRapid
                ? `${lastRapid.units} units · ${readable(lastRapid.at, plan.timezone)}`
                : "none recorded"}
            </strong>
            . Last Long-acting:{" "}
            <strong>
              {lastBasal
                ? `${lastBasal.units} units · ${readable(lastBasal.at, plan.timezone)}`
                : "none recorded"}
            </strong>
            .
          </p>
          <h3>What needs checking</h3>
          <ul>
            <li>
              Current glucose on primary device. Last imported Share point:{" "}
              {lastShare
                ? `${lastShare.status ? lastShare.status.toUpperCase() + " · exact value unknown" : lastShare.value + " mg/dL"} · ${readable(lastShare.at, plan.timezone)}`
                : "none"}
              .
            </li>
            <li>
              Last finger-stick:{" "}
              {lastFinger
                ? `${entryGlucoseLabel(lastFinger, plan.meter)} · ${readable(lastFinger.at, plan.timezone)}`
                : "none"}
              .
            </li>
            <li>
              Review recent insulin and the current plan before any dose. A calculation does not
              mean insulin was given.
            </li>
          </ul>
          <h3>Low / emergency</h3>
          <p>
            <strong>
              If unconscious, having a seizure, or unable to swallow safely, call{" "}
              {emergencyLink ? (
                <>
                  the emergency number <a href={emergencyLink.href}>{emergencyLink.number}</a>
                </>
              ) : (
                "the local emergency number"
              )}{" "}
              immediately.
            </strong>{" "}
            Give nothing by mouth if swallowing is unsafe. Do not give insulin to treat a low.
          </p>
          <h4>Low glucose and able to swallow</h4>
          {instructions.lowGlucose ? (
            <CarePlanInstructions text={instructions.lowGlucose} />
          ) : (
            <p>Follow the current clinician-provided treatment and recheck instructions.</p>
          )}
          <h4>Seizure, unconscious, or cannot swallow safely</h4>
          {instructions.severeLow ? (
            <CarePlanInstructions text={instructions.severeLow} />
          ) : (
            <p>Use prescribed rescue medication according to its instructions.</p>
          )}
          <h4>High glucose</h4>
          {instructions.highGlucose ? (
            <CarePlanInstructions text={instructions.highGlucose} />
          ) : (
            <p>Follow the clinician’s high-glucose treatment instructions.</p>
          )}
          <h4>Illness, ketones &amp; questions</h4>
          {instructions.sickDay ? (
            <CarePlanInstructions text={instructions.sickDay} />
          ) : (
            <p>Follow the clinician’s sick-day and ketone instructions.</p>
          )}
          <p>Vomiting, confusion, or difficulty breathing need urgent medical attention.</p>
          {instructions.whenToCall && (
            <>
              <h4>When to call the care team</h4>
              <CarePlanInstructions text={instructions.whenToCall} />
            </>
          )}
          {(contactLines.length > 0 || (plan.otherContacts?.length ?? 0) > 0) && (
            <>
              <h3>Care contacts</h3>
              <ul>
                {contactLines.map((line) => (
                  <li key={line.key}>
                    <strong>{line.title}</strong>
                    {line.phone && (
                      <>
                        : <a href={line.phone.href}>{line.phone.number}</a>
                      </>
                    )}
                    {line.availability && ` · ${line.availability}`}
                  </li>
                ))}
                {(plan.otherContacts ?? []).map((contact, i) => (
                  <li key={`other-${i}`}>
                    <strong>{contact.role}</strong>
                    {contact.name && ` · ${contact.name}`}
                    {contact.phone && ` · ${contact.phone}`}
                    {contact.hours && ` · ${contact.hours}`}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>Current saved plan · verify before use</h3>
          <p>
            Target {plan.target} mg/dL · {ratioSummary(plan)} · correction factor {plan.factor}{" "}
            mg/dL/unit ·{" "}
            {plan.basal > 0
              ? `Long-acting ${plan.basal} units at ${plan.basalTime} (${plan.timezone})`
              : "No long-acting reminder configured"}
            . {plan.note}
          </p>
        </article>
        <section className="handoff-audit">
          <h3>Recent record changes</h3>
          {auditError ? (
            <p>{auditError}</p>
          ) : changes.length ? (
            <ul>
              {changes.slice(0, 8).map((change) => (
                <li key={`${change.entry_id}-${change.at}`}>
                  {readable(change.at, plan.timezone)} · {change.actor_name} {change.action} an
                  entry
                </li>
              ))}
            </ul>
          ) : (
            <p>No change history is recorded yet.</p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
