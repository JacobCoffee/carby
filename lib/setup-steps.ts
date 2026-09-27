import {
  STANDARD_GLUCOSE_RANGES,
  careContactKeys,
  careContactLabels,
  emergencyInstructionKeys,
  emergencyInstructionLabels,
  glucoseRangeKeys,
  glucoseRangeLabels,
  ratioSummary,
  type Plan,
  type PlanField,
} from "./care";
import { lastOvernightCheck } from "./overnight-check";

/** The care plan setup steps, in order. Optional steps can be left blank. */
export const setupSteps = [
  { id: "start", title: "Get started", optional: false },
  { id: "math", title: "Glucose and meal math", optional: false },
  { id: "ranges", title: "Glucose ranges for reports", optional: true },
  { id: "safety", title: "Plan safety settings", optional: false },
  { id: "schedule", title: "Long-acting insulin and time zone", optional: false },
  { id: "contacts", title: "Care contacts", optional: true },
  { id: "instructions", title: "Emergency instructions and notes", optional: true },
  { id: "review", title: "Review and save", optional: false },
] as const;
export type SetupStepId = (typeof setupSteps)[number]["id"];
type FieldStep = Exclude<SetupStepId, "start" | "review">;

/** The step that shows each plan setting. The temperature unit is set later, in the care plan. */
const fieldSteps: Record<PlanField, FieldStep | null> = {
  target: "math",
  factor: "math",
  ratio: "math",
  mealRatios: "math",
  correctionHours: "math",
  increment: "math",
  rounding: "math",
  glucoseRanges: "ranges",
  lowThreshold: "safety",
  ketoneCheckAbove: "safety",
  patternRule: "safety",
  correctionCallCheck: "safety",
  sickDayChecks: "safety",
  lowTreatment: "safety",
  overnightCheck: "safety",
  correctionQuietHours: "safety",
  snackInsulinFromCarbs: "safety",
  longActingReminderHours: "safety",
  rescueMedication: "safety",
  meter: "safety",
  basal: "schedule",
  basalTime: "schedule",
  timezone: "schedule",
  contacts: "contacts",
  otherContacts: "contacts",
  emergencyInstructions: "instructions",
  note: "instructions",
  temperatureUnit: null,
};

/**
 * The form flag for a failed plan check: the field name, or `group.key` for fields the form marks
 * one by one (meal ratios, contacts, instructions, other-contact rows).
 */
export function issueFlag(path: readonly PropertyKey[]): string {
  const [field, key, part] = path;
  if (field === "otherContacts" && typeof key === "number" && typeof part === "string")
    return `otherContacts.${key}.${part}`;
  if (
    (field === "mealRatios" || field === "contacts" || field === "emergencyInstructions") &&
    typeof key === "string"
  )
    return `${field}.${key}`;
  return String(field);
}

const isPlanField = (field: string): field is PlanField => Object.hasOwn(fieldSteps, field);

/** The step that shows a form flag or plan field, or null when setup doesn't ask for it. */
export function stepOfFlag(flag: string): FieldStep | null {
  const field = flag.split(".")[0];
  return isPlanField(field) ? fieldSteps[field] : null;
}

/** The index of the earliest step that shows any of these flags, or null when none does. */
export function firstFlaggedStep(flags: Iterable<string>): number | null {
  let first: number | null = null;
  for (const flag of flags) {
    const step = stepOfFlag(flag);
    if (!step) continue;
    const index = setupSteps.findIndex(({ id }) => id === step);
    if (first === null || index < first) first = index;
  }
  return first;
}

export type SummaryRow = { label: string; value: string };

const NOT_SET = "Not set";
const units = (value: number, one: string, many = `${one}s`) =>
  `${value} ${value === 1 ? one : many}`;
/** An HH:MM wall-clock time, such as 9:00 PM, the same in every zone. */
const clock = (time: string) =>
  new Date(`1970-01-01T${time}:00Z`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });

export type SummaryGroup = { step: number; title: string; rows: SummaryRow[] };

/**
 * Every value a plan holds, grouped by the setup step that asks for it, in step order, for the
 * review step. It restates what was entered and nothing else: unset optional settings read
 * "Not set", and blank contacts and instructions are left out.
 */
