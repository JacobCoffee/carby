import { careContactLinks, careContactLines, telHref, type Plan } from "./care";

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
const telLink = (link: { href: string; number: string }) =>
  `<a href="${escapeHtml(link.href)}">${escapeHtml(link.number)}</a>`;
/** Saved care-plan text as escaped plain text; the stylesheet keeps its line breaks. */
const instructionBlock = (text: string) =>
  `<p class="care-plan-instructions">${escapeHtml(text)}</p>`;

/**
 * The emergency steps and care contacts of the shareable handoff. The urgent-call guidance always
 * comes first; saved instructions replace only the generic guidance for their own section.
 */
export function handoffEmergencyHtml(
  plan: Pick<Plan, "contacts" | "emergencyInstructions" | "otherContacts">,
) {
  const instructions = plan.emergencyInstructions ?? {};
  const [emergencyLink] = careContactLinks(plan.contacts, ["emergencyPhone"]);
  const contactLines = careContactLines(plan.contacts);
  const urgent = `<p><strong>If unconscious, having a seizure, or unable to swallow safely, call ${emergencyLink ? `the emergency number ${telLink(emergencyLink)}` : "the local emergency number"} immediately.</strong> Give nothing by mouth if swallowing is unsafe. Do not give insulin to treat a low.</p>`;
  const low = instructions.lowGlucose
    ? instructionBlock(instructions.lowGlucose)
    : "<p>Follow the current clinician-provided treatment and recheck instructions.</p>";
  const severe = instructions.severeLow
    ? instructionBlock(instructions.severeLow)
    : "<p>Use prescribed rescue medication according to its instructions.</p>";
  const highGlucose = instructions.highGlucose
    ? instructionBlock(instructions.highGlucose)
    : "<p>Follow the clinician’s high-glucose treatment instructions.</p>";
  const sick = instructions.sickDay
    ? instructionBlock(instructions.sickDay)
    : "<p>Follow the clinician’s sick-day and ketone instructions.</p>";
  const whenToCall = instructions.whenToCall
    ? `<h3>When to call the care team</h3>${instructionBlock(instructions.whenToCall)}`
    : "";
  const otherContactItems = (plan.otherContacts ?? []).map((contact) => {
    const link = contact.phone ? telHref(contact.phone) : null;
    return `<li><b>${escapeHtml(contact.role)}</b>${contact.name ? ` · ${escapeHtml(contact.name)}` : ""}${link ? `: ${telLink({ href: link, number: contact.phone! })}` : ""}${contact.hours ? ` · ${escapeHtml(contact.hours)}` : ""}</li>`;
  });
  const contacts =
    contactLines.length || otherContactItems.length
      ? `<h2>Care contacts</h2><ul>${contactLines
          .map(
            (line) =>
              `<li><b>${escapeHtml(line.title)}</b>${line.phone ? `: ${telLink(line.phone)}` : ""}${line.availability ? ` · ${escapeHtml(line.availability)}` : ""}</li>`,
          )
          .join("")}${otherContactItems.join("")}</ul>`
      : "";
  return `<h2>Low / emergency</h2>${urgent}<h3>Low glucose and able to swallow</h3>${low}<h3>Seizure, unconscious, or cannot swallow safely</h3>${severe}<h3>High glucose</h3>${highGlucose}<h3>Illness, ketones &amp; questions</h3>${sick}<p>Vomiting, confusion, or difficulty breathing need urgent medical attention.</p>${whenToCall}${contacts}`;
}
