"use client";

import { apiFetch } from "@/lib/person-request";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronLeft, ChevronRight, FileUp, Loader2 } from "lucide-react";
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
  type Plan,
  type PlanDraft,
  type PlanField,
} from "@/lib/care";
import {
  firstFlaggedStep,
  issueFlag,
  planSummary,
  setupSteps,
  stepOfFlag,
  type SetupStepId,
} from "@/lib/setup-steps";
import BackupImport from "./backup-import";
import { CareContactFields, OtherContactFields, type OtherContact } from "./care-contacts";
import { EmergencyInstructionFields } from "./emergency-instructions";
import { GlucoseRangeFields } from "./glucose-range-fields";
import { MealRatioFields } from "./meal-ratio-fields";
import {
  PlanSettingsFields,
  planSettingsKeys,
  type PlanSettingsDraft,
} from "./plan-settings-fields";
import OnboardingProfile from "./onboarding-profile";
import type { Profile } from "@/lib/profile";
import { Toaster } from "@/components/ui/sonner";
import PersonMenu from "./person-menu";
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
  correctionQuietHours: "overnight correction review hours",
  snackInsulinFromCarbs: "snack insulin cutoff",
  longActingReminderHours: "long-acting reminder window",
  usualChangePercent: "change from usual",
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