export function planSummary(plan: Plan): SummaryGroup[] {
  const ranges = plan.glucoseRanges;
  const { correctionCallCheck, sickDayChecks, lowTreatment, overnightCheck, meter } = plan;
  const quietHours = plan.correctionQuietHours;
  const groups: Record<FieldStep, SummaryRow[]> = {
    math: [
      { label: "Glucose target", value: `${plan.target} mg/dL` },
      { label: "Correction factor", value: `${plan.factor} mg/dL per unit` },
      { label: "Carbohydrate ratio", value: ratioSummary(plan) },
      { label: "Correction review interval", value: units(plan.correctionHours, "hour") },
      { label: "Dose increments", value: units(plan.increment, "unit") },
      {
        label: "Rounding rule",
        value: plan.rounding === "down" ? "Round down" : "Round to nearest",
      },
    ],
    ranges: ranges
      ? glucoseRangeKeys.map((key) => ({
          label: glucoseRangeLabels[key],
          value: `${ranges[key]} mg/dL`,
        }))
      : [
          {
            label: "Ranges",
            value: `Standard: ${glucoseRangeKeys
              .map(
                (key) => `${glucoseRangeLabels[key].toLowerCase()} ${STANDARD_GLUCOSE_RANGES[key]}`,
              )
              .join(", ")} mg/dL`,
          },
        ],
    safety: [
      { label: "Treat a low below", value: `${plan.lowThreshold} mg/dL` },
      { label: "Check ketones above", value: `${plan.ketoneCheckAbove} mg/dL` },
      { label: "High pattern", value: `${units(plan.patternRule.highDays, "day")} in a row` },
      { label: "Low pattern", value: `${units(plan.patternRule.lowDays, "day")} in a row` },
      {
        label: "Correction call check",
        value: correctionCallCheck
          ? `Above ${correctionCallCheck.above} mg/dL, ${units(correctionCallCheck.hours, "hour")} after a correction`
          : NOT_SET,
      },
      {
        label: "Sick-day checks",
        value: sickDayChecks
          ? `Glucose every ${units(sickDayChecks.glucoseHours, "hour")}, ketones every ${units(sickDayChecks.ketoneHours, "hour")}`
          : NOT_SET,
      },
      {
        label: "Low-treatment amount",
        value: lowTreatment
          ? `${lowTreatment.grams} g, recheck after ${units(lowTreatment.recheckMinutes, "minute")}`
          : NOT_SET,
      },
      {
        label: "Overnight check",
        value: overnightCheck
          ? `${clock(overnightCheck.time)} nightly, last check ${lastOvernightCheck(overnightCheck)}`
          : NOT_SET,
      },
      {
        label: "Overnight correction reviews",
        value: quietHours
          ? `Hidden ${clock(quietHours.start)} to ${clock(quietHours.end)}`
          : NOT_SET,
      },
      {
        label: "Snack insulin cutoff",
        value:
          plan.snackInsulinFromCarbs === undefined
            ? NOT_SET
            : `Under ${plan.snackInsulinFromCarbs} g of carbohydrate`,
      },
      {
        label: "Long-acting reminder",
        value:
          plan.longActingReminderHours === undefined
            ? NOT_SET
            : `Within ${plan.longActingReminderHours} hours of the scheduled time`,
      },
      { label: "Rescue medication", value: plan.rescueMedication ?? NOT_SET },
      {
        label: "Glucose meter",
        value: meter
          ? [meter.name, `HI above ${meter.hi}`, `LO below ${meter.lo}`].filter(Boolean).join(", ")
          : NOT_SET,
      },
    ],
    schedule: [
      {
        label: "Long-acting insulin",
        value:
          plan.basal === 0
            ? "No scheduled reminder"
            : `${units(plan.basal, "unit")} at ${clock(plan.basalTime)}`,
      },
      { label: "Time zone", value: plan.timezone },
    ],
    contacts: [
      ...careContactKeys.flatMap((key) => {
        const value = plan.contacts?.[key]?.trim();
        return value ? [{ label: careContactLabels[key], value }] : [];
      }),
      ...(plan.otherContacts ?? []).map(({ role, name, phone, hours }) => ({
        label: role,
        value: [name, phone, hours].filter(Boolean).join(", ") || NOT_SET,
      })),
    ],
    instructions: [
      ...emergencyInstructionKeys.flatMap((key) => {
        const value = plan.emergencyInstructions?.[key]?.trim();
        return value ? [{ label: emergencyInstructionLabels[key], value }] : [];
      }),
      ...(plan.note.trim() ? [{ label: "Care team notes", value: plan.note.trim() }] : []),
    ],
  };
  return setupSteps.flatMap(({ id, title }, step) =>
    id === "start" || id === "review" ? [] : [{ step, title, rows: groups[id] }],
  );
}
