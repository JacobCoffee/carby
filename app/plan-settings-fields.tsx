"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { planFieldSchemas, type Plan } from "@/lib/care";
import {
  factorFromInput,
  factorIn,
  factorInputBounds,
  glucoseFromInput,
  glucoseIn,
  glucoseInputBounds,
  type GlucoseUnit,
} from "@/lib/glucose-units";
import { lastOvernightCheck } from "@/lib/overnight-check";

/**
 * Every clinic-packet plan setting this component edits. `lowThreshold`, `ketoneCheckAbove` and
 * `patternRule` are required (no defaults; blank until entered from the family's care plan). The
 * rest are optional features, each switched on only by its own toggle — off means the field is
 * left out of the saved plan entirely.
 */
export const planSettingsKeys = [
  "lowThreshold",
  "ketoneCheckAbove",
  "patternRule",
  "correctionCallCheck",
  "sickDayChecks",
  "lowTreatment",
  "overnightCheck",
  "correctionQuietHours",
  "snackInsulinFromCarbs",
  "longActingReminderHours",
  "usualChangePercent",
  "rescueMedication",
  "meter",
] as const;
export type PlanSettingsKey = (typeof planSettingsKeys)[number];
export type PlanSettingsDraft = Partial<Pick<Plan, PlanSettingsKey>>;

/** The plan settings keys with a missing (when required) or out-of-range value. */
export function planSettingsIssues(draft: PlanSettingsDraft): PlanSettingsKey[] {
  return planSettingsKeys.filter((key) => !planFieldSchemas[key].safeParse(draft[key]).success);
}

/** A number field bound to a possibly-NaN value, so a blank input never becomes a fabricated 0. */
export function NumberField({
  label,
  helper,
  value,
  onChange,
  min,
  max,
  step = 1,
  required,
  disabled,
  invalid,
  placeholder,
}: {
  label: string;
  helper?: string;
  value: number | undefined;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number | "any";
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        required={required}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={value !== undefined && Number.isFinite(value) ? value : ""}
        onChange={(event) => onChange(event.target.value === "" ? NaN : Number(event.target.value))}
      />
      {helper && <small>{helper}</small>}
    </label>
  );
}

/**
 * A glucose level typed in the person's unit and held in mg/dL. The label gets the unit, and the
 * limits are the stored mg/dL bounds as the unit shows them. A value always shows again as it was
 * typed; changing the unit shows the same level in the new one.
 */
export function GlucoseField({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  ...rest
}: {
  label: string;
  helper?: string;
  unit: GlucoseUnit;
  /** mg/dL. */
  value: number | undefined;
  /** Called with mg/dL, or NaN when blank. */
  onChange: (mgdl: number) => void;
  /** mg/dL bounds, as in the plan schema. */
  min: number;
  max: number;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <NumberField
      {...rest}
      {...glucoseInputBounds(min, max, unit)}
      label={`${label} (${unit})`}
      value={value === undefined ? undefined : glucoseIn(value, unit)}
      onChange={(typed) => onChange(glucoseFromInput(typed, unit))}
    />
  );
}

/** A correction factor typed in the person's unit per insulin unit and held in mg/dL per unit. */
export function FactorField({
  label,
  unit,
  value,
  onChange,
  ...rest
}: {
  label: string;
  helper?: string;
  unit: GlucoseUnit;
  /** mg/dL per unit. */
  value: number | undefined;
  /** Called with mg/dL per unit, or NaN when blank. */
  onChange: (mgdlPerUnit: number) => void;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <NumberField
      {...rest}
      {...factorInputBounds(unit)}
      label={`${label} (${unit} per unit)`}
      value={value === undefined ? undefined : factorIn(value, unit)}
      onChange={(typed) => onChange(factorFromInput(typed, unit))}
    />
  );
}

/** A text field bound to a possibly-blank string, for the optional free-text plan settings. */
function TextField({
  label,
  helper,
  value,
  onChange,
  type = "text",
  maxLength,
  required,
  disabled,
  invalid,
}: {
  label: string;
  helper?: string;
  value: string | undefined;
  onChange: (value: string) => void;
  type?: "text" | "time" | "date";
  maxLength?: number;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
      {helper && <small>{helper}</small>}
    </label>
  );
}

