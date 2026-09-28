import { temperatureUnitLabels, type Plan } from "./care";
import { formatFactor, formatGlucose, glucoseUnitOf, type GlucoseUnit } from "./glucose-units";
import { planSummary, setupSteps, stepOfFlag, type SummaryRow } from "./setup-steps";

/** The care plan page's sections: the setup steps that hold plan settings, in the same order. */
export const planSections = setupSteps.flatMap((step) =>
  step.id === "start" || step.id === "review" ? [] : [step],
);
export type PlanSectionId = (typeof planSections)[number]["id"];

const NOT_SET = "Not set";

export function isPlanSection(value: string): value is PlanSectionId {
  return planSections.some(({ id }) => id === value);
}

/** The section that edits a form flag. Setup never asks for the temperature unit; here it sits with the time zone. */
export function sectionOfFlag(flag: string): PlanSectionId | null {
  return flag.split(".")[0] === "temperatureUnit" ? "schedule" : stepOfFlag(flag);
}

/**
 * Every value the plan holds, restated per section: the setup review rows plus the temperature
 * unit. Glucose values read in `unit`, the plan's own unless another is given.
 */
export function planSectionRows(
  plan: Plan,
  unit: GlucoseUnit = glucoseUnitOf(plan),
): Record<PlanSectionId, SummaryRow[]> {
  const rows = Object.fromEntries(
    planSummary(plan, unit).map(({ step, rows }) => [setupSteps[step].id, rows]),
  ) as Record<PlanSectionId, SummaryRow[]>;
  rows.schedule = [
    ...rows.schedule,
    {
      label: "Temperature unit",
      value: plan.temperatureUnit ? temperatureUnitLabels[plan.temperatureUnit] : NOT_SET,
    },
  ];
  return rows;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** One line under each section's name in the page's index. It restates saved values only. */
export function sectionHint(plan: Plan, id: PlanSectionId): string {
  const rows = planSectionRows(plan)[id];
  const unit = glucoseUnitOf(plan);
  switch (id) {
    case "math":
      return `Target ${formatGlucose(plan.target, unit)} · factor ${formatFactor(plan.factor, unit)} · every ${plural(plan.correctionHours, "hour")}`;
    case "ranges":
      return plan.glucoseRanges ? "Care team ranges" : "Standard ranges";
    case "safety": {
      // The first four rows are the required values; the rest are optional settings.
      const on = rows.slice(4).filter((row) => row.value !== NOT_SET).length;
      return `Low below ${formatGlucose(plan.lowThreshold, unit)} · ${on} of ${rows.length - 4} optional on`;
    }
    case "schedule":
      return `${rows[0].value} · ${plan.timezone.replaceAll("_", " ")}`;
    case "contacts":
      return rows.length ? plural(rows.length, "contact") : "None added";
    case "instructions":
      return rows.length ? plural(rows.length, "entry", "entries") : "None added";
  }
}

export type PlanChange = { label: string; before: string; after: string };
export type PlanSectionChanges = { id: PlanSectionId; title: string; changes: PlanChange[] };

/** Rows keyed by label and occurrence, so two contacts with the same role stay distinct. */
function keyed(rows: SummaryRow[]) {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const n = seen.get(row.label) ?? 0;
    seen.set(row.label, n + 1);
    return { key: `${row.label}\u0000${n}`, ...row };
  });
}

/**
 * Every restated value that differs between two plans, by section, in page order. A value only
 * one plan has (an added or removed contact or instruction) reads "Not set" on the other side.
 * Both plans read in the new plan's glucose unit, so changing the unit lists only the unit.
 */
export function planChanges(before: Plan, after: Plan): PlanSectionChanges[] {
  const was = planSectionRows(before, glucoseUnitOf(after));
  const now = planSectionRows(after);
  return planSections.flatMap(({ id, title }) => {
    const old = new Map(keyed(was[id]).map((row) => [row.key, row]));
    const changes: PlanChange[] = [];
    for (const row of keyed(now[id])) {
      const prior = old.get(row.key);
      old.delete(row.key);
      if (prior?.value !== row.value)
        changes.push({ label: row.label, before: prior?.value ?? NOT_SET, after: row.value });
    }
    for (const row of old.values())
      changes.push({ label: row.label, before: row.value, after: NOT_SET });
    return changes.length ? [{ id, title, changes }] : [];
  });
}
