import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  math,
  fromLocal,
  localInput,
  dateKey,
  planSchema,
  planDraft,
  entrySchema,
  calculationSchema,
  savedFoodSchema,
  getCarbRatio,
  telHref,
  careContactLinks,
  careContactLines,
  exactUnits,
  stepShortfall,
  glucoseRanges,
} from "../lib/care.ts";
import { handoffEmergencyHtml } from "../lib/handoff.ts";
import { summarizeCgm, uniqueCgm } from "../lib/cgm-metrics.ts";

const plan = {
  target: 140,
  factor: 80,
  ratio: 40,
  increment: 0.5,
  rounding: "down",
  basal: 6,
  basalTime: "20:00",
  timezone: "America/Chicago",
  correctionHours: 4,
  note: "Synthetic plan",
  lowThreshold: 70,
  ketoneCheckAbove: 180,
  patternRule: { highDays: 3, lowDays: 2 },
};
const planWithMealRatios = {
  ...plan,
  mealRatios: { breakfast: 40, lunch: 30, dinner: 30, snack: null },
};

test("glucose ranges are optional, ordered, and replaced by the standard set only when unset", () => {
  const custom = { veryLow: 60, low: 80, high: 200, veryHigh: 280 };
  assert.deepEqual(glucoseRanges(planSchema.parse({ ...plan, glucoseRanges: custom })), {
    ...custom,
    standard: false,
  });
  assert.deepEqual(glucoseRanges(planSchema.parse(plan)), {
    veryLow: 54,
    low: 70,
    high: 180,
    veryHigh: 250,
    standard: true,
  });
  assert.equal(
    planSchema.safeParse({ ...plan, glucoseRanges: { ...custom, high: 70 } }).success,
    false,
  );
  assert.equal(
    planSchema.safeParse({ ...plan, glucoseRanges: { veryLow: 54, low: 70 } }).success,
    false,
  );
  // A saved set that fails is flagged for re-entry, never partly kept or swapped for the standard.
  const draft = planDraft({ ...plan, glucoseRanges: { ...custom, low: 50 } });
  assert.equal(draft.values.glucoseRanges, undefined);
  assert.deepEqual(draft.invalid, ["glucoseRanges"]);
  assert.deepEqual(draft.missing, []);
});

test("correction uses the configured target and factor with half-unit floor", () => {
  assert.deepEqual(math(375, 0, plan, true), {
    food: 0,
    correction: 2.9375,
    raw: 2.9375,
    rounded: 2.5,
  });
});

test("exact units truncate so near-step math never displays as the next step", () => {
  assert.equal(exactUnits(2.4999), "2.49");
  assert.equal(exactUnits(2.9375), "2.93");
  assert.equal(exactUnits(0.1 + 0.2), "0.30");
  assert.equal(exactUnits(1.5), "1.50");
  assert.equal(exactUnits(0), "0.00");
});