const REVIEW = setupSteps.length - 1;
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
/** The first problem found: a control the browser rejects, or plan checks marked on the form. */
type Problem = { step: number; control?: Control; flags?: string[] };

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
  const form = useRef<HTMLFormElement>(null);
  const timezoneInput = useRef<HTMLInputElement>(null);
  const [basalSchedule, setBasalSchedule] = useState(
    saved.basal === undefined ? "" : saved.basal === 0 ? "none" : "daily",
  );
  const [mealRatios, setMealRatios] = useState(saved.mealRatios);
  const [contacts, setContacts] = useState<CareContacts>(saved.contacts ?? {});
  const [instructions, setInstructions] = useState<EmergencyInstructions>(
    saved.emergencyInstructions ?? {},
  );
  const [note, setNote] = useState(saved.note ?? "");
  const [ranges, setRanges] = useState<GlucoseRanges | undefined>(saved.glucoseRanges);
  const [planSettings, setPlanSettings] = useState<PlanSettingsDraft>({
    lowThreshold: saved.lowThreshold,
    ketoneCheckAbove: saved.ketoneCheckAbove,
    patternRule: saved.patternRule,
    correctionCallCheck: saved.correctionCallCheck,
    sickDayChecks: saved.sickDayChecks,
    lowTreatment: saved.lowTreatment,
    overnightCheck: saved.overnightCheck,
    correctionQuietHours: saved.correctionQuietHours,
    snackInsulinFromCarbs: saved.snackInsulinFromCarbs,
    longActingReminderHours: saved.longActingReminderHours,
    usualChangePercent: saved.usualChangePercent,
    rescueMedication: saved.rescueMedication,
    meter: saved.meter,
  });
  const [otherContacts, setOtherContacts] = useState<OtherContact[]>(saved.otherContacts ?? []);
  // Missing and unusable saved settings stay marked until the person edits them.
  const [flags, setFlags] = useState<ReadonlySet<string>>(
    () =>
      new Set(incompletePlan ? [...neededFields(incompletePlan), ...incompletePlan.invalid] : []),
  );
  // A saved plan that needs fixing opens on the first step with something to fix.
  const [step, setStep] = useState(() => (incompletePlan ? (firstFlaggedStep(flags) ?? 1) : 0));
  const [reached, setReached] = useState(() => (incompletePlan ? REVIEW : 0));
  const [direction, setDirection] = useState<"none" | "forward" | "back">("none");
  const [review, setReview] = useState<Plan | null>(null);
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");
  // Set by navigation so the next render moves focus: to a rejected control, else the heading.
  const moved = useRef(false);
  const rejected = useRef<Control | null>(null);
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
  // The form mounts only after the profile phase, so fill the zone once it exists.
  useEffect(() => {
    if (freshSetup && phase === "main" && timezoneInput.current && !timezoneInput.current.value)
      timezoneInput.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, [freshSetup, phase]);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const control = rejected.current;
    rejected.current = null;
    if (control) {
      control.reportValidity();
      return;
    }
    const heading = form.current?.querySelector<HTMLElement>(
      `[data-step="${setupSteps[step].id}"] h2`,
    );
    if (!heading) return;
    heading.focus({ preventScroll: true });
    if (heading.getBoundingClientRect().top < 0)
      heading.scrollIntoView({
        block: "start",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
  }, [step]);

  function parsePlan(element: HTMLFormElement) {
    const fields = new FormData(element);
    const number = (key: string) => {
      const value = fields.get(key);
      return value === null || value === "" ? NaN : Number(value);
    };
    return planSchema.safeParse({
      target: number("target"),
      factor: number("factor"),
      ratio: number("ratio"),
      correctionHours: number("correctionHours"),
      increment: number("increment"),
      rounding: fields.get("rounding"),
      basal: basalSchedule === "none" ? 0 : number("basal"),
      basalTime: basalSchedule === "none" ? "" : fields.get("basalTime"),
      timezone: fields.get("timezone"),
      note,
      ...(mealRatios && { mealRatios }),
      contacts,
      emergencyInstructions: instructions,
      ...(ranges && { glucoseRanges: ranges }),
      ...planSettings,
      ...(otherContacts.length && { otherContacts }),
    });
  }
  /** The first problem on these steps, checked in order. Hidden steps are checked too. */
  function findProblem(element: HTMLFormElement, steps: readonly number[]): Problem | null {
    for (const index of steps) {
      const control = [
        ...element.querySelectorAll<Control>(
          `[data-step="${setupSteps[index].id}"] :is(input, select, textarea)`,
        ),
      ].find((candidate) => !candidate.checkValidity());
      if (control) return { step: index, control };
    }
    const result = parsePlan(element);
    if (result.success) return null;
    const checked = new Set<string>(steps.map((index) => setupSteps[index].id));
    const bad = result.error.issues
      .map((issue) => issueFlag(issue.path))
      .filter((flag) => checked.has(stepOfFlag(flag) ?? ""));
    const first = firstFlaggedStep(bad);
    return first === null
      ? null
      : { step: first, flags: bad.filter((flag) => stepOfFlag(flag) === setupSteps[first].id) };
  }
  function show(index: number) {
    moved.current = true;
    setDirection(index < step ? "back" : "forward");
    setStep(index);
    setReached(Math.max(reached, index));
    setError("");
  }
  function report(problem: Problem) {
    if (problem.flags) setFlags(new Set([...flags, ...problem.flags]));
    const message = problem.flags ? "Check the marked fields." : "";
    if (problem.step === step) {
      problem.control?.reportValidity();
      setError(message);
      return;
    }
    rejected.current = problem.control ?? null;
    show(problem.step);
    setError(message);
  }
  /** Goes to a step. Moving forward checks the current step, and the review checks them all. */
  function go(index: number) {
    const element = form.current;
    if (!element || index === step) return;
    if (index < step) return show(index);
    const current = findProblem(element, [step]);
    if (current) return report(current);
    if (index !== REVIEW) return show(index);
    const everyStep = setupSteps.map((_, i) => i).slice(1, REVIEW);
    const problem = findProblem(element, everyStep);
    if (problem) return report(problem);
    const result = parsePlan(element);
    if (!result.success) {
      setError("Some settings could not be checked. Go back through each step.");
      return;
    }
    setReview(result.data);
    show(REVIEW);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || finished) return;
    const element = event.currentTarget;
    if (step !== REVIEW) return go(step + 1);
    const problem = findProblem(
      element,
      setupSteps.map((_, i) => i),
    );
    if (problem) return report(problem);
    const result = parsePlan(element);
    if (!result.success) return;
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/api/care", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "plan", plan: result.data }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(data.error ?? "Your plan could not be saved. Please retry.");
      setFinished(true);
      // A short beat for the finished state, then open Carby with the new plan.
      setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Your plan could not be saved. Please retry.",
      );
      setSaving(false);
    }
  }

  const flaggedSteps = new Set<string | null>([...flags].map(stepOfFlag));
  const blank = (values: Record<string, string | undefined>) =>
    Object.values(values).every((value) => !value?.trim());
  const skippable: Partial<Record<SetupStepId, boolean>> = {
    contacts: blank(contacts) && !otherContacts.length,
    instructions: blank(instructions) && !note.trim(),
  };
  const id = setupSteps[step].id;
  const continueLabel =
    id === "start"
      ? "Enter my care plan"
      : id === "ranges" && !ranges
        ? "Use standard ranges"
        : skippable[id]
          ? "Skip this step"
          : "Continue";
  const summary = review && planSummary(review);
  const stepHead = (index: number) => (
    <header className="setup-step-head">
      <h2 tabIndex={-1}>{setupSteps[index].title}</h2>
      {setupSteps[index].optional && <span className="setup-optional">Optional</span>}
      <p className="setup-step-count">
        Step {index + 1} of {setupSteps.length}
      </p>
    </header>
  );
  const stepProps = (index: number) => ({
    "data-step": setupSteps[index].id,
    className: "setup-step",
    hidden: index !== step,
  });

  return (
    <div className="care-redesign care-setup">
      <Toaster richColors />
      <header className="topbar care-workspace-topbar">
        <Link className="carby-brand" href="/" aria-label="Carby home">
          <CarbyWordmark />
        </Link>
        <span className="setup-header-label">Your daily care log</span>
        <PersonMenu name={personalizedName || undefined} />
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
            <aside className="care-setup-intro setup-rail">
              <h1>
                {personalizedName ? `Let’s set up ${personalizedName}’s care plan` : "Set up Carby"}
              </h1>
              <p>
                Copy each setting from your current care plan. You can go back to any step before
                you save.
              </p>
              {incompletePlan && (
                <p className="notice" role="status">
                  {incompleteMessage(incompletePlan)}
                </p>
              )}
              {mode === "settings" && (
                <nav aria-label="Setup steps">
                  <ol className="setup-step-list">
                    {setupSteps.map((entry, index) => {
                      const attention = index !== step && flaggedSteps.has(entry.id);
                      const done = !attention && index !== step && index < reached;
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            aria-current={index === step ? "step" : undefined}
                            data-state={
                              index === step
                                ? "current"
                                : attention
                                  ? "attention"
                                  : done
                                    ? "done"
                                    : "upcoming"
                            }
                            disabled={index > reached || saving || finished}
                            onClick={() => go(index)}
                          >
                            <span className="setup-step-mark" aria-hidden="true">
                              {done ? <Check size={14} strokeWidth={3} /> : index + 1}
                            </span>
                            <span>{entry.title}</span>
                            {attention && <span className="sr-only"> (needs a value)</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              )}
            </aside>
            {mode === "import" && (
              <div className="setup-import">
                <button
                  type="button"
                  className="button outline"
                  disabled={importBusy}
                  onClick={() => setMode("settings")}
                >
                  <ChevronLeft size={17} aria-hidden="true" />
                  Back to setup
                </button>
                <BackupImport
                  hasRecords={hasRecords}
                  onBusyChange={setImportBusy}
                  onUseSettings={() => setMode("settings")}
                />
              </div>
            )}
            <form
              ref={form}
              className="care-setup-form entry-form setup-panel"
              data-direction={direction}
              data-finished={finished || undefined}
              noValidate
              onSubmit={submit}
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
              <div className="setup-progress" aria-hidden="true">
                <span style={{ transform: `scaleX(${finished ? 1 : step / setupSteps.length})` }} />
              </div>
              <fieldset className="setup-steps" disabled={saving || finished}>
                <section {...stepProps(0)}>
                  {stepHead(0)}
                  {hasRecords && !incompletePlan && (
                    <p className="notice" role="status">
                      This account has records but no care plan. Enter your current care plan
                      settings to open them.
                    </p>
                  )}
                  <p className="setup-step-intro">
                    You’ll copy each setting from your current care plan, from glucose math to
                    emergency contacts, so keep it nearby. Carby never fills in a value for you. If
                    you’re unsure of one, ask your care team.
                  </p>
                  <div className="setup-import-offer">
                    <p>
                      Moving from another Carby deployment? Bring your log, plan history, saved
                      foods and glucose data.
                    </p>
                    <button
                      type="button"
                      className="button outline"
                      onClick={() => setMode("import")}
                    >
                      <FileUp size={17} aria-hidden="true" />
                      Import a backup
                    </button>
                  </div>
                  <p className="setup-safety">
                    Carby does not prescribe treatment. Use your primary glucose device and current
                    care plan for treatment decisions.
                  </p>
                </section>
                <section {...stepProps(1)}>
                  {stepHead(1)}
                  <p className="setup-step-intro">
                    Enter these from your current care plan. The insulin calculator uses them for
                    its plan math.
                  </p>
                  <fieldset>
                    <legend className="sr-only">Glucose & meal calculations</legend>
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
                          defaultValue={
                            saved.increment === undefined ? "" : String(saved.increment)
                          }
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
                </section>
                <section {...stepProps(2)} data-lead-legend="hidden">
                  {stepHead(2)}
                  <GlucoseRangeFields
                    ranges={ranges}
                    disabled={saving}
                    invalid={!!flagged("glucoseRanges")}
                    onChange={(next) => {
                      setRanges(next);
                      unflag("glucoseRanges");
                    }}
                  />
                </section>
                <section {...stepProps(3)} data-lead-legend="hidden">
                  {stepHead(3)}
                  <PlanSettingsFields
                    draft={planSettings}
                    onChange={(next, changed) => {
                      setPlanSettings(next);
                      unflag(changed);
                    }}
                    invalid={planSettingsKeys.filter((key) => flags.has(key))}
                    disabled={saving}
                  />
                </section>
                <section {...stepProps(4)}>
                  {stepHead(4)}
                  <fieldset>
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
                      <div className="two-fields setup-reveal">
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
                      Insulin is logged as rapid-acting or long-acting. Record the medication name
                      in the entry notes when needed. Other schedules can be logged manually.
                    </p>
                  </fieldset>
                  <fieldset>
                    <legend>Time zone</legend>
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
                  </fieldset>
                </section>
                <section {...stepProps(5)} data-lead-legend="hidden">
                  {stepHead(5)}
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
                </section>
                <section {...stepProps(6)} data-lead-legend="hidden">
                  {stepHead(6)}
                  <EmergencyInstructionFields
                    values={instructions}
                    onChange={setInstructions}
                    invalid={emergencyInstructionKeys.filter((key) =>
                      flags.has(`emergencyInstructions.${key}`),
                    )}
                    disabled={saving}
                  />
                  <label className="field">
                    <span>Care team instructions or notes</span>
                    <textarea
                      name="note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      aria-invalid={flagged("note")}
                      maxLength={1000}
                      rows={3}
                    />
                  </label>
                </section>
                <section {...stepProps(REVIEW)}>
                  {stepHead(REVIEW)}
                  <p className="setup-step-intro">
                    Check each value against your current care plan before you save.
                  </p>
                  {summary?.map(({ step: index, title, rows }) => (
                    <section className="setup-review-group" key={index}>
                      <div className="setup-review-head">
                        <h3>{title}</h3>
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`Edit ${title.toLowerCase()}`}
                          onClick={() => go(index)}
                        >
                          Edit
                        </button>
                      </div>
                      {rows.length ? (
                        <dl>
                          {rows.map((row, i) => (
                            <div key={i}>
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="setup-review-empty">None added</p>
                      )}
                    </section>
                  ))}
                  <label className="check-row">
                    <input name="confirmed" type="checkbox" required />
                    <span>I checked these values against my current care plan.</span>
                  </label>
                </section>
              </fieldset>
              {error && (
                <p className="notice danger" role="alert">
                  {error}
                </p>
              )}
              <div className="setup-actions">
                {step > 0 && (
                  <button
                    type="button"
                    className="button outline"
                    disabled={saving || finished}
                    onClick={() => go(step - 1)}
                  >
                    <ChevronLeft size={17} aria-hidden="true" />
                    Back
                  </button>
                )}
                <button className="button primary" type="submit" disabled={saving || finished}>
                  {step < REVIEW ? (
                    <>
                      {continueLabel}
                      <ChevronRight size={17} aria-hidden="true" />
                    </>
                  ) : finished ? (
                    <>
                      <Check className="setup-finished-check" size={17} aria-hidden="true" />
                      Plan saved. Opening Carby…
                    </>
                  ) : saving ? (
                    <>
                      <Loader2 className="spin" size={17} aria-hidden="true" />
                      Saving your plan…
                    </>
                  ) : (
                    "Save plan & open Carby"
                  )}
                </button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
