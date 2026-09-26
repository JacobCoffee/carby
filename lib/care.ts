import { z } from "zod";
export const mealRatioKeys = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealRatio = (typeof mealRatioKeys)[number];
export const mealRatioLabels: Record<MealRatio, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack / other",
};
const ratioValue = z.number().positive().max(300);
export const mealRatiosSchema = z.object({
  breakfast: ratioValue,
  lunch: ratioValue,
  dinner: ratioValue,
  snack: ratioValue.nullable(),
});
export type MealRatios = z.infer<typeof mealRatiosSchema>;
export const careContactKeys = [
  "careTeamName",
  "careTeamPhone",
  "careTeamHours",
  "afterHoursName",
  "afterHoursPhone",
  "afterHoursHours",
  "emergencyPhone",
] as const;
export type CareContactKey = (typeof careContactKeys)[number];
export const careContactPhoneKeys = ["careTeamPhone", "afterHoursPhone", "emergencyPhone"] as const;
export type CareContactPhoneKey = (typeof careContactPhoneKeys)[number];
export function isCareContactPhoneKey(key: CareContactKey): key is CareContactPhoneKey {
  return (careContactPhoneKeys as readonly string[]).includes(key);
}
export const careContactLabels: Record<CareContactKey, string> = {
  careTeamName: "Care team or clinic name",
  careTeamPhone: "Care team phone",
  careTeamHours: "Care team availability",
  afterHoursName: "After-hours contact name",
  afterHoursPhone: "After-hours phone",
  afterHoursHours: "After-hours availability",
  emergencyPhone: "Emergency number",
};
/** Longest accepted value for each one-line contact field. */
export const careContactMaxLength: Record<CareContactKey, number> = {
  careTeamName: 100,
  careTeamPhone: 40,
  careTeamHours: 200,
  afterHoursName: 100,
  afterHoursPhone: 40,
  afterHoursHours: 200,
  emergencyPhone: 40,
};
export type CareContacts = Partial<Record<CareContactKey, string>>;
// Digits with an optional leading +, and only the separators people type in phone numbers.
const phoneFormat = /^\+?[0-9 ().-]+$/;
function isPhone(value: string) {
  const digits = value.replace(/\D/g, "").length;
  return value.length <= 40 && phoneFormat.test(value) && digits >= 2 && digits <= 20;
}
// C0/C1 control characters and bidirectional overrides, which can disguise the displayed text.
// Multi-line text may keep tabs and line breaks.
function hasControlCharacter(value: string, multiline = false) {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (multiline && (code === 0x09 || code === 0x0a || code === 0x0d)) continue;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
  }
  return false;
}
const contactText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !hasControlCharacter(v), "Remove line breaks and control characters.");
const contactPhone = z
  .string()
  .trim()
  .max(40)
  .refine(
    (v) => v === "" || isPhone(v),
    "Use digits, with an optional leading +, spaces, parentheses, hyphens, or dots.",
  );
const careContactFields = z.object({
  careTeamName: contactText(careContactMaxLength.careTeamName).optional(),
  careTeamPhone: contactPhone.optional(),
  careTeamHours: contactText(careContactMaxLength.careTeamHours).optional(),
  afterHoursName: contactText(careContactMaxLength.afterHoursName).optional(),
  afterHoursPhone: contactPhone.optional(),
  afterHoursHours: contactText(careContactMaxLength.afterHoursHours).optional(),
  emergencyPhone: contactPhone.optional(),
});
/** Blank contacts are left out, and a plan with none stores no contacts at all. */
export const careContactsSchema = careContactFields.transform((contacts) => {
  const provided: CareContacts = {};
  for (const key of careContactKeys) if (contacts[key]) provided[key] = contacts[key];
  return Object.keys(provided).length ? provided : undefined;
});
/** A tel: link for a phone value, or null when the value is not a valid phone entry. */
export function telHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.trim();
  if (!isPhone(phone)) return null;
  return `tel:${phone.startsWith("+") ? "+" : ""}${phone.replace(/\D/g, "")}`;
}
export function careContactLinks(
  contacts: CareContacts | undefined,
  keys: readonly CareContactPhoneKey[],
) {
  return keys.flatMap((key) => {
    const number = contacts?.[key]?.trim();
    const href = telHref(number);
    return number && href ? [{ key, label: careContactLabels[key], number, href }] : [];
  });
}
export type CareContactLine = {
  key: "careTeam" | "afterHours";
  /** The saved name, or a generic label when only a phone or availability is saved. */
  title: string;
  availability?: string;
  phone?: { number: string; href: string };
};
const contactLineKeys = [
  {
    key: "careTeam",
    title: "Care team",
    name: "careTeamName",
    phone: "careTeamPhone",
    hours: "careTeamHours",
  },
  {
    key: "afterHours",
    title: "After-hours line",
    name: "afterHoursName",
    phone: "afterHoursPhone",
    hours: "afterHoursHours",
  },
] as const;
/**
 * The care team and after-hours contacts, each with any saved name, phone link and availability.
 * A contact appears when any one of those is saved; an unusable phone gets no link.
 */