test("step shortfall reports what rounding down left out", () => {
  assert.deepEqual(stepShortfall(2.4999, 2, plan), { next: 2.5, short: 0.01 });
  assert.deepEqual(stepShortfall(2.9375, 2.5, plan), { next: 3, short: 0.07 });
  assert.equal(stepShortfall(2.5, 2.5, plan), null);
  // Rounding to nearest can land above the exact math; nothing was left out.
  assert.equal(stepShortfall(2.3, 2.5, plan), null);
});
test("food-only never adds a high glucose correction", () => {
  assert.equal(math(447, 50, plan, false).rounded, 1);
});
test("round combined result once and clamp negative corrections", () => {
  assert.equal(math(375, 15, plan, true).rounded, 3);
  assert.equal(math(100, 50, plan, true).rounded, 1);
  assert.equal(math(null, 19.999, plan, false).rounded, 0);
  assert.equal(math(null, 20, plan, false).rounded, 0.5);
});
test("changed prescription is used in calculation", () => {
  assert.equal(math(220, 30, { ...plan, target: 120, factor: 50, ratio: 15 }, true).rounded, 4);
});
test("Central time crosses UTC midnight without changing local day", () => {
  assert.equal(fromLocal("2026-09-22T21:05", "America/Chicago"), "2026-09-23T02:05:00.000Z");
  assert.equal(dateKey(new Date("2026-09-23T02:05Z"), "America/Chicago"), "2026-09-22");
  assert.equal(localInput(new Date("2026-09-23T07:00Z"), "America/Chicago"), "2026-09-23T02:00");
});
test("reject nonexistent spring-forward wall time", () => {
  assert.throws(() => fromLocal("2026-03-08T02:30", "America/Chicago"));
});
test("reject invalid care plan and incomplete dose", () => {
  assert.equal(planSchema.safeParse({ ...plan, ratio: 0 }).success, false);
  assert.equal(planSchema.safeParse({ ...plan, factor: NaN }).success, false);
  assert.equal(
    entrySchema.safeParse({
      id: crypto.randomUUID(),
      kind: "insulin",
      at: "2026-09-22T22:00:00.000Z",
      glucose: null,
      source: null,
      ketones: null,
      carbs: null,
      units: null,
      insulin: "Rapid-acting",
      meal: null,
      note: "",
    }).success,
    false,
  );
});
test("plan requires an explicit correction interval; none is invented for a legacy plan missing it", () => {
  const { correctionHours, ...legacy } = plan;
  void correctionHours;
  assert.equal(planSchema.safeParse(legacy).success, false);
});
test("a plan missing the new required glucose, ketone or pattern settings lists them in the draft", () => {
  const { lowThreshold, ketoneCheckAbove, patternRule, ...incomplete } = plan;
  void lowThreshold;
  void ketoneCheckAbove;
  void patternRule;
  assert.equal(planSchema.safeParse(incomplete).success, false);
  const draft = planDraft(incomplete);
  assert.deepEqual(draft.missing.toSorted(), ["ketoneCheckAbove", "lowThreshold", "patternRule"]);
  assert.deepEqual(draft.invalid, []);
  assert.equal(planSchema.safeParse({ ...draft.values, ...plan }).success, true);
  assert.equal(
    planSchema.safeParse({ ...plan, patternRule: { highDays: 1, lowDays: 2 } }).success,
    false,
  );
  assert.equal(
    planSchema.safeParse({ ...plan, patternRule: { highDays: 3, lowDays: 8 } }).success,
    false,
  );
  assert.equal(planSchema.safeParse({ ...plan, lowThreshold: 30 }).success, false);
  assert.equal(planSchema.safeParse({ ...plan, ketoneCheckAbove: 50 }).success, false);
});
test("a plan missing only correctionHours keeps every other saved setting in its draft and stays unusable", () => {
  const { correctionHours, ...imported } = planWithMealRatios;
  void correctionHours;
  const saved = { ...imported, basal: 0, basalTime: "", timezone: "Europe/London" };
  assert.equal(planSchema.safeParse(saved).success, false);
  const draft = planDraft(saved);
  assert.deepEqual(draft.values, saved);
  assert.equal("correctionHours" in draft.values, false);
  assert.deepEqual(draft.missing, ["correctionHours"]);
  assert.deepEqual(draft.invalid, []);
  assert.equal(planSchema.safeParse(draft.values).success, false);
  assert.equal(planSchema.safeParse({ ...draft.values, correctionHours: 3 }).success, true);
});
test("a plan draft leaves out invalid values instead of inventing replacements", () => {
  const draft = planDraft({
    ...plan,
    target: 20,
    factor: "80",
    increment: 0.25,
    timezone: "Not/AZone",
    basal: 0,
    basalTime: "20:00",
    mealRatios: { breakfast: 12, lunch: -1, dinner: 20, snack: 900 },
  });
  assert.deepEqual(draft.values, {
    ratio: plan.ratio,
    rounding: plan.rounding,
    correctionHours: plan.correctionHours,
    note: plan.note,
    lowThreshold: plan.lowThreshold,
    ketoneCheckAbove: plan.ketoneCheckAbove,
    patternRule: plan.patternRule,
    mealRatios: { breakfast: 12, dinner: 20 },
  });
  assert.deepEqual(draft.missing, []);
  assert.deepEqual(draft.invalid.toSorted(), [
    "basal",
    "basalTime",
    "factor",
    "increment",
    "mealRatios.lunch",
    "mealRatios.snack",
    "target",
    "timezone",
  ]);
  assert.equal(planSchema.safeParse(draft.values).success, false);
});
test("a plan draft keeps a scheduled dose but not a malformed time, and reads nothing from non-objects", () => {
  const draft = planDraft({ ...plan, basalTime: "8pm" });
  assert.equal(draft.values.basal, plan.basal);
  assert.equal("basalTime" in draft.values, false);
  assert.deepEqual(draft.invalid, ["basalTime"]);
  for (const saved of [null, "plan", [plan]]) {
    const empty = planDraft(saved);
    assert.deepEqual(empty.values, {});
    assert.deepEqual(empty.invalid, []);
    assert.equal(empty.missing.length, Object.keys(plan).length);
  }
});
test("basal=0 allows no scheduled long-acting time; basal>0 requires a valid one", () => {
  assert.equal(planSchema.safeParse({ ...plan, basal: 0, basalTime: "" }).success, true);
  assert.equal(planSchema.safeParse({ ...plan, basal: 0, basalTime: "20:00" }).success, false);
  assert.equal(planSchema.safeParse({ ...plan, basal: 5, basalTime: "" }).success, false);
  assert.equal(planSchema.safeParse({ ...plan, basal: 5, basalTime: "20:00" }).success, true);
});
test("structured food portions remain tied to the logged carbohydrate total", () => {
  const food = {
    id: crypto.randomUUID(),
    kind: "food",
    at: "2026-09-23T12:30:00.000Z",
    glucose: null,
    source: null,
    ketones: null,
    carbs: 9,
    units: null,
    insulin: null,
    meal: "Snack",
    note: "Example snack",
  };
  assert.equal(entrySchema.safeParse(food).success, true); // Older manually logged food has no item details.
  const foodItems = [
    { name: "Milk", carbs: 6, amount: 1, unit: "cup" },
    { name: "Bread", carbs: 3, amount: 0.25, unit: "slice" },
  ];
  assert.equal(entrySchema.safeParse({ ...food, foodItems }).success, true);
  assert.equal(entrySchema.safeParse({ ...food, carbs: 12, foodItems }).success, false);
});
test("a glucose entry accepts a meter HI/LO status instead of a number, but never both", () => {
  const base = {
    id: crypto.randomUUID(),
    kind: "glucose",
    at: "2026-09-23T12:30:00.000Z",
    glucose: null,
    source: "Finger-stick",
    ketones: "Not checked",
    carbs: null,
    units: null,
    insulin: null,
    meal: null,
    note: "",
  };
  assert.equal(entrySchema.safeParse({ ...base, glucose: 140 }).success, true);
  assert.equal(entrySchema.safeParse({ ...base, status: "High" }).success, true);
  assert.equal(entrySchema.safeParse({ ...base, status: "Low" }).success, true);
  // Neither glucose nor status.
  assert.equal(entrySchema.safeParse(base).success, false);
  // Both glucose and status.
  assert.equal(entrySchema.safeParse({ ...base, glucose: 140, status: "High" }).success, false);
  // Status only makes sense on a glucose entry.
  assert.equal(
    entrySchema.safeParse({
      ...base,
      kind: "food",
      glucose: null,
      status: "High",
      carbs: 10,
      meal: "Snack",
    }).success,
    false,
  );
});
test("exercise entries require minutes and reject fields meant for other kinds", () => {
  const base = {
    id: crypto.randomUUID(),
    kind: "exercise",
    at: "2026-09-23T12:30:00.000Z",
    glucose: null,
    source: null,
    ketones: null,
    carbs: null,
    units: null,
    insulin: null,
    meal: null,
    note: "",
  };
  assert.equal(entrySchema.safeParse(base).success, false); // No minutes.
  assert.equal(entrySchema.safeParse({ ...base, minutes: 30 }).success, true);
  assert.equal(entrySchema.safeParse({ ...base, minutes: 30, intensity: "Hard" }).success, true);
  // Minutes and intensity only make sense on an exercise entry.
  assert.equal(
    entrySchema.safeParse({
      ...base,
      kind: "insulin",
      units: 1,
      insulin: "Rapid-acting",
      minutes: 30,
    }).success,
    false,
  );
  assert.equal(
    entrySchema.safeParse({
      ...base,
      kind: "insulin",
      units: 1,
      insulin: "Rapid-acting",
      minutes: null,
      intensity: "Hard",
    }).success,
    false,
  );
});
test("rescue entries require medication and reject it on other kinds", () => {
  const base = {
    id: crypto.randomUUID(),
    kind: "rescue",
    at: "2026-09-23T12:30:00.000Z",
    glucose: null,
    source: null,
    ketones: null,
    carbs: null,
    units: null,
    insulin: null,
    meal: null,
    note: "",
  };
  assert.equal(entrySchema.safeParse(base).success, false); // No medication.
  assert.equal(entrySchema.safeParse({ ...base, medication: "Baqsimi" }).success, true);
  assert.equal(
    entrySchema.safeParse({
      ...base,
      kind: "glucose",
      glucose: 60,
      source: "Finger-stick",
      medication: "Baqsimi",
    }).success,
    false,
  );
});
test("low-treatment severity only applies to a food entry marked as a low treatment", () => {
  const base = {
    id: crypto.randomUUID(),
    kind: "food",
    at: "2026-09-23T12:30:00.000Z",
    glucose: null,
    source: null,
    ketones: null,
    carbs: 15,
    units: null,
    insulin: null,
    meal: "Low treatment",
    note: "",
  };
  assert.equal(entrySchema.safeParse({ ...base, lowSeverity: "Mild" }).success, true);
  assert.equal(entrySchema.safeParse(base).success, true); // Severity is optional even for a low treatment.
  assert.equal(
    entrySchema.safeParse({ ...base, meal: "Snack", lowSeverity: "Mild" }).success,
    false,
  );
});
test("a saved food schema accepts a custom entry with no built-in reference list", () => {
  assert.equal(
    savedFoodSchema.safeParse({
      id: crypto.randomUUID(),
      name: "Custom snack",
      carbs: 20,
      serving: 1,
      unit: "cup",
    }).success,
    true,
  );
});
test("a saved food can be marked as one of the family's own low treatments", () => {
  const food = {
    id: crypto.randomUUID(),
    name: "Glucose tablets",
    carbs: 4,
    serving: 1,
    unit: "tablet",
  };
  assert.equal(savedFoodSchema.safeParse(food).success, true);
  assert.equal("lowTreatment" in savedFoodSchema.parse(food), false);
  assert.deepEqual(savedFoodSchema.parse({ ...food, lowTreatment: true }).lowTreatment, true);
});
test("CGM coverage excludes outages and status values do not become glucose numbers", () => {
  const at = (minute) => new Date(Date.UTC(2026, 8, 23, 0, minute)).toISOString();
  const point = (minute, value, status = null, source = "Dexcom Share") => ({
    at: at(minute),
    value,
    status,
    source,
  });
  const readings = [
    point(0, 100),
    point(5, 120),
    point(10, null, "High"),
    point(15, null, "High"),
    point(20, 300),
    point(25, 300),
    point(50, 60),
    point(55, 60),
  ];
  const summary = summarizeCgm(readings, at(0), at(60));
  assert.equal(summary.observedMinutes, 30);
  assert.equal(summary.coveragePercent, 50);
  assert.equal(summary.longestGapMinutes, 25);
  assert.equal(summary.inRangePercent, 33);
  assert.equal(summary.above180Percent, 50);
  assert.equal(summary.below70Percent, 17);
  assert.equal(summary.average, 157);
  const corrected = uniqueCgm([...readings, point(10, 150, null, "Dexcom Clarity")]);
  assert.equal(corrected.length, readings.length);
  assert.equal(corrected[2].value, 150);
  const legacy = { ...point(5, 120, null, "Dexcom Clarity") };
  const precise = { ...point(5, 120, null, "Dexcom Clarity"), at: "2026-09-23T00:05:47.000Z" };
  assert.equal(uniqueCgm([legacy, precise]).length, 1);
  assert.equal(uniqueCgm([legacy, { ...precise, value: 121 }]).length, 2);
});

