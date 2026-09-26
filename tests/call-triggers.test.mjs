import { test } from "bun:test";
import assert from "node:assert/strict";
import { callTriggers } from "../lib/call-triggers.ts";

const plan = { correctionCallCheck: { above: 250, hours: 2 } };
const at = (iso) => iso;
const correction = (iso, purpose = "Correction only") => ({
  kind: "insulin",
  insulin: "Rapid-acting",
  purpose,
  units: 3,
  at: at(iso),
});
const finger = (iso, glucose, status = null) => ({
  kind: "glucose",
  source: "Finger-stick",
  glucose,
  status,
  at: at(iso),
});
const share = (iso, value, status = null) => ({
  at: at(iso),
  value,
  status,
  source: "Dexcom Share",
});
const rescueEntry = (iso, medication = "Baqsimi") => ({ kind: "rescue", medication, at: at(iso) });
const now = Date.parse("2027-01-16T12:00:00Z");

test("above-after-correction fires only once the plan's hours have elapsed above the plan's threshold", () => {
  const dose = correction("2027-01-16T09:00:00Z"); // 3h before now
  const tooSoon = callTriggers({
    entries: [dose, finger("2027-01-16T11:55:00Z", 300)],
    cgm: [],
    plan: { correctionCallCheck: { above: 250, hours: 4 } },
    now,
  });
  assert.equal(
    tooSoon.find((t) => t.kind === "above-after-correction"),
    undefined,
  );
  const enoughTime = callTriggers({
    entries: [dose, finger("2027-01-16T11:55:00Z", 300)],
    cgm: [],
    plan,
    now,
  });
  const trigger = enoughTime.find((t) => t.kind === "above-after-correction");
  assert.ok(trigger);
  assert.equal(trigger.above, 250);
  assert.equal(trigger.correctionAt, dose.at);
});

test("a current reading at or below the plan's threshold never triggers, and a stale reading is ignored", () => {
  const dose = correction("2027-01-16T09:00:00Z");
  const atThreshold = callTriggers({
    entries: [dose, finger("2027-01-16T11:55:00Z", 250)],
    cgm: [],
    plan,
    now,
  });
  assert.equal(
    atThreshold.find((t) => t.kind === "above-after-correction"),
    undefined,
  );
  const stale = callTriggers({
    entries: [dose, finger("2027-01-16T11:30:00Z", 300)],
    cgm: [],
    plan,
    now,
  });
  assert.equal(
    stale.find((t) => t.kind === "above-after-correction"),
    undefined,
  );
});

test("a meal-only dose never counts as the last correction", () => {
  const mealDose = correction("2027-01-16T09:00:00Z", "Meal only");
  const result = callTriggers({
    entries: [mealDose, finger("2027-01-16T11:55:00Z", 300)],
    cgm: [],
    plan,
    now,
  });
  assert.equal(
    result.find((t) => t.kind === "above-after-correction"),
    undefined,
  );
});

test("correctionCallCheck absent from the plan disables the trigger entirely", () => {
  const dose = correction("2027-01-16T09:00:00Z");
  const result = callTriggers({
    entries: [dose, finger("2027-01-16T11:55:00Z", 300)],
    cgm: [],
    plan: {},
    now,
  });
  assert.equal(
    result.find((t) => t.kind === "above-after-correction"),
    undefined,
  );
});

test("a share HI reading counts as above the plan's threshold without a numeric value", () => {
  const dose = correction("2027-01-16T09:00:00Z");
  const result = callTriggers({
    entries: [dose],
    cgm: [share("2027-01-16T11:55:00Z", null, "High")],
    plan,
    now,
  });
  assert.ok(result.find((t) => t.kind === "above-after-correction"));
});

test("Moderate or Large ketones in the last 12 hours trigger; Small or Trace never do", () => {
  const moderate = callTriggers({
    entries: [{ kind: "glucose", ketones: "Moderate", at: "2027-01-16T02:00:00Z" }],
    cgm: [],
    plan: {},
    now,
  });
  assert.deepEqual(
    moderate.find((t) => t.kind === "ketones"),
    { kind: "ketones", at: "2027-01-16T02:00:00Z", level: "Moderate" },
  );
  const tooOld = callTriggers({
    entries: [{ kind: "glucose", ketones: "Large", at: "2027-01-15T23:00:00Z" }],
    cgm: [],
    plan: {},
    now,
  });
  assert.equal(
    tooOld.find((t) => t.kind === "ketones"),
    undefined,
  );
  const small = callTriggers({
    entries: [{ kind: "glucose", ketones: "Small", at: "2027-01-16T11:00:00Z" }],
    cgm: [],
    plan: {},
    now,
  });
  assert.equal(
    small.find((t) => t.kind === "ketones"),
    undefined,
  );
});

test("a rescue entry in the last 24 hours triggers; older ones do not", () => {
  const recent = callTriggers({
    entries: [rescueEntry("2027-01-15T13:00:00Z")],
    cgm: [],
    plan: {},
    now,
  });
  assert.deepEqual(
    recent.find((t) => t.kind === "rescue"),
    {
      kind: "rescue",
      at: "2027-01-15T13:00:00Z",
      medication: "Baqsimi",
    },
  );
  const older = callTriggers({
    entries: [rescueEntry("2027-01-15T11:00:00Z")],
    cgm: [],
    plan: {},
    now,
  });
  assert.equal(
    older.find((t) => t.kind === "rescue"),
    undefined,
  );
});