/** An optional feature: a checkbox that switches the whole group on or off. Off removes the key. */
function ToggleGroup({
  legend,
  helper,
  enabled,
  onToggle,
  disabled,
  children,
}: {
  legend: string;
  helper: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="plan-settings-group">
      <label className="check-row">
        <Checkbox
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(checked) => onToggle(checked === true)}
        />
        <span>{legend}</span>
      </label>
      <small>{helper}</small>
      {enabled && <div className="two-fields">{children}</div>}
    </div>
  );
}

export function PlanSettingsFields({
  draft,
  unit,
  onChange,
  invalid = [],
  disabled,
}: {
  draft: PlanSettingsDraft;
  unit: GlucoseUnit;
  onChange: (draft: PlanSettingsDraft, changed: PlanSettingsKey) => void;
  invalid?: readonly PlanSettingsKey[];
  disabled?: boolean;
}) {
  const flagged = (key: PlanSettingsKey) => invalid.includes(key);
  const lastCheck = draft.overnightCheck && lastOvernightCheck(draft.overnightCheck);
  const lastCheckHelper = lastCheck ? `Last check: ${lastCheck}` : undefined;
  function set<K extends PlanSettingsKey>(key: K, value: PlanSettingsDraft[K]) {
    onChange({ ...draft, [key]: value }, key);
  }
  function remove(key: PlanSettingsKey) {
    const next = { ...draft };
    delete next[key];
    onChange(next, key);
  }
  return (
    <fieldset className="care-contact-fields plan-settings-fields" disabled={disabled}>
      <legend>Plan safety settings</legend>
      <p>
        Enter these from your current care plan. Carby never suggests or fills in a value for you.
      </p>
      <div className="two-fields">
        <GlucoseField
          label="Treat a low below"
          unit={unit}
          helper="The number below which you treat a low."
          value={draft.lowThreshold}
          onChange={(value) => set("lowThreshold", value)}
          min={40}
          max={150}
          required
          disabled={disabled}
          invalid={flagged("lowThreshold")}
        />
        <GlucoseField
          label="Check ketones above"
          unit={unit}
          helper="The glucose number above which you check ketones."
          value={draft.ketoneCheckAbove}
          onChange={(value) => set("ketoneCheckAbove", value)}
          min={100}
          max={400}
          required
          disabled={disabled}
          invalid={flagged("ketoneCheckAbove")}
        />
        <NumberField
          label="Pattern: high days in a row"
          helper="How many days in a row above your high range counts as a pattern."
          value={draft.patternRule?.highDays}
          onChange={(value) =>
            set("patternRule", { lowDays: draft.patternRule?.lowDays ?? NaN, highDays: value })
          }
          min={2}
          max={7}
          required
          disabled={disabled}
          invalid={flagged("patternRule")}
        />
        <NumberField
          label="Pattern: low days in a row"
          helper="How many days in a row below the low number counts as a pattern."
          value={draft.patternRule?.lowDays}
          onChange={(value) =>
            set("patternRule", { highDays: draft.patternRule?.highDays ?? NaN, lowDays: value })
          }
          min={1}
          max={7}
          required
          disabled={disabled}
          invalid={flagged("patternRule")}
        />
      </div>
      <ToggleGroup
        legend="Correction call check"
        helper="Your plan’s rule for calling the care team when glucose stays above a number for a set time after a correction dose. Optional."
        enabled={!!draft.correctionCallCheck}
        onToggle={(on) =>
          on
            ? set("correctionCallCheck", { above: NaN, hours: NaN })
            : remove("correctionCallCheck")
        }
        disabled={disabled}
      >
        <GlucoseField
          label="Call above"
          unit={unit}
          value={draft.correctionCallCheck?.above}
          onChange={(value) =>
            set("correctionCallCheck", {
              hours: draft.correctionCallCheck?.hours ?? NaN,
              above: value,
            })
          }
          min={150}
          max={600}
          required
          disabled={disabled}
          invalid={flagged("correctionCallCheck")}
        />
        <NumberField
          label="Hours after the correction"
          value={draft.correctionCallCheck?.hours}
          onChange={(value) =>
            set("correctionCallCheck", {
              above: draft.correctionCallCheck?.above ?? NaN,
              hours: value,
            })
          }
          min={0.5}
          max={12}
          step={0.5}
          required
          disabled={disabled}
          invalid={flagged("correctionCallCheck")}
        />
      </ToggleGroup>
      <ToggleGroup
        legend="Sick-day checks"
        helper="How often to check glucose and ketones during illness. Optional."
        enabled={!!draft.sickDayChecks}
        onToggle={(on) =>
          on
            ? set("sickDayChecks", { glucoseHours: NaN, ketoneHours: NaN })
            : remove("sickDayChecks")
        }
        disabled={disabled}
      >
        <NumberField
          label="Check glucose every (hours)"
          value={draft.sickDayChecks?.glucoseHours}
          onChange={(value) =>
            set("sickDayChecks", {
              ketoneHours: draft.sickDayChecks?.ketoneHours ?? NaN,
              glucoseHours: value,
            })
          }
          min={0.5}
          max={12}
          step={0.5}
          required
          disabled={disabled}
          invalid={flagged("sickDayChecks")}
        />
        <NumberField
          label="Check ketones every (hours)"
          value={draft.sickDayChecks?.ketoneHours}
          onChange={(value) =>
            set("sickDayChecks", {
              glucoseHours: draft.sickDayChecks?.glucoseHours ?? NaN,
              ketoneHours: value,
            })
          }
          min={0.5}
          max={12}
          step={0.5}
          required
          disabled={disabled}
          invalid={flagged("sickDayChecks")}
        />
      </ToggleGroup>
      <ToggleGroup
        legend="Low-treatment amount"
        helper="How many grams to treat a low with, and when to recheck. Optional."
        enabled={!!draft.lowTreatment}
        onToggle={(on) =>
          on ? set("lowTreatment", { grams: NaN, recheckMinutes: NaN }) : remove("lowTreatment")
        }
        disabled={disabled}
      >
        <NumberField
          label="Grams of fast-acting carbohydrate"
          value={draft.lowTreatment?.grams}
          onChange={(value) =>
            set("lowTreatment", {
              recheckMinutes: draft.lowTreatment?.recheckMinutes ?? NaN,
              grams: value,
            })
          }
          min={1}
          max={60}
          step="any"
          required
          disabled={disabled}
          invalid={flagged("lowTreatment")}
        />
        <NumberField
          label="Recheck after (minutes)"
          value={draft.lowTreatment?.recheckMinutes}
          onChange={(value) =>
            set("lowTreatment", { grams: draft.lowTreatment?.grams ?? NaN, recheckMinutes: value })
          }
          min={5}
          max={60}
          required
          disabled={disabled}
          invalid={flagged("lowTreatment")}
        />
      </ToggleGroup>
      <ToggleGroup
        legend="Overnight check"
        helper="A scheduled overnight check, and the last night it applies. Optional."
        enabled={!!draft.overnightCheck}
        onToggle={(on) =>
          on ? set("overnightCheck", { time: "", until: "" }) : remove("overnightCheck")
        }
        disabled={disabled}
      >
        <TextField
          label="Scheduled time"
          value={draft.overnightCheck?.time}
          onChange={(value) =>
            set("overnightCheck", { until: draft.overnightCheck?.until ?? "", time: value })
          }
          type="time"
          required
          disabled={disabled}
          invalid={flagged("overnightCheck")}
        />
        <TextField
          label="Last night it applies"
          helper={lastCheckHelper}
          value={draft.overnightCheck?.until}
          onChange={(value) =>
            set("overnightCheck", { time: draft.overnightCheck?.time ?? "", until: value })
          }
          type="date"
          required
          disabled={disabled}
          invalid={flagged("overnightCheck")}
        />
      </ToggleGroup>
      <ToggleGroup
        legend="Hide overnight correction reviews"
        helper="Hours when your plan gives no correction doses, such as while asleep. Correction review times in these hours are left off the chart. Optional."
        enabled={!!draft.correctionQuietHours}
        onToggle={(on) =>
          on ? set("correctionQuietHours", { start: "", end: "" }) : remove("correctionQuietHours")
        }
        disabled={disabled}
      >
        <TextField
          label="From"
          value={draft.correctionQuietHours?.start}
          onChange={(value) =>
            set("correctionQuietHours", {
              end: draft.correctionQuietHours?.end ?? "",
              start: value,
            })
          }
          type="time"
          required
          disabled={disabled}
          invalid={flagged("correctionQuietHours")}
        />
        <TextField
          label="Until"
          value={draft.correctionQuietHours?.end}
          onChange={(value) =>
            set("correctionQuietHours", {
              start: draft.correctionQuietHours?.start ?? "",
              end: value,
            })
          }
          type="time"
          required
          disabled={disabled}
          invalid={flagged("correctionQuietHours")}
        />
      </ToggleGroup>
      <ToggleGroup
        legend="Snack insulin cutoff"
        helper="The carbohydrate amount below which your plan gives snacks no insulin. This is a notice only — Carby’s dose math does not change. Optional."
        enabled={draft.snackInsulinFromCarbs !== undefined}
        onToggle={(on) =>
          on ? set("snackInsulinFromCarbs", NaN) : remove("snackInsulinFromCarbs")
        }
        disabled={disabled}
      >
        <NumberField
          label="Grams of carbohydrate"
          value={draft.snackInsulinFromCarbs}
          onChange={(value) => set("snackInsulinFromCarbs", value)}
          min={1}
          max={100}
          step="any"
          required
          disabled={disabled}
          invalid={flagged("snackInsulinFromCarbs")}
        />
      </ToggleGroup>
      <ToggleGroup
        legend="Long-acting reminder window"
        helper="Show the long-acting reminder only this close to its scheduled time, before and after. Off shows it from 2 hours before until the next evening. Optional."
        enabled={draft.longActingReminderHours !== undefined}
        onToggle={(on) =>
          on ? set("longActingReminderHours", NaN) : remove("longActingReminderHours")
        }
        disabled={disabled}
      >
        <NumberField
          label="Hours"
          value={draft.longActingReminderHours}
          onChange={(value) => set("longActingReminderHours", value)}
          min={0.5}
          max={12}
          step="any"
          required
          disabled={disabled}
          invalid={flagged("longActingReminderHours")}
        />
      </ToggleGroup>
      <ToggleGroup
        legend="Point out a change from usual"
        helper="Insights asks what’s going on when the last week’s average glucose is at least this much higher or lower than the four weeks before. A prompt to look, not advice. Optional."
        enabled={draft.usualChangePercent !== undefined}
        onToggle={(on) => (on ? set("usualChangePercent", NaN) : remove("usualChangePercent"))}
        disabled={disabled}
      >
        <NumberField
          label="Percent"
          value={draft.usualChangePercent}
          onChange={(value) => set("usualChangePercent", value)}
          min={5}
          max={100}
          step={1}
          required
          disabled={disabled}
          invalid={flagged("usualChangePercent")}
        />
      </ToggleGroup>
      <ToggleGroup
        legend="Rescue medication"
        helper="The name of the emergency rescue medication. Optional."
        enabled={draft.rescueMedication !== undefined}
        onToggle={(on) => (on ? set("rescueMedication", "") : remove("rescueMedication"))}
        disabled={disabled}
      >
        <TextField
          label="Medication name"
          value={draft.rescueMedication}
          onChange={(value) => set("rescueMedication", value)}
          maxLength={60}
          required
          disabled={disabled}
          invalid={flagged("rescueMedication")}
        />
      </ToggleGroup>
      <ToggleGroup
        legend="Glucose meter"
        helper="Your meter’s name and its HI/LO display limits. Optional."
        enabled={!!draft.meter}
        onToggle={(on) => (on ? set("meter", { hi: NaN, lo: NaN }) : remove("meter"))}
        disabled={disabled}
      >
        <TextField
          label="Meter name (optional)"
          value={draft.meter?.name}
          onChange={(value) =>
            set("meter", {
              hi: draft.meter?.hi ?? NaN,
              lo: draft.meter?.lo ?? NaN,
              name: value,
            })
          }
          maxLength={60}
          disabled={disabled}
        />
        <GlucoseField
          label="HI reads above"
          unit={unit}
          value={draft.meter?.hi}
          onChange={(value) =>
            set("meter", { ...draft.meter, lo: draft.meter?.lo ?? NaN, hi: value })
          }
          min={100}
          max={1000}
          required
          disabled={disabled}
          invalid={flagged("meter")}
        />
        <GlucoseField
          label="LO reads below"
          unit={unit}
          value={draft.meter?.lo}
          onChange={(value) =>
            set("meter", { ...draft.meter, hi: draft.meter?.hi ?? NaN, lo: value })
          }
          min={10}
          max={100}
          required
          disabled={disabled}
          invalid={flagged("meter")}
        />
      </ToggleGroup>
    </fieldset>
  );
}