test("meal ratios use the selected meal and keep the legacy single-ratio plan working", () => {
  const ratios = planWithMealRatios;
  assert.equal(getCarbRatio(ratios, null), null);
  assert.equal(getCarbRatio(ratios, "snack"), null);
  assert.equal(math(null, 60, ratios, false, "breakfast").food, 1.5);
  assert.equal(math(null, 60, ratios, false, "lunch").food, 2);
  assert.equal(math(null, 60, ratios, false, "dinner").food, 2);
  assert.equal(math(null, 40, plan, false).food, 1);
  assert.throws(() => math(null, 25, ratios, false), /Choose a configured meal ratio/);
  assert.throws(() => math(null, 25, ratios, false, "snack"), /Choose a configured meal ratio/);
});
test("correction-only needs no meal; combined math rounds once after applying meal ratio", () => {
  assert.deepEqual(math(375, 0, planWithMealRatios, true), math(375, 0, plan, true));
  const combined = math(175, 30, planWithMealRatios, true, "lunch");
  assert.deepEqual(combined, { food: 1, correction: 0.4375, raw: 1.4375, rounded: 1 });
});
test("meal ratios survive plan parsing and reject missing, zero, or invalid values", () => {
  assert.deepEqual(planSchema.parse(planWithMealRatios).mealRatios, {
    breakfast: 40,
    lunch: 30,
    dinner: 30,
    snack: null,
  });
  assert.equal(
    planSchema.safeParse({
      ...planWithMealRatios,
      mealRatios: { breakfast: 40, lunch: 0, dinner: 30, snack: null },
    }).success,
    false,
  );
  assert.equal(
    planSchema.safeParse({ ...planWithMealRatios, mealRatios: { breakfast: 40, lunch: 30 } })
      .success,
    false,
  );
  assert.equal(
    planSchema.safeParse({
      ...planWithMealRatios,
      mealRatios: { breakfast: 40, lunch: 30, dinner: 30, snack: -1 },
    }).success,
    false,
  );
  assert.equal(planSchema.safeParse(plan).success, true);
});
test("calculation metadata retains the meal and exact original ratio", () => {
  const original = {
    mode: "Carbs",
    carbs: 28,
    glucose: null,
    source: null,
    foodEntryIds: [],
    calculatedUnits: 1,
    target: 140,
    factor: 80,
    ratio: 28,
    ratioMeal: "lunch",
  };
  assert.deepEqual(calculationSchema.parse(original), original);
  assert.equal(calculationSchema.parse({ ...original, ratioMeal: undefined, ratio: 40 }).ratio, 40);
});

