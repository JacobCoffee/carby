"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CarbyWordmark } from "./carby-wordmark";
import Link from "next/link";
import { TIME_ZONE_LIST_ID, TimeZoneOptions } from "./time-zone-field";
import {
  careContactKeys,
  careContactLabels,
  emergencyInstructionKeys,
  emergencyInstructionLabels,
  mealRatioLabels,
  planSchema,
  type CareContactKey,
  type CareContacts,
  type EmergencyInstructionKey,
  type EmergencyInstructions,
  type MealRatio,
  type GlucoseRanges,
  type PlanDraft,
  type PlanField,
} from "@/lib/care";
import BackupImport from "./backup-import";
import {
  CareContactFields,
  contactIssues,
  OtherContactFields,
  otherContactIssues,
  type OtherContact,
} from "./care-contacts";
import { EmergencyInstructionFields, instructionIssues } from "./emergency-instructions";
import { GlucoseRangeFields } from "./glucose-range-fields";
import { MealRatioFields } from "./meal-ratio-fields";
import {
  PlanSettingsFields,
  planSettingsIssues,
  planSettingsKeys,
  type PlanSettingsDraft,
} from "./plan-settings-fields";
import OnboardingProfile from "./onboarding-profile";
import type { Profile } from "@/lib/profile";
import "./care-workspace.css";

const fieldLabels: Record<PlanField, string> = {
  target: "glucose target",
  factor: "correction factor",
  ratio: "carbohydrate ratio",
  mealRatios: "meal ratios",
  correctionHours: "correction review interval",
  increment: "dose increment",
  rounding: "rounding rule",
  basal: "long-acting dose schedule",
  basalTime: "long-acting dose time",
  timezone: "time zone",
  note: "care team notes",
  contacts: "care contacts",
  emergencyInstructions: "emergency instructions",
  glucoseRanges: "glucose ranges",
  lowThreshold: "treat-a-low threshold",
  ketoneCheckAbove: "check-ketones threshold",
  patternRule: "pattern rule",
  correctionCallCheck: "correction call check",
  sickDayChecks: "sick-day check schedule",
  lowTreatment: "low-treatment amount",
  overnightCheck: "overnight check schedule",
  snackInsulinFromCarbs: "snack insulin cutoff",
  rescueMedication: "rescue medication",
  meter: "glucose meter",
  otherContacts: "other care contacts",
  temperatureUnit: "temperature unit",
};
const fieldLabel = (field: PlanDraft["invalid"][number]) =>
  field.startsWith("mealRatios.")
    ? `${mealRatioLabels[field.slice(11) as MealRatio].toLowerCase()} meal ratio`
    : field.startsWith("contacts.")
      ? careContactLabels[field.slice(9) as CareContactKey].toLowerCase()
      : field.startsWith("emergencyInstructions.")
        ? emergencyInstructionLabels[field.slice(22) as EmergencyInstructionKey].toLowerCase()
        : field.startsWith("otherContacts.")
          ? "other care contacts"
          : fieldLabels[field as PlanField];
