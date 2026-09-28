"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ArrowUpRight, Calculator, Check, Link2, Loader2, Trash2, Utensils } from "lucide-react";
import { toast } from "sonner";
import { FoodPicker } from "./food-picker";
import { GlucoseField } from "./plan-settings-fields";
import {
  entrySchema,
  fromLocal,
  localInput,
  mealRatioLabels,
  type Entry,
  type FoodItem,
  type Plan,
  type SavedFood,
} from "@/lib/care";
import { formatGlucose, glucoseUnitOf } from "@/lib/glucose-units";

export type EntryModalKind = Entry["kind"];

/** One-shot prefill for the next time the dialog opens; ignored once the fields are edited. */
export type EntryPrefill = {
  at?: string;
  meal?: string;
  insulin?: string;
  dosePurpose?: string;
  carbs?: string;
  foodItems?: FoodItem[];
  note?: string;
  historicalDoseLog?: boolean;
  foodDoseSource?: Entry | null;
};

const fmt = (n: number) => Number(n.toFixed(2)).toString();

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="choice" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 1000,
  step = "any",
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: string;
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
        value={typeof value === "number" && !Number.isFinite(value) ? "" : value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** Keeps every logged field local so each keystroke re-renders this dialog, not the whole dashboard. */
export default function EntryDialog({
  modal,
  editing,
  prefill,
  plan,
  savedFoods,
  recentFoods,
  repeatMeals,
  editingLinks,
  lastRapid,
  lastBasal,
  basalToday,
  doseGlucoseText,
  doseGlucoseAge,
  saving,
  onSave,
  onDelete,
  onClose,
  onSaveFood,
  onDeleteFood,
  onOpenEntry,
  onOpenDoseFood,
  onCalculateAndLog,
}: {
  modal: EntryModalKind | null;
  editing: Entry | null;
  prefill: EntryPrefill | null;
  plan: Plan;
  savedFoods: SavedFood[];
  recentFoods: FoodItem[];
  repeatMeals: Entry[];
  editingLinks: Entry[];
  lastRapid: Entry | undefined;
  lastBasal: Entry | undefined;
  basalToday: Entry[];
  doseGlucoseText: string | null;
  doseGlucoseAge: number | null;
  saving: boolean;
  onSave: (entry: Entry, foodDoseSource: Entry | null) => Promise<boolean>;
  onDelete: (entry: Entry) => Promise<boolean>;
  onClose: () => void;
  onSaveFood: (food: SavedFood) => Promise<boolean>;
  onDeleteFood: (food: SavedFood) => Promise<boolean>;
  onOpenEntry: (kind: EntryModalKind, entry: Entry) => void;
  onOpenDoseFood: (dose: Entry) => void;
  onCalculateAndLog: (mode: "Carbs" | "Correction" | "Carbs + correction") => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [at, setAt] = useState(""),
    [glucose, setGlucose] = useState(NaN),
    [glucoseStatus, setGlucoseStatus] = useState<"High" | "Low" | null>(null),
    [source, setSource] = useState("Finger-stick"),
    [ketones, setKetones] = useState("Not checked"),
    [carbs, setCarbs] = useState(""),
    [lowSeverity, setLowSeverity] = useState("Mild"),
    [units, setUnits] = useState(""),
    [insulin, setInsulin] = useState("Rapid-acting"),
    [dosePurpose, setDosePurpose] = useState("Other / unknown"),
    [meal, setMeal] = useState("Meal"),
    [minutes, setMinutes] = useState(""),
    [intensity, setIntensity] = useState("Moderate"),
    [medication, setMedication] = useState(""),
    [note, setNote] = useState(""),
    [foodItems, setFoodItems] = useState<FoodItem[] | undefined>();
  const [foodPickerResetKey, setFoodPickerResetKey] = useState(0);
  const unit = glucoseUnitOf(plan);
  const foodDoseSource = prefill?.foodDoseSource ?? null;
  const historicalDoseLog = prefill?.historicalDoseLog ?? false;
  // A fresh open (new kind, new edited entry, or a new prefill payload) reseeds every field at once.
  useEffect(() => {
    if (!modal) return;
    setDeleting(false);
    setAt(prefill?.at ?? localInput(editing ? new Date(editing.at) : new Date(), plan.timezone));
    setGlucose(editing?.glucose ?? NaN);
    setGlucoseStatus(editing?.status ?? null);
    setSource(editing?.source ?? "Finger-stick");
    setKetones(editing?.ketones ?? "Not checked");
    setCarbs(prefill?.carbs ?? editing?.carbs?.toString() ?? "");
    setLowSeverity(editing?.lowSeverity ?? "Mild");
    setUnits(editing?.units?.toString() ?? "");
    setInsulin(prefill?.insulin ?? editing?.insulin ?? "Rapid-acting");
    setDosePurpose(prefill?.dosePurpose ?? editing?.purpose ?? "Other / unknown");
    setMeal(prefill?.meal ?? editing?.meal ?? "Meal");
    setMinutes(editing?.minutes?.toString() ?? "");
    setIntensity(editing?.intensity ?? "Moderate");
    setMedication(editing?.medication ?? (modal === "rescue" ? (plan.rescueMedication ?? "") : ""));
    setNote(prefill?.note ?? editing?.note ?? "");
    setFoodItems(modal === "food" ? (prefill?.foodItems ?? editing?.foodItems) : undefined);
    setFoodPickerResetKey((key) => key + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, editing, prefill]);
  const date = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: plan.timezone,
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  const time = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: plan.timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  function repeatMeal(entry: Entry) {
    if (!entry.foodItems?.length) return;
    const items = entry.foodItems.map((item) => ({ ...item }));
    setMeal(entry.meal ?? "Snack");
    setFoodItems(items);
    setCarbs(fmt(items.reduce((sum, item) => sum + item.carbs, 0)));
    setFoodPickerResetKey((key) => key + 1);
    setNote("");
  }
  async function saveEntry(e: FormEvent) {
    e.preventDefault();
    if (!modal) return;
    try {
      const entry = entrySchema.parse({
        id: editing?.id ?? crypto.randomUUID(),
        revision: editing?.revision,
        calculation:
          modal === "insulin" && insulin === editing?.insulin ? editing?.calculation : undefined,
        kind: modal,
        at: fromLocal(at, plan.timezone),
        glucose:
          modal === "glucose" && glucoseStatus === null && !Number.isNaN(glucose) ? glucose : null,
        status: modal === "glucose" ? glucoseStatus : null,
        source: modal === "glucose" ? source : null,
        ketones: modal === "glucose" ? ketones : null,
        carbs: modal === "food" && carbs !== "" ? Number(carbs) : null,
        foodItems: modal === "food" ? foodItems : undefined,
        meal: modal === "food" ? meal : null,
        lowSeverity: modal === "food" && meal === "Low treatment" ? lowSeverity : null,
        units: modal === "insulin" && units !== "" ? Number(units) : null,
        insulin: modal === "insulin" ? insulin : null,
        purpose: modal === "insulin" && insulin === "Rapid-acting" ? dosePurpose : null,
        minutes: modal === "exercise" && minutes !== "" ? Number(minutes) : null,
        intensity: modal === "exercise" ? intensity : null,
        medication: modal === "rescue" ? medication : null,
        note,
      });
      if (await onSave(entry, foodDoseSource)) onClose();
    } catch {
      toast.error("Check all values and the event time.");
    }
  }
  return (
    <Dialog
      open={modal !== null}
      onOpenChange={(v) => {
        if (!saving && !v) onClose();
      }}
    >
      <DialogContent className={`care-dialog${modal === "food" ? " food-entry-dialog" : ""}`}>
        <DialogHeader>
          <DialogTitle>
            {editing
              ? "Edit entry"
              : modal === "glucose"
                ? "Log a glucose reading"
                : modal === "food"
                  ? "Log a meal or snack"
                  : modal === "exercise"
                    ? "Log exercise"
                    : modal === "rescue"
                      ? "Record rescue medication given"
                      : modal === "correction-skipped"
                        ? "Log a skipped correction"
                        : "Record insulin given"}
          </DialogTitle>
          <DialogDescription>
            {modal === "insulin"
              ? "Enter the dose actually given. This form does not recommend a dose."
              : modal === "correction-skipped"
                ? `Record that no correction was given. The correction review restarts from this time, ${plan.correctionHours} hours later.`
                : "Keep a clear record for you and your care team."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={saveEntry} className="entry-form">
          {editingLinks.length > 0 && (
            <div className="linked-records">
              <strong>
                <Link2 size={16} />
                Linked meal + dose
              </strong>
              {editingLinks.map((record) => (
                <button
                  type="button"
                  className="button outline"
                  key={record.id}
                  onClick={() => onOpenEntry(record.kind, record)}
                >
                  {record.kind === "food"
                    ? `${record.meal} · ${fmt(record.carbs ?? 0)} g carbs`
                    : `${record.insulin} · ${fmt(record.units ?? 0)} units`}{" "}
                  · {date(record.at)}, {time(record.at)}
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          )}
          {editing?.kind === "insulin" &&
            editing.calculation &&
            editing.calculation.mode !== "Correction" &&
            editing.calculation.carbs > 0 &&
            !editing.calculation.foodEntryIds.length && (
              <button
                type="button"
                className="button outline"
                onClick={() => onOpenDoseFood(editing)}
              >
                <Utensils size={17} />
                Log food from this dose
              </button>
            )}
          {foodDoseSource && (
            <p className="notice">
              Add food from the {date(foodDoseSource.at)}, {time(foodDoseSource.at)} dose
              calculation. These food details already appear in the log and chart at the dose time.
              Confirm the food and its actual time below to save a separate linked food entry; the
              insulin dose stays unchanged.
            </p>
          )}
          {editing?.calculation && (
            <details className="original-calculation">
              <summary>Original calculation · preserved with this record</summary>
              <p>
                {editing.calculation.carbs} g carbs · {editing.calculation.calculatedUnits}{" "}
                calculated units · target {formatGlucose(editing.calculation.target, unit)}
                {editing.calculation.mode !== "Correction"
                  ? ` · ratio 1:${editing.calculation.ratio}${editing.calculation.ratioMeal ? ` · ${mealRatioLabels[editing.calculation.ratioMeal]}` : ""}`
                  : ""}
              </p>
              {editing.calculation.adjustment && (
                <p>
                  Original manual adjustment: {editing.calculation.adjustment.actualUnits} units
                  recorded
                  {editing.calculation.adjustment.reason
                    ? ` · ${editing.calculation.adjustment.reason}`
                    : ""}
                  . Acknowledged {date(editing.calculation.adjustment.acknowledgedAt)} at{" "}
                  {time(editing.calculation.adjustment.acknowledgedAt)}.
                </p>
              )}
              {editing.calculation.measuredAt && (
                <p>
                  Glucose measured {date(editing.calculation.measuredAt)} at{" "}
                  {time(editing.calculation.measuredAt)}.
                </p>
              )}
              <p>Editing the actual amount or note keeps this original calculation.</p>
            </details>
          )}
          {historicalDoseLog && modal === "insulin" && (
            <p className="notice timing-warning" role="status">
              Record only insulin already given. Enter the actual units and when the dose was given
              below. The earlier glucose reading does not produce a current correction calculation.
            </p>
          )}
          {modal === "insulin" && !editing && insulin === "Rapid-acting" && !historicalDoseLog && (
            <button
              type="button"
              className="button outline full"
              onClick={() => {
                onClose();
                onCalculateAndLog(
                  dosePurpose === "Meal + correction"
                    ? "Carbs + correction"
                    : dosePurpose === "Meal only"
                      ? "Carbs"
                      : "Correction",
                );
              }}
            >
              <Calculator size={17} />
              Calculate & log{" "}
              {dosePurpose === "Meal + correction"
                ? "meal + correction"
                : dosePurpose === "Meal only"
                  ? "meal coverage"
                  : "a correction"}{" "}
              dose
            </button>
          )}
          <label className="field">
            <span>
              {historicalDoseLog && modal === "insulin"
                ? "When was this dose given?"
                : "Date & time"}{" "}
              · {plan.timezone}
            </span>
            <input
              type="datetime-local"
              required
              value={at}
              onInput={(e) => setAt(e.currentTarget.value)}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
          {modal === "glucose" && (
            <>
              {glucoseStatus === null ? (
                <GlucoseField
                  label="Glucose"
                  unit={unit}
                  value={glucose}
                  min={20}
                  max={1000}
                  onChange={setGlucose}
                />
              ) : (
                <label className="field">
                  <span>Glucose ({unit})</span>
                  <input
                    type="text"
                    value={glucoseStatus === "High" ? "HI" : "LO"}
                    disabled
                    readOnly
                  />
                </label>
              )}
              <label className="field">
                <span>Meter reading</span>
                <div className="calc-modes" role="group" aria-label="Meter reading type">
                  {(["number", "High", "Low"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={(glucoseStatus ?? "number") === value ? "selected" : ""}
                      aria-pressed={(glucoseStatus ?? "number") === value}
                      onClick={() => {
                        setGlucoseStatus(value === "number" ? null : value);
                        setGlucose(NaN);
                      }}
                    >
                      {value === "number" ? "Number" : value === "High" ? "HI" : "LO"}
                    </button>
                  ))}
                </div>
              </label>
              {plan.meter && glucoseStatus && (
                <p className="helper">
                  {glucoseStatus === "High"
                    ? `${plan.meter.name ? `${plan.meter.name}: ` : ""}above ${formatGlucose(plan.meter.hi, unit)}`
                    : `${plan.meter.name ? `${plan.meter.name}: ` : ""}below ${formatGlucose(plan.meter.lo, unit)}`}
                </p>
              )}
              <div className="two-fields">
                <Choice
                  label="Source"
                  value={source}
                  onChange={setSource}
                  options={["Finger-stick", "Dexcom"]}
                />
                <Choice
                  label="Urine ketones"
                  value={ketones}
                  onChange={setKetones}
                  options={["Not checked", "Negative", "Trace", "Small", "Moderate", "Large"]}
                />
              </div>
              {(glucoseStatus === "High" ||
                (glucoseStatus === null && glucose > plan.ketoneCheckAbove)) && (
                <p className="notice">
                  Check ketones above {formatGlucose(plan.ketoneCheckAbove, unit)}. Call the
                  diabetes team for guidance. Large ketones with high glucose, vomiting or
                  confusion: seek emergency care.
                </p>
              )}
            </>
          )}
          {modal === "food" && (
            <>
              {!editing && repeatMeals.length > 0 && (
                <div className="quick-add-foods">
                  <div className="repeat-meals">
                    <strong>Repeat a recent meal</strong>
                    <div className="repeat-meals-list">
                      {repeatMeals.map((entry) => (
                        <button
                          type="button"
                          className="repeat-meal-row"
                          key={entry.id}
                          onClick={() => repeatMeal(entry)}
                        >
                          <span className="repeat-meal-info">
                            <span className="repeat-meal-name">
                              {entry.foodItems!.map((item) => item.name).join(" + ")}
                            </span>
                            <span className="repeat-meal-meta">
                              {entry.meal ?? "Meal"} · last {date(entry.at)}, {time(entry.at)}
                            </span>
                          </span>
                          <span className="repeat-meal-carbs">{entry.carbs} g</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <Choice
                label="Food type"
                value={meal}
                onChange={setMeal}
                options={[
                  "Breakfast",
                  "Morning snack",
                  "Lunch",
                  "Afternoon snack",
                  "Dinner",
                  "Evening snack",
                  "Overnight",
                  "Meal",
                  "Snack",
                  "Low treatment",
                ]}
              />
              <FoodPicker
                key={foodPickerResetKey}
                savedFoods={savedFoods}
                items={foodItems ?? []}
                onItemsChange={(items) => {
                  setFoodItems(items.length ? items : undefined);
                  setCarbs(
                    items.length ? fmt(items.reduce((sum, item) => sum + item.carbs, 0)) : "",
                  );
                }}
                onSaveFood={onSaveFood}
                onDeleteFood={onDeleteFood}
                recentFoods={recentFoods}
              />
              <NumberField
                label="Total carbohydrates eaten (g)"
                value={carbs}
                onChange={(value) => {
                  setCarbs(value);
                  setFoodItems(undefined);
                }}
              />
              {meal === "Low treatment" && (
                <Choice
                  label="Low severity"
                  value={lowSeverity}
                  onChange={setLowSeverity}
                  options={["Mild", "Moderate"]}
                />
              )}
            </>
          )}
          {modal === "insulin" && (
            <>
              <Choice
                label="Insulin"
                value={insulin}
                onChange={setInsulin}
                options={["Rapid-acting", "Long-acting"]}
              />
              {insulin === "Rapid-acting" && (
                <Choice
                  label="Dose purpose"
                  value={dosePurpose}
                  onChange={setDosePurpose}
                  options={["Meal only", "Correction only", "Meal + correction", "Other / unknown"]}
                />
              )}
              <NumberField
                label="Actual dose given (units)"
                value={units}
                min={0.5}
                max={100}
                step="0.5"
                onChange={setUnits}
              />
              {insulin === "Long-acting" && basalToday.length > 0 && !editing && (
                <p className="notice">
                  Long-acting is already recorded today. Check for a duplicate before saving.
                </p>
              )}
              {insulin === "Long-acting" && lastBasal && (
                <p className="notice">
                  Last Long-acting: {lastBasal.units} units on {date(lastBasal.at)} at{" "}
                  {time(lastBasal.at)}. Do not repeat a dose already given.
                </p>
              )}
              {insulin === "Rapid-acting" && (
                <div className="dose-log-context" role="status">
                  <p>
                    <strong>Latest verified glucose:</strong>{" "}
                    {doseGlucoseText ?? "No recent finger-stick or Share reading"}
                    {doseGlucoseAge !== null ? ` · ${doseGlucoseAge} min old` : ""}.
                  </p>
                  {doseGlucoseAge !== null && doseGlucoseAge > 10 && (
                    <p>
                      Reading is older than 10 minutes. Check a current glucose before calculating a
                      correction.
                    </p>
                  )}
                  <p>
                    <strong>Last Rapid-acting:</strong>{" "}
                    {lastRapid
                      ? `${lastRapid.units} units · ${date(lastRapid.at)} at ${time(lastRapid.at)}`
                      : "None recorded"}
                    .
                  </p>
                </div>
              )}
              {insulin === "Long-acting" && lastRapid && (
                <p className="helper">
                  Last recorded Rapid-acting: {lastRapid.units} units, {date(lastRapid.at)} at{" "}
                  {time(lastRapid.at)}.
                </p>
              )}
            </>
          )}
          {modal === "exercise" && (
            <>
              <NumberField
                label="Duration (minutes)"
                value={minutes}
                min={1}
                max={600}
                step="1"
                onChange={setMinutes}
              />
              <Choice
                label="Intensity"
                value={intensity}
                onChange={setIntensity}
                options={["Light", "Moderate", "Hard"]}
              />
            </>
          )}
          {modal === "rescue" && (
            <>
              <label className="field">
                <span>Medication given</span>
                <input
                  value={medication}
                  maxLength={60}
                  onChange={(e) => setMedication(e.target.value)}
                  placeholder="e.g. Baqsimi"
                />
              </label>
              <p className="notice">
                Record the emergency medication actually given for a severe low. Follow your care
                team’s instructions and call for help if needed.
              </p>
            </>
          )}
          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              value={note}
              maxLength={1000}
              onChange={(e) => {
                setNote(e.target.value);
              }}
              placeholder={
                modal === "correction-skipped"
                  ? "Why the correction was skipped"
                  : "Food, symptoms, or care-team instructions"
              }
            />
          </label>
          <button type="submit" className="button primary full" disabled={saving}>
            {saving ? <Loader2 className="spin" size={16} /> : <Check size={17} />}Save{" "}
            {editing ? "changes" : "entry"}
          </button>
          {editing && !deleting && (
            <button type="button" className="text-button delete" onClick={() => setDeleting(true)}>
              <Trash2 size={15} />
              Delete this entry
            </button>
          )}
          {editing && (
            <AlertDialog open={deleting} onOpenChange={setDeleting}>
              <AlertDialogContent>
                <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the selected entry from your care log.
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={saving}>Keep entry</AlertDialogCancel>
                  <AlertDialogAction
                    className="danger-button"
                    disabled={saving}
                    onClick={async (e) => {
                      e.preventDefault();
                      if (await onDelete(editing)) {
                        setDeleting(false);
                        onClose();
                      }
                    }}
                  >
                    Delete entry
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