// Synthetic contacts only: reserved 555 numbers and a generic clinic label.
const contacts = {
  careTeamName: "Synthetic Clinic",
  careTeamPhone: "+1 (555) 010-0100",
  afterHoursPhone: "555.010.0199",
  emergencyPhone: "555",
};
test("a plan without contacts stays valid and a draft never lists contacts as missing", () => {
  assert.equal("contacts" in planSchema.parse(plan), false);
  const { correctionHours, ...incomplete } = plan;
  void correctionHours;
  assert.deepEqual(planDraft(incomplete).missing, ["correctionHours"]);
  assert.equal(planDraft({}).missing.includes("contacts"), false);
});
test("contacts are trimmed, blanks are dropped, and an all-blank set stores nothing", () => {
  const parsed = planSchema.parse({
    ...plan,
    contacts: {
      careTeamName: "  Synthetic Clinic ",
      careTeamPhone: " 555-0100 ",
      emergencyPhone: "",
    },
  });
  assert.deepEqual(parsed.contacts, {
    careTeamName: "Synthetic Clinic",
    careTeamPhone: "555-0100",
  });
  const blank = planSchema.parse({
    ...plan,
    contacts: { careTeamName: " ", careTeamPhone: "", afterHoursPhone: "", emergencyPhone: "" },
  });
  assert.equal(JSON.parse(JSON.stringify(blank)).contacts, undefined);
  assert.deepEqual(planSchema.parse({ ...plan, contacts }).contacts, contacts);
});
test("contact phones refuse links, markup, control characters and values without digits", () => {
  for (const phone of [
    "javascript:alert(1)",
    "tel:5550100",
    "https://example.com",
    "<b>555-0100</b>",
    "555-0100\u0000",
    "555\n0100",
    "555-0100 ext 2",
    "1+555-0100",
    "(-)",
    "5",
    "5".repeat(21),
    `+1 ${"5".repeat(38)}`,
  ])
    assert.equal(
      planSchema.safeParse({ ...plan, contacts: { careTeamPhone: phone } }).success,
      false,
      phone,
    );
  for (const name of ["Synthetic\nClinic", "Synthetic\u202eClinic"])
    assert.equal(
      planSchema.safeParse({ ...plan, contacts: { careTeamName: name } }).success,
      false,
      name,
    );
  assert.equal(
    planSchema.safeParse({ ...plan, contacts: { careTeamName: "x".repeat(101) } }).success,
    false,
  );
  assert.equal(planSchema.safeParse({ ...plan, contacts: "555-0100" }).success, false);
});
test("tel links strip display formatting and are never built from an invalid value", () => {
  assert.equal(telHref("+1 (555) 010-0100"), "tel:+15550100100");
  assert.equal(telHref(" 555.010.0199 "), "tel:5550100199");
  for (const value of ["javascript:alert(1)", "555-0100<script>", "tel:555", "", null, 5550100])
    assert.equal(telHref(value), null);
  assert.deepEqual(
    careContactLinks({ careTeamPhone: "javascript:alert(1)", afterHoursPhone: "555-0199" }, [
      "careTeamPhone",
      "afterHoursPhone",
    ]),
    [
      {
        key: "afterHoursPhone",
        label: "After-hours phone",
        number: "555-0199",
        href: "tel:5550199",
      },
    ],
  );
});
test("a plan draft keeps valid contacts and marks an unusable one without inventing a value", () => {
  const { correctionHours, ...incomplete } = plan;
  void correctionHours;
  const draft = planDraft({
    ...incomplete,
    contacts: { ...contacts, afterHoursPhone: "https://example.com" },
  });
  assert.deepEqual(draft.values.contacts, {
    careTeamName: contacts.careTeamName,
    careTeamPhone: contacts.careTeamPhone,
    emergencyPhone: contacts.emergencyPhone,
  });
  assert.deepEqual(draft.missing, ["correctionHours"]);
  assert.deepEqual(draft.invalid, ["contacts.afterHoursPhone"]);
  assert.deepEqual(planDraft({ ...plan, contacts: "555-0100" }).invalid, ["contacts"]);
});