export function careContactLines(contacts: CareContacts | undefined): CareContactLine[] {
  return contactLineKeys.flatMap(({ key, title, name, phone, hours }) => {
    const savedName = contacts?.[name]?.trim();
    const availability = contacts?.[hours]?.trim();
    const [link] = careContactLinks(contacts, [phone]);
    if (!savedName && !availability && !link) return [];
    return [
      {
        key,
        title: savedName || title,
        ...(availability ? { availability } : {}),
        ...(link ? { phone: { number: link.number, href: link.href } } : {}),
      },
    ];
  });
}
export const emergencyInstructionKeys = [
  "lowGlucose",
  "severeLow",
  "highGlucose",
  "sickDay",
  "whenToCall",
] as const;
export type EmergencyInstructionKey = (typeof emergencyInstructionKeys)[number];
export const emergencyInstructionLabels: Record<EmergencyInstructionKey, string> = {
  lowGlucose: "Low-glucose treatment and recheck instructions",
  severeLow: "Severe-low and rescue-medication instructions",
  highGlucose: "High-glucose treatment instructions",
  sickDay: "Illness and ketone instructions",
  whenToCall: "When to call the care team",
};
export const EMERGENCY_INSTRUCTION_MAX = 4000;
export type EmergencyInstructions = Partial<Record<EmergencyInstructionKey, string>>;
/** Verbatim text from the person's care plan. Leading and trailing whitespace is trimmed on save. */
const instructionText = z
  .string()
  .trim()
  .max(EMERGENCY_INSTRUCTION_MAX)
  .refine((v) => !hasControlCharacter(v, true), "Remove control characters.");
const emergencyInstructionFields = z.object({
  lowGlucose: instructionText.optional(),
  severeLow: instructionText.optional(),
  highGlucose: instructionText.optional(),
  sickDay: instructionText.optional(),
  whenToCall: instructionText.optional(),
});
/** Blank instructions are left out, and a plan with none stores no instructions at all. */
export const emergencyInstructionsSchema = emergencyInstructionFields.transform((fields) => {
  const provided: EmergencyInstructions = {};
  for (const key of emergencyInstructionKeys) if (fields[key]) provided[key] = fields[key];
  return Object.keys(provided).length ? provided : undefined;
});
export const glucoseRangeKeys = ["veryLow", "low", "high", "veryHigh"] as const;
export type GlucoseRangeKey = (typeof glucoseRangeKeys)[number];
export type GlucoseRanges = Record<GlucoseRangeKey, number>;
/** The international consensus CGM ranges, in effect whenever a care plan sets none. */
export const STANDARD_GLUCOSE_RANGES: GlucoseRanges = {
  veryLow: 54,
  low: 70,
  high: 180,
  veryHigh: 250,
};
export const glucoseRangeLabels: Record<GlucoseRangeKey, string> = {
  veryLow: "Very low below",
  low: "Low below",
  high: "High above",
  veryHigh: "Very high above",
};
const rangeLimit = z.number().int().min(40).max(400);
/** Limits for reports and charts only; no dose calculation reads them. */
export const glucoseRangesSchema = z
  .object({ veryLow: rangeLimit, low: rangeLimit, high: rangeLimit, veryHigh: rangeLimit })
  .refine((v) => v.veryLow < v.low && v.low < v.high && v.high < v.veryHigh, {
    message: "Each limit must be higher than the one before it.",
  });