const list = (fields: PlanDraft["invalid"]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(fields.map(fieldLabel));

/** Settings the person must enter: notes are optional, and no dose means no dose time. */
function neededFields({ missing, values }: PlanDraft) {
  return missing.filter(
    (field) => field !== "note" && !(field === "basalTime" && values.basal === 0),
  );
}
function incompleteMessage(plan: PlanDraft) {
  if (!Object.keys(plan.values).length)
    return "Your latest saved care plan has no settings Carby can use. Enter your current care plan settings to open your records. Earlier plan versions stay in your plan history.";
  const needed = neededFields(plan);
  return [
    "Carby filled in the settings from your latest saved care plan.",
    needed.length &&
      `The saved plan does not include the ${list(needed)}. Enter ${needed.length > 1 ? "them" : "it"} from your current care plan.`,
    plan.invalid.length &&
      `Check the ${list(plan.invalid)}: the saved ${plan.invalid.length > 1 ? "values" : "value"} could not be used.`,
    "Review every value before you save.",
  ]
    .filter(Boolean)
    .join(" ");
}

export default function CareSetup({
  incompletePlan,
  hasRecords = false,
  profile = null,
}: {
  /** Present when the latest saved plan exists but fails planSchema. */
  incompletePlan?: PlanDraft;
  hasRecords?: boolean;
  /** Already-saved profile, if any. When absent, setup collects one before the care plan step. */
  profile?: Profile | null;
}) {
  const [phase, setPhase] = useState<"profile" | "main">(profile ? "main" : "profile");
  const [personalizedName, setPersonalizedName] = useState(profile?.name ?? "");
  const saved = incompletePlan?.values ?? {};
  const savedTimezone = saved.timezone;
  const [mode, setMode] = useState<"settings" | "import">("settings");
  const [importBusy, setImportBusy] = useState(false);
  const timezoneInput = useRef<HTMLInputElement>(null);
  const [basalSchedule, setBasalSchedule] = useState(
    saved.basal === undefined ? "" : saved.basal === 0 ? "none" : "daily",
  );
  const [mealRatios, setMealRatios] = useState(saved.mealRatios);
  const [contacts, setContacts] = useState<CareContacts>(saved.contacts ?? {});
  const [instructions, setInstructions] = useState<EmergencyInstructions>(
    saved.emergencyInstructions ?? {},
  );
  const [ranges, setRanges] = useState<GlucoseRanges | undefined>(saved.glucoseRanges);
  const [planSettings, setPlanSettings] = useState<PlanSettingsDraft>({
    lowThreshold: saved.lowThreshold,
    ketoneCheckAbove: saved.ketoneCheckAbove,
    patternRule: saved.patternRule,
    correctionCallCheck: saved.correctionCallCheck,
    sickDayChecks: saved.sickDayChecks,
    lowTreatment: saved.lowTreatment,
    overnightCheck: saved.overnightCheck,
    snackInsulinFromCarbs: saved.snackInsulinFromCarbs,
    rescueMedication: saved.rescueMedication,
    meter: saved.meter,
  });
  const [otherContacts, setOtherContacts] = useState<OtherContact[]>(saved.otherContacts ?? []);
  // Missing and unusable saved settings stay marked until the person edits them.
  const [flags, setFlags] = useState<ReadonlySet<string>>(
    () =>
      new Set(incompletePlan ? [...neededFields(incompletePlan), ...incompletePlan.invalid] : []),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const flagged = (field: string) => flags.has(field) || undefined;
  function unflag(field: string) {
    if (!flags.has(field)) return;
    const next = new Set(flags);
    next.delete(field);
    setFlags(next);
  }
  // Only fresh setup guesses a time zone; a saved plan without a usable one stays blank.
  const freshSetup = !incompletePlan;
  const timezoneSource = savedTimezone
    ? "From your saved care plan."
    : incompletePlan
      ? incompletePlan.invalid.includes("timezone")
        ? "The saved time zone could not be used. Enter your time zone."
        : "Your saved plan does not include a time zone. Enter your time zone."
      : "Detected from your browser.";
  useEffect(() => {
    if (freshSetup && timezoneInput.current)
      timezoneInput.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, [freshSetup]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const fields = new FormData(event.currentTarget);
    const number = (key: string) => {
      const value = fields.get(key);
      return value === null || value === "" ? NaN : Number(value);
    };
    const result = planSchema.safeParse({
      target: number("target"),
      factor: number("factor"),
      ratio: number("ratio"),
      correctionHours: number("correctionHours"),
      increment: number("increment"),
      rounding: fields.get("rounding"),
      basal: basalSchedule === "none" ? 0 : number("basal"),
      basalTime: basalSchedule === "none" ? "" : fields.get("basalTime"),
      timezone: fields.get("timezone"),
      note: fields.get("note"),
      ...(mealRatios && { mealRatios }),
      contacts,
      emergencyInstructions: instructions,
      ...(ranges && { glucoseRanges: ranges }),
      ...planSettings,
      ...(otherContacts.length && { otherContacts }),
    });
    const badContacts = result.success ? [] : contactIssues(result.error.issues);
    const badInstructions = result.success ? [] : instructionIssues(result.error.issues);
    const badRanges =
      !result.success && result.error.issues.some((issue) => issue.path[0] === "glucoseRanges");
    const badPlanSettings = planSettingsIssues(planSettings);
    const badOtherContacts = result.success ? [] : otherContactIssues(result.error.issues);
    if (
      badContacts.length ||
      badInstructions.length ||
      badRanges ||
      badPlanSettings.length ||
      badOtherContacts.length
    ) {
      setFlags(
        new Set([
          ...flags,
          ...badContacts.map((key) => `contacts.${key}`),
          ...badInstructions.map((key) => `emergencyInstructions.${key}`),
          ...(badRanges ? ["glucoseRanges"] : []),
          ...badPlanSettings,
          ...badOtherContacts.map((key) => `otherContacts.${key}`),
        ]),
      );
      setError(
        badContacts.length
          ? "Check the marked care contacts."
          : badInstructions.length
            ? "Check the marked emergency instructions."
            : badRanges
              ? "Check the marked glucose ranges."
              : badPlanSettings.length
                ? "Check the marked plan safety settings."
                : "Check the marked other care contacts.",
      );
      return;
    }
    if (!result.success || fields.get("confirmed") !== "on") {
      setError("Check every field and confirm that these values match your care plan.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/care", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "plan", plan: result.data }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(data.error ?? "Your plan could not be saved. Please retry.");
      window.location.reload();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Your plan could not be saved. Please retry.",
      );
      setSaving(false);
    }
  }
  return (
    <div className="care-redesign care-setup">
      <header className="topbar care-workspace-topbar">
        <Link className="carby-brand" href="/" aria-label="Carby home">
          <CarbyWordmark />
        </Link>
        <span className="setup-header-label">Your daily care log</span>
      </header>
      <main className="care-setup-main">
        {phase === "profile" ? (
          <section className="care-setup-intro care-setup-onboarding">
            <OnboardingProfile
              mode="setup"
              initial={profile}
              onSaved={(saved) => {
                setPersonalizedName(saved.name);
                setPhase("main");
              }}
              onSkip={() => setPhase("main")}
            />
          </section>
        ) : (
          <>
            <section className="care-setup-intro">
              <h1>
                {personalizedName ? `Let's set up ${personalizedName}'s care plan` : "Set up Carby"}
              </h1>
              <p>
                Use Carby to log glucose readings, food, and insulin. Enter the settings from your
                current care plan to get started.
              </p>
              <div className="setup-import-choice">
                <h2>Import from another deployment</h2>
                <p>
                  Import the backup file from your other Carby deployment to keep your log, plan
                  history, saved foods, and glucose data.
                </p>
                <button
                  type="button"
                  className="button outline"
                  aria-pressed={mode === "import"}
                  disabled={importBusy}
                  onClick={() => setMode(mode === "import" ? "settings" : "import")}
                >
                  {mode === "import" ? "Enter settings instead" : "Import a backup"}
                </button>
              </div>
              <p className="setup-safety">
                Carby does not prescribe treatment. Use your primary glucose device and current care
                plan for treatment decisions.
              </p>
            </section>
            {mode === "import" && (
              <BackupImport
                hasRecords={hasRecords}
                onBusyChange={setImportBusy}
                onUseSettings={() => setMode("settings")}
              />
            )}
            <form
              className="care-setup-form entry-form"
              onSubmit={save}
              onChange={(event) => {
                const target: EventTarget = event.target;
                if (
                  target instanceof HTMLInputElement ||
                  target instanceof HTMLSelectElement ||
                  target instanceof HTMLTextAreaElement
                )
                  unflag(target.name);
              }}
              hidden={mode === "import"}
            >
              <h2>Care plan settings</h2>
              <p>If you are unsure of any value, ask your care team before you continue.</p>
              {incompletePlan ? (
                <p className="notice" role="status">
                  {incompleteMessage(incompletePlan)}
                </p>
              ) : (
                hasRecords && (
                  <p className="notice" role="status">
                    This account has records but no care plan. Enter your current care plan settings
                    to open them.
                  </p>
                )
              )}
              <fieldset disabled={saving}>
                <legend>Glucose & meal calculations</legend>
                <div className="two-fields">
                  <label className="field">
                    <span>Glucose target (mg/dL)</span>
                    <input
                      name="target"
                      defaultValue={saved.target}
                      aria-invalid={flagged("target")}
                      type="number"
                      inputMode="decimal"
                      min="70"
                      max="250"
                      step="any"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Correction factor (mg/dL per unit)</span>
                    <input
                      name="factor"
                      defaultValue={saved.factor}
                      aria-invalid={flagged("factor")}
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      max="1000"
                      step="any"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Carbohydrate ratio (grams per unit)</span>
                    <input
                      name="ratio"
                      defaultValue={saved.ratio}
                      aria-invalid={flagged("ratio")}
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      max="300"
                      step="any"
                      required
                    />
                    <small>
                      {mealRatios
                        ? "Meal doses use your meal ratios below."
                        : "You can set different meal ratios later."}
                    </small>
                  </label>
                  <label className="field">
                    <span>Correction review interval (hours)</span>
                    <input
                      name="correctionHours"
                      defaultValue={saved.correctionHours}
                      aria-invalid={flagged("correctionHours")}
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      max="24"
                      step="any"
                      required
                    />
                    <small>
                      Carby uses this to time reminders. It does not tell you to give insulin.
                    </small>
                  </label>
                  <label className="field">
                    <span>Dose increments</span>
                    <select
                      name="increment"
                      defaultValue={saved.increment === undefined ? "" : String(saved.increment)}
                      aria-invalid={flagged("increment")}
                      required
                    >
                      <option value="" disabled>
                        Select prescribed increment
                      </option>
                      <option value="0.5">0.5 units</option>
                      <option value="1">1 unit</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Rounding rule</span>
                    <select
                      name="rounding"
                      defaultValue={saved.rounding ?? ""}
                      aria-invalid={flagged("rounding")}
                      required
                    >
                      <option value="" disabled>
                        Select prescribed rounding
                      </option>
                      <option value="down">Round down</option>
                      <option value="nearest">Round to nearest</option>
                    </select>
                  </label>
                </div>
                {mealRatios && (
                  <MealRatioFields
                    ratios={mealRatios}
                    flagged={incompletePlan?.invalid.flatMap((field) =>
                      field.startsWith("mealRatios.") && flags.has(field)
                        ? [field.slice(11) as MealRatio]
                        : [],
                    )}
                    onChange={(ratios, changed) => {
                      setMealRatios(ratios);
                      unflag(`mealRatios.${changed}`);
                    }}
                  />
                )}
              </fieldset>
              <GlucoseRangeFields
                ranges={ranges}
                disabled={saving}
                invalid={!!flagged("glucoseRanges")}
                onChange={(next) => {
                  setRanges(next);
                  unflag("glucoseRanges");
                }}
              />
              <PlanSettingsFields
                draft={planSettings}
                onChange={(next, changed) => {
                  setPlanSettings(next);
                  unflag(changed);
                }}
                invalid={planSettingsKeys.filter((key) => flags.has(key))}
                disabled={saving}
              />
              <fieldset disabled={saving}>
                <legend>Long-acting insulin</legend>
                <label className="field">
                  <span>Scheduled dose</span>
                  <select
                    value={basalSchedule}
                    onChange={(event) => setBasalSchedule(event.target.value)}
                    aria-invalid={(basalSchedule === "" && flagged("basal")) || undefined}
                    required
                  >
                    <option value="" disabled>
                      Choose your plan’s schedule
                    </option>
                    <option value="daily">One daily dose</option>
                    <option value="none">No scheduled reminder</option>
                  </select>
                </label>
                {basalSchedule === "daily" && (
                  <div className="two-fields">
                    <label className="field">
                      <span>Prescribed long-acting dose (units)</span>
                      <input
                        name="basal"
                        defaultValue={saved.basal || undefined}
                        aria-invalid={flagged("basal")}
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        max="100"
                        step="any"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Scheduled time</span>
                      <input
                        name="basalTime"
                        type="time"
                        defaultValue={saved.basalTime || undefined}
                        aria-invalid={flagged("basalTime")}
                        required
                      />
                    </label>
                  </div>
                )}
                <p className="helper">
                  Insulin is logged as rapid-acting or long-acting. Record the medication name in
                  the entry notes when needed. Other schedules can be logged manually.
                </p>
              </fieldset>
              <fieldset disabled={saving}>
                <legend>Time zone & notes</legend>
                <label className="field">
                  <span>Time zone</span>
                  <input
                    ref={timezoneInput}
                    name="timezone"
                    list={TIME_ZONE_LIST_ID}
                    defaultValue={savedTimezone}
                    aria-invalid={flagged("timezone")}
                    required
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <small>{timezoneSource} Pick from the list, such as Europe/London.</small>
                </label>
                <TimeZoneOptions />
                <label className="field">
                  <span>Care team instructions or notes (optional)</span>
                  <textarea
                    name="note"
                    defaultValue={saved.note}
                    aria-invalid={flagged("note")}
                    maxLength={1000}
                    rows={3}
                  />
                </label>
              </fieldset>
              <CareContactFields
                values={contacts}
                onChange={setContacts}
                invalid={careContactKeys.filter((key) => flags.has(`contacts.${key}`))}
                disabled={saving}
              />
              <OtherContactFields
                values={otherContacts}
                onChange={setOtherContacts}
                invalid={[...flags].flatMap((flag) =>
                  flag.startsWith("otherContacts.") ? [flag.slice(14)] : [],
                )}
                disabled={saving}
              />
              <EmergencyInstructionFields
                values={instructions}
                onChange={setInstructions}
                invalid={emergencyInstructionKeys.filter((key) =>
                  flags.has(`emergencyInstructions.${key}`),
                )}
                disabled={saving}
              />
              <label className="check-row">
                <input name="confirmed" type="checkbox" required disabled={saving} />
                <span>I checked these values against my current care plan.</span>
              </label>
              {error && (
                <p className="notice danger" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary full" type="submit" disabled={saving}>
                {saving ? "Saving your plan…" : "Save plan & open Carby"}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