// Synthetic, non-clinical instruction text only.
const instructions = {
  lowGlucose: "Synthetic low-care note.\n\nSecond synthetic paragraph.",
  severeLow: "Synthetic severe-low note.",
  sickDay: "Synthetic sick-day note.\n\tIndented synthetic line.",
};
test("emergency instructions are optional, keep inner line breaks, and drop blank sections", () => {
  assert.equal("emergencyInstructions" in planSchema.parse(plan), false);
  assert.equal(planDraft({}).missing.includes("emergencyInstructions"), false);
  assert.deepEqual(
    planSchema.parse({ ...plan, emergencyInstructions: instructions }).emergencyInstructions,
    instructions,
  );
  const trimmed = planSchema.parse({
    ...plan,
    emergencyInstructions: {
      lowGlucose: "\n  Synthetic low-care note.\nNext line.  \n",
      sickDay: " \n ",
    },
  });
  assert.deepEqual(trimmed.emergencyInstructions, {
    lowGlucose: "Synthetic low-care note.\nNext line.",
  });
  const blank = planSchema.parse({
    ...plan,
    emergencyInstructions: { lowGlucose: "", severeLow: "  ", sickDay: "\n" },
  });
  assert.equal(JSON.parse(JSON.stringify(blank)).emergencyInstructions, undefined);
});
test("malformed and oversized emergency instructions are refused", () => {
  assert.equal(
    planSchema.safeParse({ ...plan, emergencyInstructions: { lowGlucose: "x".repeat(4000) } })
      .success,
    true,
  );
  for (const emergencyInstructions of [
    { lowGlucose: "x".repeat(4001) },
    { severeLow: 5 },
    { sickDay: ["Synthetic sick-day note."] },
    { lowGlucose: "Synthetic\u0000note" },
    { lowGlucose: "Synthetic\u202enote" },
    "Synthetic low-care note.",
    ["Synthetic low-care note."],
    null,
  ])
    assert.equal(
      planSchema.safeParse({ ...plan, emergencyInstructions }).success,
      false,
      JSON.stringify(emergencyInstructions),
    );
});
test("a plan draft keeps usable instructions and marks an unusable one without inventing text", () => {
  const { correctionHours, ...incomplete } = plan;
  void correctionHours;
  const draft = planDraft({
    ...incomplete,
    emergencyInstructions: { ...instructions, severeLow: "x".repeat(4001) },
  });
  assert.deepEqual(draft.values.emergencyInstructions, {
    lowGlucose: instructions.lowGlucose,
    sickDay: instructions.sickDay,
  });
  assert.deepEqual(draft.missing, ["correctionHours"]);
  assert.deepEqual(draft.invalid, ["emergencyInstructions.severeLow"]);
  assert.deepEqual(planDraft({ ...plan, emergencyInstructions: "Synthetic" }).invalid, [
    "emergencyInstructions",
  ]);
  assert.equal(
    planDraft({ ...plan, emergencyInstructions: { sickDay: " " } }).values.emergencyInstructions,
    undefined,
  );
});
test("contact availability is optional one-line text, and a contact without a phone still shows", () => {
  const withHours = {
    careTeamHours: "Synthetic weekday availability",
    afterHoursName: "Synthetic Answering Line",
    afterHoursHours: "Synthetic overnight availability",
  };
  assert.deepEqual(planSchema.parse({ ...plan, contacts: withHours }).contacts, withHours);
  for (const value of ["Synthetic\nhours", "x".repeat(201)])
    assert.equal(
      planSchema.safeParse({ ...plan, contacts: { careTeamHours: value } }).success,
      false,
      value,
    );
  assert.equal(
    planSchema.safeParse({ ...plan, contacts: { afterHoursName: "x".repeat(101) } }).success,
    false,
  );
  assert.deepEqual(careContactLines({ careTeamName: "Synthetic Clinic" }), [
    { key: "careTeam", title: "Synthetic Clinic" },
  ]);
  assert.deepEqual(
    careContactLines({
      afterHoursHours: "Synthetic overnight availability",
      afterHoursPhone: "javascript:alert(1)",
    }),
    [
      {
        key: "afterHours",
        title: "After-hours line",
        availability: "Synthetic overnight availability",
      },
    ],
  );
  assert.deepEqual(careContactLines({ ...withHours, afterHoursPhone: "555-0199" })[1], {
    key: "afterHours",
    title: "Synthetic Answering Line",
    availability: "Synthetic overnight availability",
    phone: { number: "555-0199", href: "tel:5550199" },
  });
  assert.deepEqual(careContactLines({ emergencyPhone: "555" }), []);
});
test("the shareable handoff escapes saved instructions and contacts and keeps their line breaks", () => {
  const html = handoffEmergencyHtml({
    emergencyInstructions: {
      lowGlucose: 'Synthetic <script>alert("x")</script> & note\nSecond line',
    },
    contacts: { afterHoursName: "Synthetic <b>Line</b>", afterHoursHours: "Synthetic 'hours'" },
  });
  assert.ok(
    html.includes(
      "Synthetic &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; note\nSecond line",
    ),
  );
  assert.ok(html.includes("<b>Synthetic &lt;b&gt;Line&lt;/b&gt;</b> · Synthetic &#39;hours&#39;"));
  assert.equal(html.includes("<script>"), false);
  // An unconfigured section falls back to general guidance, and the urgent call stays first.
  assert.ok(html.includes("Use prescribed rescue medication according to its instructions."));
  assert.ok(html.indexOf("call the local emergency number") < html.indexOf("Synthetic &lt;script"));
});
