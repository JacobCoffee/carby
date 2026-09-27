import { test } from "bun:test";
import assert from "node:assert/strict";
import { planSchema } from "../lib/care.ts";
import { firstFlaggedStep, issueFlag, planSummary, setupSteps } from "../lib/setup-steps.ts";

const stepIndex = (id) => setupSteps.findIndex((step) => step.id === id);
const stepOfIssue = (path) => firstFlaggedStep([issueFlag(path)]);

const plan = planSchema.parse({
  target: 120,
  factor: 50,
  ratio: 15,
  correctionHours: 3,
  increment: 0.5,
  rounding: "down",
  basal: 0,
  basalTime: "",
  timezone: "America/Chicago",
  note: "",
  lowThreshold: 70,
  ketoneCheckAbove: 250,
  patternRule: { highDays: 3, lowDays: 2 },
});

test("a failed plan check lands on the step that shows the field", () => {
  assert.equal(stepOfIssue(["target"]), stepIndex("math"));
  assert.equal(stepOfIssue(["mealRatios", "lunch"]), stepIndex("math"));
  assert.equal(stepOfIssue(["glucoseRanges"]), stepIndex("ranges"));
  assert.equal(stepOfIssue(["patternRule", "highDays"]), stepIndex("safety"));
  assert.equal(stepOfIssue(["basalTime"]), stepIndex("schedule"));
  assert.equal(stepOfIssue(["otherContacts", 1, "phone"]), stepIndex("contacts"));
  assert.equal(stepOfIssue(["emergencyInstructions", "lowGlucose"]), stepIndex("instructions"));
  assert.equal(stepOfIssue(["note"]), stepIndex("instructions"));
  // Flags keep the per-field keys the form marks inputs with.
  assert.equal(issueFlag(["contacts", "careTeamPhone"]), "contacts.careTeamPhone");
  assert.equal(issueFlag(["otherContacts", 1, "phone"]), "otherContacts.1.phone");
  assert.equal(issueFlag(["patternRule", "highDays"]), "patternRule");
});

test("a saved plan that needs fixing resumes at its earliest flagged step", () => {
  assert.equal(
    firstFlaggedStep(["emergencyInstructions.lowGlucose", "timezone", "lowThreshold"]),
    stepIndex("safety"),
  );
  assert.equal(firstFlaggedStep(["temperatureUnit"]), null);
  assert.equal(firstFlaggedStep([]), null);
});

test("the review restates only what was entered", () => {
  const groups = planSummary(plan);
  assert.deepEqual(
    groups.map(({ step }) => setupSteps[step].id),
    ["math", "ranges", "safety", "schedule", "contacts", "instructions"],
  );
  const rows = Object.fromEntries(
    groups.flatMap((group) => group.rows).map((r) => [r.label, r.value]),
  );
  assert.equal(rows["Glucose target"], "120 mg/dL");
  assert.equal(rows["Correction review interval"], "3 hours");
  assert.equal(rows["Dose increments"], "0.5 units");
  assert.equal(rows["Long-acting insulin"], "No scheduled reminder");
  assert.equal(
    rows["Ranges"],
    "Standard: very low below 54, low below 70, high above 180, very high above 250 mg/dL",
  );
  assert.equal(rows["Correction call check"], "Not set");
  assert.equal(rows["Rescue medication"], "Not set");
  // Blank optional steps list nothing rather than invented placeholders.
  assert.deepEqual(groups.at(-2).rows, []);
  assert.deepEqual(groups.at(-1).rows, []);

  const scheduled = planSummary({
    ...plan,
    basal: 12,
    basalTime: "21:30",
    overnightCheck: { time: "02:00", until: "2026-10-04" },
    contacts: { careTeamPhone: "555 0100" },
  }).flatMap((group) => group.rows);
  const find = (label) => scheduled.find((row) => row.label === label)?.value;
  assert.equal(find("Long-acting insulin"), "12 units at 9:30 PM");
  assert.equal(find("Overnight check"), "2:00 AM nightly, last check Mon, Oct 5 at 2:00 AM");
  assert.equal(find("Care team phone"), "555 0100");
});