const positiveInt = (min: number, max: number) => z.number().int().min(min).max(max);
export const patternRuleSchema = z.object({
  highDays: positiveInt(2, 7),
  lowDays: positiveInt(1, 7),
});
export const correctionCallCheckSchema = z.object({
  above: positiveInt(150, 600),
  hours: z.number().min(0.5).max(12),
});
export const sickDayChecksSchema = z.object({
  glucoseHours: z.number().min(0.5).max(12),
  ketoneHours: z.number().min(0.5).max(12),
});
export const lowTreatmentSchema = z.object({
  grams: z.number().min(1).max(60),
  recheckMinutes: positiveInt(5, 60),
});
const calendarDateValue = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const parsed = new Date(`${v}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
  }, "Enter a valid date.");
export const overnightCheckSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time (HH:MM)."),
  until: calendarDateValue,
});
export const meterSchema = z.object({
  name: z.string().trim().max(60).optional(),
  hi: positiveInt(100, 1000),
  lo: positiveInt(10, 100),
});
export const temperatureUnits = ["F", "C"] as const;
export type TemperatureUnit = (typeof temperatureUnits)[number];
export const temperatureUnitLabels: Record<TemperatureUnit, string> = { F: "°F", C: "°C" };
const otherContactFields = z.object({
  role: contactText(60).refine((v) => v.length > 0, "Enter a role for this contact."),
  name: contactText(60).optional(),
  phone: contactPhone.optional(),
  hours: contactText(60).optional(),
});
export type OtherContact = z.infer<typeof otherContactFields>;
export const otherContactsSchema = z.array(otherContactFields).max(20);
/** Any IANA zone this runtime can format in, such as America/Chicago. */
export const timeZoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Choose a time zone from the list, such as America/Chicago.");
const planFields = z.object({
  target: z.number().min(70).max(250),
  factor: z.number().positive().max(1000),
  ratio: z.number().positive().max(300),
  mealRatios: mealRatiosSchema.optional(),
  increment: z.number().refine((v) => [0.5, 1].includes(v)),
  rounding: z.enum(["down", "nearest"]),
  basal: z.number().min(0).max(100),
  basalTime: z.string(),
  timezone: timeZoneSchema,
  correctionHours: z.number().positive().max(24),
  note: z.string().max(1000),
  contacts: careContactsSchema.optional(),
  emergencyInstructions: emergencyInstructionsSchema.optional(),
  glucoseRanges: glucoseRangesSchema.optional(),
  lowThreshold: z.number().int().min(40).max(150),
  ketoneCheckAbove: z.number().int().min(100).max(400),
  patternRule: patternRuleSchema,
  correctionCallCheck: correctionCallCheckSchema.optional(),
  sickDayChecks: sickDayChecksSchema.optional(),
  lowTreatment: lowTreatmentSchema.optional(),
  overnightCheck: overnightCheckSchema.optional(),
  snackInsulinFromCarbs: z.number().min(1).max(100).optional(),
  rescueMedication: z.string().trim().min(1).max(60).optional(),
  meter: meterSchema.optional(),
  otherContacts: otherContactsSchema.optional(),
  /** How illness check-in temperatures are entered and shown. Stored readings are in °C. */
  temperatureUnit: z.enum(temperatureUnits).optional(),
});
/** Each plan setting's own schema, for forms that check one field at a time. */
export const planFieldSchemas = planFields.shape;
function checkBasalSchedule(v: { basal: number; basalTime: string }, c: z.RefinementCtx) {
  if (v.basal > 0 && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.basalTime))
    c.addIssue({
      code: "custom",
      path: ["basalTime"],
      message: "Enter a scheduled time for the long-acting dose.",
    });
  if (v.basal === 0 && v.basalTime !== "")
    c.addIssue({
      code: "custom",
      path: ["basalTime"],
      message: "Clear the scheduled time when no long-acting dose is scheduled.",
    });
}
export const planSchema = planFields.superRefine(checkBasalSchedule);
export type Plan = z.infer<typeof planSchema>;
export type PlanField = keyof Plan;
/**
 * The usable settings of a saved plan that fails planSchema, checked one field at a time.
 * Nothing is defaulted: a setting absent from the saved plan is listed in `missing`, and one that
 * fails its check is listed in `invalid` and left out of `values`. Contacts and emergency
 * instructions are optional, so they are never listed as missing.
 */
export type PlanDraft = {
  values: Partial<Omit<Plan, "mealRatios">> & { mealRatios?: Partial<MealRatios> };
  missing: PlanField[];
  invalid: (
    | PlanField
    | `mealRatios.${MealRatio}`
    | `contacts.${CareContactKey}`
    | `emergencyInstructions.${EmergencyInstructionKey}`
  )[];
};
const basalScheduleSchema = planFields
  .pick({ basal: true, basalTime: true })
  .superRefine(checkBasalSchedule);
export function planDraft(saved: unknown): PlanDraft {
  const source: Record<string, unknown> =
    typeof saved === "object" && saved !== null && !Array.isArray(saved)
      ? (saved as Record<string, unknown>)
      : {};
  const draft: PlanDraft = { values: {}, missing: [], invalid: [] };
  for (const key of Object.keys(planFields.shape) as PlanField[]) {
    if (
      key === "mealRatios" ||
      key === "contacts" ||
      key === "emergencyInstructions" ||
      key === "glucoseRanges" ||
      key === "correctionCallCheck" ||
      key === "sickDayChecks" ||
      key === "lowTreatment" ||
      key === "overnightCheck" ||
      key === "snackInsulinFromCarbs" ||
      key === "rescueMedication" ||
      key === "meter" ||
      key === "otherContacts" ||
      key === "temperatureUnit"
    )
      continue;
    if (source[key] === undefined) {
      draft.missing.push(key);
      continue;
    }
    const result = planFields.shape[key].safeParse(source[key]);
    if (result.success) Object.assign(draft.values, { [key]: result.data });
    else draft.invalid.push(key);
  }
  const { basal, basalTime } = draft.values;
  if (
    basal !== undefined &&
    basalTime !== undefined &&
    !basalScheduleSchema.safeParse({ basal, basalTime }).success
  ) {
    // A time with no dose (or a dose with no valid time) cannot be resolved without the plan.
    if (basal === 0) {
      delete draft.values.basal;
      draft.invalid.push("basal");
    }
    delete draft.values.basalTime;
    draft.invalid.push("basalTime");
  }
  if (source.mealRatios !== undefined) {
    const whole = mealRatiosSchema.safeParse(source.mealRatios);
    if (whole.success) draft.values.mealRatios = whole.data;
    else {
      // Keep the valid meals so one bad value does not discard the rest of the profile.
      const raw =
        typeof source.mealRatios === "object" && source.mealRatios !== null
          ? (source.mealRatios as Record<string, unknown>)
          : {};
      const ratios: Partial<MealRatios> = {};
      for (const key of mealRatioKeys) {
        const result = mealRatiosSchema.shape[key].safeParse(raw[key]);
        if (result.success) Object.assign(ratios, { [key]: result.data });
        else draft.invalid.push(`mealRatios.${key}`);
      }
      draft.values.mealRatios = ratios;
    }
  }
  if (source.contacts !== undefined) {
    const raw = source.contacts;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      draft.invalid.push("contacts");
    else {
      // Keep the valid contacts so one bad value does not discard the others.
      const contacts: CareContacts = {};
      for (const key of careContactKeys) {
        const value = (raw as Record<string, unknown>)[key];
        const result = careContactFields.shape[key].safeParse(value);
        if (!result.success) draft.invalid.push(`contacts.${key}`);
        else if (result.data) contacts[key] = result.data;
      }
      if (Object.keys(contacts).length) draft.values.contacts = contacts;
    }
  }
  if (source.emergencyInstructions !== undefined) {
    const raw = source.emergencyInstructions;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      draft.invalid.push("emergencyInstructions");
    else {
      // Keep the usable instructions; an unusable one is marked, never replaced.
      const instructions: EmergencyInstructions = {};
      for (const key of emergencyInstructionKeys) {
        const value = (raw as Record<string, unknown>)[key];
        const result = emergencyInstructionFields.shape[key].safeParse(value);
        if (!result.success) draft.invalid.push(`emergencyInstructions.${key}`);
        else if (result.data) instructions[key] = result.data;
      }
      if (Object.keys(instructions).length) draft.values.emergencyInstructions = instructions;
    }
  }
  if (source.glucoseRanges !== undefined) {
    // Four limits only make sense together; an unusable set is marked, never partly kept.
    const result = glucoseRangesSchema.safeParse(source.glucoseRanges);
    if (result.success) draft.values.glucoseRanges = result.data;
    else draft.invalid.push("glucoseRanges");
  }
  // Each of these optional groups is atomic: every field only makes sense with the others, so an
  // unusable group is marked as a whole and never partly kept.
  for (const [key, schema] of [
    ["correctionCallCheck", correctionCallCheckSchema],
    ["sickDayChecks", sickDayChecksSchema],
    ["lowTreatment", lowTreatmentSchema],
    ["overnightCheck", overnightCheckSchema],
    ["meter", meterSchema],
  ] as const) {
    if (source[key] === undefined) continue;
    const result = schema.safeParse(source[key]);
    if (result.success) Object.assign(draft.values, { [key]: result.data });
    else draft.invalid.push(key);
  }
  for (const key of ["snackInsulinFromCarbs", "rescueMedication", "temperatureUnit"] as const) {
    if (source[key] === undefined) continue;
    const result = planFields.shape[key].safeParse(source[key]);
    if (result.success) Object.assign(draft.values, { [key]: result.data });
    else draft.invalid.push(key);
  }
  if (source.otherContacts !== undefined) {
    if (!Array.isArray(source.otherContacts)) draft.invalid.push("otherContacts");
    else {
      // Keep the valid contacts so one bad entry does not discard the rest of the list.
      const contacts: OtherContact[] = [];
      let invalid = false;
      for (const item of source.otherContacts.slice(0, 20)) {
        const result = otherContactFields.safeParse(item);
        if (result.success) contacts.push(result.data);
        else invalid = true;
      }
      if (invalid) draft.invalid.push("otherContacts");
      if (contacts.length) draft.values.otherContacts = contacts;
    }
  }
  return draft;
}
export function getMealRatios(plan: Plan) {
  return (
    plan.mealRatios ?? {
      breakfast: plan.ratio,
      lunch: plan.ratio,
      dinner: plan.ratio,
      snack: plan.ratio,
    }
  );
}
/** The plan's glucose ranges, or the standard ones when the plan sets none. */
export function glucoseRanges(plan: Pick<Plan, "glucoseRanges">) {
  return { ...(plan.glucoseRanges ?? STANDARD_GLUCOSE_RANGES), standard: !plan.glucoseRanges };
}
export function getCarbRatio(plan: Plan, meal?: MealRatio | null): number | null {
  return plan.mealRatios ? (meal ? plan.mealRatios[meal] : null) : plan.ratio;
}
export function ratioSummary(plan: Plan): string {
  return plan.mealRatios
    ? mealRatioKeys
        .map(
          (key) =>
            `${mealRatioLabels[key]} ${plan.mealRatios![key] === null ? "not set" : `1:${plan.mealRatios![key]}`}`,
        )
        .join(" · ")
    : `All food 1:${plan.ratio}`;
}
export const doseAdjustmentSchema = z.object({
  actualUnits: z.number().positive().max(100),
  acknowledgedAt: z.string().datetime(),
  reason: z.string().max(500),
});
export const calculationSchema = z.object({
  foodLog: z.enum(["separate", "dose-only"]).optional(),
  adjustment: doseAdjustmentSchema.optional(),
  ratioMeal: z.enum(mealRatioKeys).optional(),
  mode: z.enum(["Carbs", "Correction", "Carbs + correction"]),
  carbs: z.number().min(0).max(1000),
  glucose: z.number().min(20).max(1000).nullable(),
  source: z.enum(["Finger-stick", "Dexcom"]).nullable(),
  foodEntryIds: z.array(z.string().uuid()).max(50),
  calculatedUnits: z.number().min(0).max(100),
  measuredAt: z.string().datetime().nullable().optional(),
  foodDescription: z.string().max(5000).optional(),
  increment: z
    .number()
    .refine((v) => [0.5, 1].includes(v))
    .optional(),
  rounding: z.enum(["down", "nearest"]).optional(),
  target: z.number().min(70).max(250),
  factor: z.number().positive().max(1000),
  ratio: z.number().positive().max(300),
});
/** The actual eaten portions at the time of a food-builder log. Older entries have only notes. */
export const foodItemSchema = z.object({
  name: z.string().trim().min(1).max(100),
  carbs: z.number().min(0).max(1000),
  amount: z.number().min(0).max(1000),
  unit: z.string().trim().min(1).max(40),
  savedFoodId: z.string().uuid().optional(),
});
export type FoodItem = z.infer<typeof foodItemSchema>;
export const entrySchema = z
  .object({
    id: z.string().uuid(),
    revision: z.string().max(100).optional(),
    kind: z.enum(["glucose", "food", "insulin", "exercise", "rescue"]),
    at: z.string().datetime(),
    glucose: z.number().min(20).max(1000).nullable(),
    status: z.enum(["High", "Low"]).nullable().optional(),
    source: z.enum(["Finger-stick", "Dexcom"]).nullable(),
    ketones: z.enum(["Not checked", "Negative", "Trace", "Small", "Moderate", "Large"]).nullable(),
    carbs: z.number().min(0).max(1000).nullable(),
    foodItems: z.array(foodItemSchema).max(50).optional(),
    units: z.number().min(0).max(100).nullable(),
    insulin: z.enum(["Rapid-acting", "Long-acting"]).nullable(),
    purpose: z
      .enum(["Meal only", "Correction only", "Meal + correction", "Other / unknown"])
      .nullable()
      .optional(),
    calculation: calculationSchema.optional(),
    minutes: z.number().int().min(1).max(600).nullable().optional(),
    intensity: z.enum(["Light", "Moderate", "Hard"]).nullable().optional(),
    medication: z.string().trim().min(1).max(60).nullable().optional(),
    lowSeverity: z.enum(["Mild", "Moderate"]).nullable().optional(),
    meal: z
      .enum([
        "Meal",
        "Snack",
        "Low treatment",
        "Breakfast",
        "Morning snack",
        "Lunch",
        "Afternoon snack",
        "Dinner",
        "Evening snack",
        "Overnight",
      ])
      .nullable(),
    note: z.string().max(1000),
  })
  .superRefine((v, c) => {
    if (v.kind === "glucose") {
      const hasStatus = v.status != null;
      if (v.glucose === null && !hasStatus)
        c.addIssue({ code: "custom", message: "Enter a glucose value or a meter range status" });
      if (v.glucose !== null && hasStatus)
        c.addIssue({
          code: "custom",
          path: ["status"],
          message: "Enter a glucose value or a status, not both",
        });
      if (!v.source) c.addIssue({ code: "custom", message: "Enter glucose and reading source" });
    } else if (v.status != null)
      c.addIssue({ code: "custom", path: ["status"], message: "Status only applies to glucose" });
    if (v.kind === "food" && (v.carbs === null || !v.meal))
      c.addIssue({ code: "custom", message: "Enter carbohydrates and food type" });
    if (
      v.foodItems &&
      (v.kind !== "food" ||
        v.carbs === null ||
        Math.abs(v.foodItems.reduce((sum, item) => sum + item.carbs, 0) - v.carbs) > 0.02)
    )
      c.addIssue({
        code: "custom",
        message: "Food portions must match the logged carbohydrate total",
      });
    if (v.kind === "insulin" && (v.units === null || v.units <= 0 || !v.insulin))
      c.addIssue({ code: "custom", message: "Enter actual insulin and positive units" });
    if (v.kind === "exercise" && v.minutes == null)
      c.addIssue({ code: "custom", path: ["minutes"], message: "Enter exercise minutes" });
    if (v.minutes != null && v.kind !== "exercise")
      c.addIssue({
        code: "custom",
        path: ["minutes"],
        message: "Minutes only applies to exercise",
      });
    if (v.intensity != null && v.kind !== "exercise")
      c.addIssue({
        code: "custom",
        path: ["intensity"],
        message: "Intensity only applies to exercise",
      });
    if (v.kind === "rescue" && !v.medication)
      c.addIssue({ code: "custom", path: ["medication"], message: "Enter rescue medication" });
    if (v.medication != null && v.kind !== "rescue")
      c.addIssue({
        code: "custom",
        path: ["medication"],
        message: "Medication only applies to rescue",
      });
    if (v.lowSeverity != null && (v.kind !== "food" || v.meal !== "Low treatment"))
      c.addIssue({
        code: "custom",
        path: ["lowSeverity"],
        message: "Severity only applies to a low treatment food entry",
      });
    if (Date.parse(v.at) > Date.now() + 60000)
      c.addIssue({ code: "custom", message: "Only record events that already happened" });
  });
export type Entry = z.infer<typeof entrySchema>;
export function math(
  glucose: number | null,
  carbs: number,
  p: Plan,
  includeCorrection: boolean,
  meal?: MealRatio | null,
) {
  const ratio = getCarbRatio(p, meal);
  if (carbs > 0 && ratio === null) throw new Error("Choose a configured meal ratio.");
  const food = carbs === 0 ? 0 : carbs / ratio!;
  const correction =
    includeCorrection && glucose !== null ? Math.max(0, (glucose - p.target) / p.factor) : 0;
  const raw = food + correction;
  const scaled = raw / p.increment;
  return {
    food,
    correction,
    raw,
    rounded: (p.rounding === "down" ? Math.floor(scaled + 1e-9) : Math.round(scaled)) * p.increment,
  };
}
/** Two decimals, truncated so 2.4999 reads 2.49 and never looks like it reached 2.5. */
export function exactUnits(units: number) {
  return (Math.floor(units * 100 + 1e-9) / 100).toFixed(2);
}
/** How far exact plan math falls below the next increment when rounding left some insulin out. */
export function stepShortfall(raw: number, rounded: number, p: Pick<Plan, "increment">) {
  if (raw - rounded < 0.005) return null;
  const next = rounded + p.increment;
  return { next, short: Math.max(0.01, Math.ceil((next - raw) * 100 - 1e-9) / 100) };
}
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
export function dateKey(date: Date, tz: string) {
  let formatter = dateFormatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(tz, formatter);
  }
  return formatter.format(date);
}
export function localInput(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return parts.replace(" ", "T");
}
export function fromLocal(value: string, tz: string) {
  const target = new Date(value + "Z").getTime();
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const repr = localInput(new Date(guess), tz);
    guess += target - new Date(repr + "Z").getTime();
  }
  const result = new Date(guess);
  if (localInput(result, tz) !== value)
    throw new Error("This time does not exist in your timezone.");
  return result.toISOString();
}
export const savedFoodSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  carbs: z.number().min(0).max(1000),
  serving: z.number().positive().max(1000),
  unit: z.string().trim().min(1).max(40),
  lowTreatment: z.boolean().optional(),
});
export type SavedFood = z.infer<typeof savedFoodSchema>;
export const cgmSchema = z
  .object({
    at: z.string().datetime(),
    value: z.number().int().min(40).max(400).nullable(),
    status: z.enum(["High", "Low"]).nullable(),
    source: z.string().min(1).max(80),
  })
  .refine((v) => (v.value === null) !== (v.status === null), {
    message: "Provide either a glucose value or a range status.",
  });
export type CgmReading = z.infer<typeof cgmSchema>;
export const dexcomEventSchema = z.object({
  at: z.string().datetime(),
  type: z.string().trim().min(1).max(100),
  details: z.string().trim().max(500),
  value: z.number().min(20).max(1000).nullable(),
  source: z.literal("Dexcom Clarity"),
});
export type DexcomEvent = z.infer<typeof dexcomEventSchema>;

/** Keep out-of-range readings from becoming a fabricated numeric line segment. */
export function cgmSegments(readings: CgmReading[]): CgmReading[][] {
  const segments: CgmReading[][] = [];
  let current: CgmReading[] = [];
  for (const reading of readings) {
    if (reading.value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(reading);
  }
  if (current.length) segments.push(current);
  return segments;
}
export function cgmLabel(reading: CgmReading): string {
  return reading.value === null
    ? `${reading.status?.toUpperCase() ?? "Out of range"} (out of range)`
    : String(reading.value);
}
/** A meter's HI/LO result, with the meter's limit when the plan records it. Never a number. */
export function meterStatusLabel(
  status: "High" | "Low",
  meter?: Pick<NonNullable<Plan["meter"]>, "hi" | "lo">,
): string {
  const label = status === "High" ? "HI" : "LO";
  if (!meter) return label;
  return `${label} (${status === "High" ? `above ${meter.hi}` : `below ${meter.lo}`})`;
}
/** A logged glucose reading: its value, or the meter's HI/LO result when it had none. */
export function entryGlucoseLabel(
  entry: Pick<Entry, "glucose" | "status">,
  meter?: Pick<NonNullable<Plan["meter"]>, "hi" | "lo">,
): string {
  return entry.status ? meterStatusLabel(entry.status, meter) : `${entry.glucose} mg/dL`;
}
