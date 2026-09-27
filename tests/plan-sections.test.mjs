import { test } from "bun:test";
import assert from "node:assert/strict";
import { planSchema } from "../lib/care.ts";
import { planChanges, sectionHint, sectionOfFlag } from "../lib/plan-sections.ts";

const plan = planSchema.parse({
  target: 120,
  factor: 50,
  ratio: 15,
  correctionHours: 3,
  increment: 0.5,
  rounding: "down",
  basal: 7,
  basalTime: "21:00",
  timezone: "America/Chicago",
  note: "",
  lowThreshold: 70,
  ketoneCheckAbove: 250,
  patternRule: { highDays: 3, lowDays: 2 },
  otherContacts: [{ role: "Dietitian", name: "Ana" }],
});

test("an unchanged plan has no changes to review", () => {
  assert.deepEqual(planChanges(plan, { ...plan }), []);
});

test("a changed value shows before and after under its section", () => {
  assert.deepEqual(planChanges(plan, { ...plan, factor: 45 }), [
    {
      id: "math",
      title: "Glucose and meal math",
      changes: [
        { label: "Correction factor", before: "50 mg/dL per unit", after: "45 mg/dL per unit" },
      ],
    },
  ]);
});

test("added and removed entries read Not set on the side that lacks them", () => {
  const next = {
    ...plan,
    otherContacts: [{ role: "Pharmacist", phone: "555-0100" }],
    temperatureUnit: "C",
  };
  const byId = Object.fromEntries(planChanges(plan, next).map((s) => [s.id, s.changes]));
  assert.deepEqual(byId.contacts, [
    { label: "Pharmacist", before: "Not set", after: "555-0100" },
    { label: "Dietitian", before: "Ana", after: "Not set" },
  ]);
  // Setup never asks for the unit, but the plan page edits it with the time zone.
  assert.deepEqual(byId.schedule, [{ label: "Temperature unit", before: "Not set", after: "°C" }]);
});

test("two contacts with the same role are compared one to one", () => {
  const two = {
    ...plan,
    otherContacts: [
      { role: "Nurse", name: "A" },
      { role: "Nurse", name: "B" },
    ],
  };
  const edited = {
    ...two,
    otherContacts: [
      { role: "Nurse", name: "A" },
      { role: "Nurse", name: "C" },
    ],
  };
  assert.deepEqual(planChanges(two, edited)[0].changes, [
    { label: "Nurse", before: "B", after: "C" },
  ]);
});

test("the temperature unit's flag opens the schedule section", () => {
  assert.equal(sectionOfFlag("temperatureUnit"), "schedule");
  assert.equal(sectionOfFlag("mealRatios.lunch"), "math");
  assert.equal(sectionOfFlag("otherContacts.0.role"), "contacts");
});

test("index hints restate saved values and count optional settings that are on", () => {
  assert.equal(sectionHint(plan, "safety"), "Low below 70 · 0 of 10 optional on");
  assert.equal(
    sectionHint({ ...plan, rescueMedication: "Glucagon", usualChangePercent: 20 }, "safety"),
    "Low below 70 · 2 of 10 optional on",
  );
  assert.equal(sectionHint(plan, "schedule"), "7 units at 9:00 PM · America/Chicago");
  assert.equal(sectionHint(plan, "contacts"), "1 contact");
  assert.equal(sectionHint(plan, "instructions"), "None added");
});
