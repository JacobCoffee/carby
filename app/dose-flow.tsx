"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, RefreshCw, Calculator } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { toast } from "sonner";
import { MealRatioPicker } from "./meal-ratio-fields";
import { FoodPicker } from "./food-picker";
import DoseAmountField from "./dose-amount-field";
import { mealRatioAt } from "@/lib/report-analysis";
import { currentShareForCorrection } from "@/lib/correction-reading";
import { correctionReviewStatus } from "@/lib/correction-review";
import { isRecentReading } from "@/lib/reading-freshness";
import {
  currentDoseOverride,
  doseAmount,
  doseAdjustment,
  type DoseOverride,
} from "@/lib/dose-adjustment";
import { doseLogBlocker } from "@/lib/dose-log-blocker";
import { foodFromCalculation, foodItemsNote, mealLabel } from "@/lib/meal-log";
import {
  getCarbRatio,
  math,
  exactUnits,
  stepShortfall,
  localInput,
  fromLocal,
  entrySchema,
  type MealRatio,
  type Plan,
  type Entry,
  type CgmReading,
  type FoodItem,
  type SavedFood,
} from "@/lib/care";
import "./dose-flow.css";

type Mode = "Carbs" | "Correction" | "Carbs + correction";

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
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
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
        step="any"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ExactDose({
  raw,
  rounded,
  increment,
}: {
  raw: number;
  rounded: number;
  increment: number;
}) {
  const shortfall = stepShortfall(raw, rounded, { increment });
  return (
    <small className="dose-exact">
      Exact math {exactUnits(raw)} units
      {shortfall && ` · ${fmt(shortfall.short)} short of ${fmt(shortfall.next)}`}
    </small>
  );
}

export type DoseFlowProps = {
  open: boolean;
  onClose: () => void;
  initialMode: Mode;
  initialMeal?: MealRatio | null;
  initialCarbs?: string;
  initialFoodItems?: FoodItem[];
  initialLinkedFoodIds?: string[];
  savedFoods: SavedFood[];
  recentFoods: FoodItem[];
  onSaveFood: (food: SavedFood) => Promise<boolean>;
  onDeleteFood: (food: SavedFood) => Promise<boolean>;
  plan: Plan;
  entries: Entry[];
  cgm: CgmReading[];
  day: string;
  today: string;
  now: Date | null;
  dexcomConnected: boolean;
  dexcomLatestShareAt: string | null;
  dexcomBusy: boolean;
  onSyncDexcom: () => Promise<CgmReading | null>;
  saving: boolean;
  onSubmit: (records: {
    dose: Entry;
    glucoseEntry: Entry | null;
    foodEntry: Entry | null;
  }) => Promise<boolean>;
  onLogActualDose: (mode: Mode) => void;
};

export default function DoseFlow({
  open,
  onClose,
  initialMode,
  initialMeal = null,
  initialCarbs = "",
  initialFoodItems = [],
  initialLinkedFoodIds = [],
  savedFoods,
  recentFoods,
  onSaveFood,
  onDeleteFood,
  plan,
  entries,
  cgm,
  day,
  today,
  now,
  dexcomConnected,
  dexcomLatestShareAt,
  dexcomBusy,
  onSyncDexcom,
  saving,
  onSubmit,
  onLogActualDose,
}: DoseFlowProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [meal, setMeal] = useState<MealRatio | null>(initialMeal);
  const [glucose, setGlucose] = useState(""),
    [glucoseMode, setGlucoseMode] = useState<"number" | "High" | "Low">("number"),
    [source, setSource] = useState<"Finger-stick" | "Dexcom">("Finger-stick"),
    [measuredAt, setMeasuredAt] = useState(""),
    [autofilledShare, setAutofilledShare] = useState(false);
  const [carbs, setCarbs] = useState(initialCarbs);
  // Picked foods fill the carb total; typing a total by hand clears them. The key reseeds the picker.
  const [foodItems, setFoodItems] = useState<FoodItem[]>(initialFoodItems);
  const [pickerKey, setPickerKey] = useState(0);
  const [linkedFoodIds, setLinkedFoodIds] = useState<string[]>(initialLinkedFoodIds);
  const [override, setOverride] = useState<DoseOverride | null>(null);
  const [actualDose, setActualDose] = useState("");
  const [actualDoseDirty, setActualDoseDirty] = useState(false);
  const [doseAt, setDoseAt] = useState("");
  const [recordCalcGlucose, setRecordCalcGlucose] = useState(false);
  const [recordCalcFood, setRecordCalcFood] = useState(true);
  const [calcFoodAt, setCalcFoodAt] = useState("");
  const [calcFoodMeal, setCalcFoodMeal] = useState<Entry["meal"]>("Meal");
  const [adjustmentAcknowledgedAt, setAdjustmentAcknowledgedAt] = useState<string | null>(null);
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [recentDoseReviewed, setRecentDoseReviewed] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const submissionRef = useRef<{ doseId: string; glucoseId: string; foodId: string } | null>(null);

  function prefillFromShare() {
    const share = currentShareForCorrection(cgm, dexcomConnected, dexcomLatestShareAt, Date.now());
    if (share) {
      setGlucose(String(share.value));
      setGlucoseMode("number");
      setMeasuredAt(localInput(new Date(share.at), plan.timezone));
      setSource("Dexcom");
      setAutofilledShare(true);
      return true;
    }
    return false;
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setMeal(initialMeal ?? mealRatioAt(new Date(), plan.timezone));
    setCarbs(initialCarbs);
    setFoodItems(initialFoodItems);
    setPickerKey((key) => key + 1);
    setLinkedFoodIds(initialLinkedFoodIds);
    setOverride(null);
    setAdjustmentAcknowledgedAt(null);
    setAdjustmentReason("");
    setRecentDoseReviewed(false);
    setActualDoseDirty(false);
    setRecordCalcGlucose(false);
    setRecordCalcFood(true);
    setCalcFoodAt("");
    setChecksOpen(false);
    submissionRef.current = null;
    setDoseAt(localInput(new Date(), plan.timezone));
    if (initialMode === "Carbs") {
      setGlucose("");
      setGlucoseMode("number");
      setMeasuredAt("");
      setSource("Finger-stick");
      setAutofilledShare(false);
    } else if (!prefillFromShare()) {
      setGlucose("");
      setGlucoseMode("number");
      setMeasuredAt("");
      setSource("Finger-stick");
      setAutofilledShare(false);
    }
  }, [open]);

  function selectMode(next: Mode) {
    if (next !== mode) {
      if (next === "Carbs") {
        setGlucose("");
        setGlucoseMode("number");
        setMeasuredAt("");
        setSource("Finger-stick");
        setAutofilledShare(false);
      } else if (!glucose.trim() && glucoseMode === "number") {
        prefillFromShare();
      }
    }
    setMode(next);
  }

  function changeGlucose(value: string) {
    setGlucose(value);
    if (autofilledShare) {
      setMeasuredAt(value.trim() ? localInput(new Date(), plan.timezone) : "");
      setAutofilledShare(false);
    } else if (!value.trim()) setMeasuredAt("");
    else if (!glucose.trim()) setMeasuredAt(localInput(new Date(), plan.timezone));
  }

  /** Meter shows HI/LO instead of a number: never fabricate a value from it. */
  function selectGlucoseMode(next: "number" | "High" | "Low") {
    setGlucoseMode(next);
    setAutofilledShare(false);
    if (next === "number") {
      setGlucose("");
      setMeasuredAt("");
    } else {
      setGlucose("");
      setSource("Finger-stick");
      if (!measuredAt) setMeasuredAt(localInput(new Date(), plan.timezone));
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const share = await onSyncDexcom();
      if (share) {
        setGlucose(String(share.value));
        setGlucoseMode("number");
        setMeasuredAt(localInput(new Date(share.at), plan.timezone));
        setSource("Dexcom");
        setAutofilledShare(true);
      }
    } finally {
      setSyncing(false);
    }
  }

  const time = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: plan.timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  const fmtDate = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: plan.timezone,
      month: "short",
      day: "numeric",
    }).format(new Date(value));

  const needsCarbs = mode !== "Correction";
  const needsCorrection = mode !== "Carbs";
  const glucoseValue = glucoseMode === "number" && glucose.trim() !== "" ? Number(glucose) : null;
  const glucoseStatus: "High" | "Low" | null = glucoseMode === "number" ? null : glucoseMode;
  const hasReading = glucoseValue !== null || glucoseStatus !== null;
  let measuredInstant: string | null = null;
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(measuredAt)) {
    try {
      measuredInstant = fromLocal(measuredAt, plan.timezone);
    } catch {
      measuredInstant = null;
    }
  }
  const measuredRecently = isRecentReading(measuredInstant, now?.getTime() ?? NaN);
  const glucoseValid =
    glucoseValue === null ||
    (Number.isFinite(glucoseValue) && glucoseValue >= 20 && glucoseValue <= 1000);
  const low =
    glucoseStatus === "Low" || (glucoseValue !== null && glucoseValue < plan.lowThreshold);
  const carbRatio = getCarbRatio(plan, meal);
  const linkedFoods = linkedFoodIds
    .map((id) => entries.find((e) => e.id === id && e.kind === "food"))
    .filter((e): e is Entry => !!e);
  const linkedCarbTotal = linkedFoodIds.length
    ? linkedFoods.reduce((sum, e) => sum + (e.carbs ?? 0), 0)
    : null;
  const manualCarbs = carbs.trim() === "" ? null : Number(carbs);
  const enteredCarbs = linkedFoodIds.length ? linkedCarbTotal : manualCarbs;
  const carbsValid =
    enteredCarbs !== null &&
    Number.isFinite(enteredCarbs) &&
    enteredCarbs >= 0 &&
    enteredCarbs <= 1000;

  const hour = now
    ? Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: plan.timezone,
          hour: "2-digit",
          hourCycle: "h23",
        }).format(now),
      )
    : 12;
  const overnight = hour >= 22 || hour < 6;

  const lastRapid = entries.find(
    (e) =>
      e.kind === "insulin" &&
      e.insulin === "Rapid-acting" &&
      (!now || Date.parse(e.at) <= now.getTime()),
  );
  const lastCorrection = entries.find(
    (e) =>
      e.kind === "insulin" &&
      e.insulin === "Rapid-acting" &&
      (e.purpose === "Correction only" || e.purpose === "Meal + correction") &&
      (!now || Date.parse(e.at) <= now.getTime()),
  );
  const correctionReview = correctionReviewStatus(
    lastCorrection?.at,
    now?.getTime() ?? NaN,
    plan.timezone,
    plan.correctionHours,
  );
  const correctionInWindow =
    !!correctionReview && !!now && now.getTime() < Date.parse(correctionReview.at);
  const recentRapid =
    !!lastRapid &&
    !!now &&
    now.getTime() - Date.parse(lastRapid.at) < plan.correctionHours * 60 * 60 * 1000;
  const recentUnknownRapid =
    !!lastRapid &&
    (!lastRapid.purpose || lastRapid.purpose === "Other / unknown") &&
    !!now &&
    now.getTime() - Date.parse(lastRapid.at) < plan.correctionHours * 60 * 60 * 1000;
  const doseReviewRequired =
    mode !== "Carbs" && (correctionInWindow || recentRapid || recentUnknownRapid);
  // Reset the acknowledgment whenever the relevant insulin history changes underneath it.
  const insulinReviewContext = entries
    .filter((entry) => entry.kind === "insulin" && entry.insulin === "Rapid-acting")
    .map((entry) => [entry.id, entry.revision, entry.at, entry.units, entry.purpose].join("|"))
    .join(";");
  useEffect(() => {
    setRecentDoseReviewed(false);
  }, [insulinReviewContext]);

  const include =
    needsCorrection && glucoseValue !== null && glucoseValid && !low && measuredRecently;
  const calcReady =
    (!needsCarbs || (carbsValid && carbRatio !== null)) && (!needsCorrection || include);
  const result = math(
    glucoseValue,
    needsCarbs && carbRatio !== null ? (enteredCarbs ?? 0) : 0,
    plan,
    include,
    meal,
  );
  const overrideContext = JSON.stringify({
    mode,
    meal,
    carbs,
    glucose,
    glucoseMode,
    source,
    measuredAt,
    linkedFoodIds,
  });
  const activeOverride = currentDoseOverride(override, overrideContext);
  useEffect(() => {
    if (override && override.context !== overrideContext) setOverride(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [override, overrideContext]);
  const amountToRecord = activeOverride ? doseAmount(activeOverride.units) : result.rounded;

  // Keep the actual-dose field tracking the plan result until the caregiver edits it directly.
  useEffect(() => {
    if (calcReady && !actualDoseDirty && amountToRecord !== null)
      setActualDose(fmt(amountToRecord));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcReady, amountToRecord, activeOverride?.units, mode]);

  const actualDoseValid = doseAmount(actualDose) !== null && Number(actualDose) > 0;
  const actualDoseAdjusted = actualDoseValid && Number(actualDose) !== result.rounded;
  const logBlocker = doseLogBlocker({
    needsCarbs,
    carbsValid,
    carbRatioSet: carbRatio !== null,
    needsCorrection,
    hasReading,
    low,
    correctionReady: include,
    roundedUnits: result.rounded,
    recordUnits: amountToRecord,
    actualDoseValid,
    reviewRequired: doseReviewRequired,
    reviewed: recentDoseReviewed,
  });

  const checks: string[] = [];
  if (needsCorrection) {
    checks.push(
      lastRapid
        ? `Last Rapid-acting: ${lastRapid.units} units · ${fmtDate(lastRapid.at)}, ${time(lastRapid.at)}${lastRapid.purpose ? ` · ${lastRapid.purpose}` : ""}.`
        : "No Rapid-acting dose is recorded; check the full history.",
    );
    if (correctionReview)
      checks.push(
        `${correctionReview.notice} Check current glucose, ketones, symptoms, and other recent insulin before any dose.`,
      );
    if (recentUnknownRapid)
      checks.push(
        "A recent Rapid-acting dose has unknown purpose; verify whether it contained a correction.",
      );
    if (!lastCorrection)
      checks.push(
        "No correction dose is classified in the log. Earlier doses may have included one.",
      );
    if (overnight) checks.push("Overnight corrections need the diabetes team’s instructions.");
    if (source === "Dexcom")
      checks.push(
        "Use a finger-stick if the reading does not match symptoms or to confirm a high or low.",
      );
  }
  if (linkedFoodIds.length && day !== today)
    checks.push(
      "Past-day food is for review. Use Log insulin to record a dose already given if needed.",
    );
  checks.push(
    "This is formula math, not a recommendation to give insulin. Check all doses, active insulin, ketones, symptoms, and your current care instructions before deciding.",
  );

  const foodLoggable = needsCarbs && carbsValid && (enteredCarbs ?? 0) > 0 && !linkedFoodIds.length;
  useEffect(() => {
    setRecordCalcFood(foodLoggable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodLoggable]);
  useEffect(() => {
    setCalcFoodMeal(mealLabel(meal ?? undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meal]);

  function unlinkFoods() {
    setCarbs(linkedCarbTotal !== null ? fmt(linkedCarbTotal) : "");
    setLinkedFoodIds([]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!calcReady || result.rounded <= 0) return;
    if (override && (doseAmount(override.units) === null || Number(override.units) <= 0)) {
      toast.error("Enter a positive actual dose to record.");
      return;
    }
    if (mode !== "Carbs" && !isRecentReading(measuredInstant, Date.now())) {
      toast.error("Enter a fresh glucose reading and the time it was measured.");
      return;
    }
    if (linkedFoodIds.length) {
      const stillLinked = linkedFoodIds.filter((id) =>
        entries.some((e) => e.id === id && e.kind === "food"),
      );
      if (stillLinked.length !== linkedFoodIds.length) {
        toast.error(
          "Selected food changed or was removed. Review the food entries before calculating again.",
        );
        return;
      }
      if (day !== today) {
        toast.error("Past-day food is for review. Use Log insulin to record a dose already given.");
        return;
      }
    }
    if (doseReviewRequired && !recentDoseReviewed) {
      toast.error("Review recent Rapid-acting before recording a correction.");
      return;
    }
    if (!actualDoseValid) {
      toast.error("Enter the actual dose given.");
      return;
    }
    let adjustment;
    try {
      adjustment = doseAdjustment(
        result.rounded,
        actualDose,
        adjustmentAcknowledgedAt,
        adjustmentReason,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Acknowledge the manual dose adjustment.");
      return;
    }
    try {
      const doseInstant = fromLocal(doseAt, plan.timezone);
      if (measuredInstant && Date.parse(doseInstant) < Date.parse(measuredInstant)) {
        toast.error("The dose time must be at or after the glucose measurement.");
        return;
      }
      const submission = (submissionRef.current ??= {
        doseId: crypto.randomUUID(),
        glucoseId: crypto.randomUUID(),
        foodId: crypto.randomUUID(),
      });
      const willLogFood = recordCalcFood && foodLoggable;
      const calculation = {
        mode,
        carbs: enteredCarbs ?? 0,
        glucose: mode === "Carbs" ? null : glucoseValue,
        source: mode === "Carbs" ? null : source,
        measuredAt: mode === "Carbs" ? null : measuredInstant,
        foodEntryIds: linkedFoodIds,
        foodDescription: (willLogFood && foodItems.length && foodItemsNote(foodItems)) || undefined,
        calculatedUnits: result.rounded,
        target: plan.target,
        factor: plan.factor,
        ratio: mode === "Correction" ? plan.ratio : carbRatio!,
        ...(mode !== "Correction" && meal ? { ratioMeal: meal } : {}),
        increment: plan.increment,
        rounding: plan.rounding,
      };
      const foodEntry = willLogFood
        ? foodFromCalculation(
            submission.foodId,
            fromLocal(calcFoodAt || doseAt, plan.timezone),
            calculation,
            calcFoodMeal,
            foodItems,
          )
        : null;
      const dose = entrySchema.parse({
        id: submission.doseId,
        kind: "insulin",
        at: doseInstant,
        glucose: null,
        source: null,
        ketones: null,
        carbs: null,
        units: Number(actualDose),
        insulin: "Rapid-acting",
        purpose:
          mode === "Carbs"
            ? "Meal only"
            : mode === "Correction"
              ? "Correction only"
              : "Meal + correction",
        calculation: {
          ...calculation,
          foodLog: foodEntry || linkedFoodIds.length ? "separate" : "dose-only",
          foodEntryIds: foodEntry ? [foodEntry.id] : linkedFoodIds,
          adjustment,
        },
        meal: null,
        note: [
          measuredInstant
            ? `Glucose measured ${fmtDate(measuredInstant)} at ${time(measuredInstant)} (${plan.timezone}).`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
      const needsGlucoseEntry = hasReading && (source === "Finger-stick" || recordCalcGlucose);
      const alreadyLogged =
        source === "Finger-stick" &&
        entries.some(
          (entry) =>
            entry.kind === "glucose" &&
            entry.source === "Finger-stick" &&
            (glucoseStatus ? entry.status === glucoseStatus : entry.glucose === glucoseValue) &&
            measuredInstant &&
            Math.abs(Date.parse(entry.at) - Date.parse(measuredInstant)) < 60_000,
        );
      const glucoseEntry =
        needsGlucoseEntry && !alreadyLogged && measuredInstant
          ? entrySchema.parse({
              id: submission.glucoseId,
              kind: "glucose",
              at: measuredInstant,
              glucose: glucoseValue,
              status: glucoseStatus,
              source,
              ketones: "Not checked",
              carbs: null,
              units: null,
              insulin: null,
              meal: null,
              note: "Recorded with insulin calculation",
            })
          : null;
      const ok = await onSubmit({ dose, glucoseEntry, foodEntry });
      if (ok) {
        toast.success(
          foodEntry
            ? "Food and dose recorded as linked entries"
            : glucoseEntry
              ? "Dose and glucose recorded"
              : "Dose recorded",
        );
        onClose();
      }
    } catch {
      toast.error("Check the actual dose and event times. Nothing was saved.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="care-dialog dose-flow-dialog">
        <DialogHeader>
          <DialogTitle>Insulin calculator</DialogTitle>
          <DialogDescription>
            Glucose, food, and the dose given, recorded together. Plan math only, not dosing advice.
          </DialogDescription>
        </DialogHeader>
        <form className="entry-form dose-flow" onSubmit={handleSubmit}>
          <div className="calc-modes" role="group" aria-label="Calculation mode">
            {(["Carbs", "Correction", "Carbs + correction"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={mode === value ? "selected" : ""}
                aria-pressed={mode === value}
                onClick={() => selectMode(value)}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="dose-flow-columns">
            <div className="dose-flow-col-left">
              {needsCorrection && (
                <section className="dose-flow-section">
                  <h3>Glucose</h3>
                  <div className="dose-flow-glucose-row">
                    {glucoseMode === "number" ? (
                      <NumberField
                        label="Reading (mg/dL)"
                        value={glucose}
                        min={20}
                        onChange={changeGlucose}
                        placeholder="Enter a fresh reading"
                      />
                    ) : (
                      <label className="field">
                        <span>Reading (mg/dL)</span>
                        <input
                          type="text"
                          value={glucoseMode === "High" ? "HI" : "LO"}
                          disabled
                          readOnly
                        />
                      </label>
                    )}
                    <div className="field">
                      <span>Meter shows</span>
                      <div className="calc-modes" role="group" aria-label="Meter reading type">
                        {(["number", "High", "Low"] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={glucoseMode === value ? "selected" : ""}
                            aria-pressed={glucoseMode === value}
                            onClick={() => selectGlucoseMode(value)}
                          >
                            {value === "number" ? "Number" : value === "High" ? "HI" : "LO"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="dose-flow-glucose-row">
                    <Choice
                      label="Reading source"
                      value={source}
                      onChange={(value) => {
                        setSource(value as "Finger-stick" | "Dexcom");
                        if (autofilledShare) {
                          setGlucose("");
                          setMeasuredAt("");
                          setAutofilledShare(false);
                        }
                      }}
                      options={["Finger-stick", "Dexcom"]}
                    />
                    {dexcomConnected && (
                      <button
                        type="button"
                        className="button subtle dose-flow-sync-button"
                        disabled={dexcomBusy || syncing}
                        onClick={() => void handleSync()}
                      >
                        {dexcomBusy || syncing ? (
                          <Loader2 size={16} className="spin" />
                        ) : (
                          <RefreshCw size={16} />
                        )}
                        Sync & use Dexcom
                      </button>
                    )}
                  </div>
                  {autofilledShare ? (
                    <p className="helper" role="status">
                      Prefilled from live Dexcom Share at{" "}
                      {measuredInstant ? time(measuredInstant) : "—"}.{" "}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setGlucose("");
                          setMeasuredAt("");
                          setSource("Finger-stick");
                          setAutofilledShare(false);
                        }}
                      >
                        Enter my own reading
                      </button>
                    </p>
                  ) : (
                    !glucose &&
                    glucoseMode === "number" && (
                      <p className="helper" role="status">
                        No current numeric Share reading is available here. Enter a new finger-stick
                        or current Dexcom value; Clarity exports are not used for correction math.
                        If the meter shows HI or LO, select it above instead of a number.
                      </p>
                    )
                  )}
                  <div className="care-workspace-measured-row">
                    <label className="field care-workspace-measured-at">
                      <span>When was this glucose measured? · {plan.timezone}</span>
                      <input
                        type="datetime-local"
                        max={now ? localInput(now, plan.timezone) : undefined}
                        value={measuredAt}
                        disabled={autofilledShare}
                        onChange={(event) => {
                          setMeasuredAt(event.target.value);
                          setAutofilledShare(false);
                        }}
                      />
                    </label>
                    {!autofilledShare && (
                      <button
                        type="button"
                        className="button subtle care-workspace-now"
                        onClick={() => setMeasuredAt(localInput(new Date(), plan.timezone))}
                      >
                        Now
                      </button>
                    )}
                  </div>
                  {glucoseValue !== null && !glucoseValid && (
                    <p className="notice danger">Enter glucose between 20 and 1000 mg/dL.</p>
                  )}
                  {hasReading && glucoseValid && low && (
                    <p className="notice danger" role="alert">
                      {glucoseStatus === "Low"
                        ? "LO: follow your low-glucose plan. No correction math shown."
                        : `Below ${plan.lowThreshold}: follow your low-glucose plan. No correction math shown.`}
                    </p>
                  )}
                  {hasReading && glucoseValid && !low && glucoseStatus === "High" && (
                    <p className="notice danger" role="alert">
                      HI has no exact numeric value, so no correction can be calculated from it.
                      Enter a numeric reading (a different meter or a repeat check) to calculate a
                      correction.
                    </p>
                  )}
                  {hasReading &&
                    glucoseValid &&
                    !low &&
                    (glucoseStatus === "High" ||
                      (glucoseValue !== null && glucoseValue > plan.ketoneCheckAbove)) && (
                      <p className="notice timing-warning" role="alert">
                        Check ketones above {plan.ketoneCheckAbove}. High glucose with large ketones
                        needs emergency evaluation.
                      </p>
                    )}
                  {hasReading && glucoseValid && !low && !measuredRecently && (
                    <p className="notice timing-warning" role="alert">
                      {measuredInstant
                        ? `The ${time(measuredInstant)} glucose reading is older than 10 minutes. Get a current reading before using correction math.`
                        : "Enter when this glucose was measured. Correction math requires a reading from the last 10 minutes."}
                    </p>
                  )}
                  {recentRapid && (
                    <p className="notice timing-warning" role="alert">
                      Rapid-acting was given within the saved review interval and may still be
                      working. The calculator does not account for it.
                    </p>
                  )}
                </section>
              )}

              {needsCarbs && (
                <section className="dose-flow-section">
                  <h3>Food</h3>
                  <MealRatioPicker plan={plan} value={meal} onChange={setMeal} />
                  {linkedFoodIds.length > 0 ? (
                    <div className="linked-foods dose-flow-linked-foods">
                      <strong>Linked food entries</strong>
                      {linkedFoods.map((food) => (
                        <p key={food.id}>
                          {food.meal} · {food.carbs} g · {fmtDate(food.at)}, {time(food.at)}
                        </p>
                      ))}
                      <button type="button" className="text-button" onClick={unlinkFoods}>
                        Unlink and enter carbs manually
                      </button>
                    </div>
                  ) : (
                    <>
                      <FoodPicker
                        key={pickerKey}
                        savedFoods={savedFoods}
                        items={foodItems}
                        onItemsChange={(items) => {
                          setFoodItems(items);
                          setCarbs(
                            items.length
                              ? fmt(items.reduce((sum, item) => sum + item.carbs, 0))
                              : "",
                          );
                        }}
                        onSaveFood={onSaveFood}
                        onDeleteFood={onDeleteFood}
                        recentFoods={recentFoods}
                      />
                      <NumberField
                        label="Carbohydrates to cover (g)"
                        value={carbs}
                        onChange={(value) => {
                          setCarbs(value);
                          if (foodItems.length) {
                            setFoodItems([]);
                            setPickerKey((key) => key + 1);
                          }
                        }}
                        placeholder="Pick foods above or enter carbs eaten"
                      />
                    </>
                  )}
                  {needsCarbs && carbs.trim() !== "" && !linkedFoodIds.length && !carbsValid && (
                    <p className="notice danger">Enter carbohydrates between 0 and 1000 g.</p>
                  )}
                  {needsCarbs &&
                    meal === "snack" &&
                    plan.snackInsulinFromCarbs !== undefined &&
                    carbsValid &&
                    (enteredCarbs ?? 0) > 0 &&
                    (enteredCarbs ?? 0) < plan.snackInsulinFromCarbs && (
                      <p className="notice" role="status">
                        Your care plan: no insulin for snacks under {plan.snackInsulinFromCarbs} g.
                      </p>
                    )}
                </section>
              )}
            </div>

            <div className="dose-flow-col-right">
              <div className="dose-flow-scroll-top">
                {doseReviewRequired && (
                  <div className="notice timing-warning dose-flow-review-gate" role="alert">
                    <label className="check-row">
                      <Checkbox
                        checked={recentDoseReviewed}
                        onCheckedChange={(value) => setRecentDoseReviewed(value === true)}
                      />
                      <span>
                        I reviewed the last Rapid-acting dose, timing, active insulin, and current
                        care instructions before this correction. See Checks below for details.
                      </span>
                    </label>
                  </div>
                )}

                <details
                  className="dose-flow-checks"
                  open={checksOpen}
                  onToggle={(event) => setChecksOpen(event.currentTarget.open)}
                >
                  <summary>Checks ({checks.length})</summary>
                  {checks.map((message) => (
                    <p className="notice" key={message}>
                      {message}
                    </p>
                  ))}
                </details>
                <div className="dose-adjustment">
                  {activeOverride ? (
                    <>
                      <div className="dose-adjustment-heading">
                        <strong>Manual adjustment</strong>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setOverride(null)}
                        >
                          Use plan result
                        </button>
                      </div>
                      <DoseAmountField
                        label="Adjusted amount to record (units)"
                        value={activeOverride.units}
                        increment={plan.increment}
                        disabled={!calcReady}
                        onChange={(units) => setOverride({ ...activeOverride, units })}
                      />
                      <p className="helper">
                        Plan math stays at {fmt(result.rounded)} units. The amount above is your
                        manual entry.
                      </p>
                      <label className="field">
                        <span>Reason (optional)</span>
                        <input
                          value={activeOverride.reason}
                          maxLength={500}
                          onChange={(event) =>
                            setOverride({ ...activeOverride, reason: event.target.value })
                          }
                          placeholder="Why the recorded amount differs"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <p className="helper">
                        Recording a different amount? Review recent insulin and current care
                        instructions before adjusting.
                      </p>
                      <button
                        type="button"
                        className="button outline full"
                        disabled={!calcReady || result.rounded <= 0}
                        onClick={() =>
                          setOverride({
                            context: overrideContext,
                            units: String(result.rounded),
                            reason: "",
                            acknowledgedAt: new Date().toISOString(),
                          })
                        }
                      >
                        Acknowledge &amp; adjust dose
                      </button>
                    </>
                  )}
                </div>
                {needsCorrection && !measuredRecently && (
                  <button
                    type="button"
                    className="button outline full"
                    onClick={() => onLogActualDose(mode)}
                  >
                    <Calculator size={17} />
                    Already gave a dose? Log actual insulin without calculation
                  </button>
                )}
                <p className="helper dose-flow-atomic-note">
                  Glucose, food, and this dose save together in one step — if anything fails,
                  nothing is recorded.
                </p>
              </div>
              <div className="dose-flow-pinned">
                <section className="dose-flow-section">
                  <h3>Result</h3>
                  <div className="math-breakdown">
                    {needsCarbs && (
                      <div>
                        <span>Food coverage</span>
                        <span>
                          {carbsValid && carbRatio !== null
                            ? `${fmt(enteredCarbs!)} ÷ ${carbRatio} = ${exactUnits(result.food)} units`
                            : "—"}
                        </span>
                      </div>
                    )}
                    {needsCorrection && (
                      <div>
                        <span>Glucose correction</span>
                        <span>
                          {include
                            ? `(${glucoseValue} − ${plan.target}) ÷ ${plan.factor} = ${exactUnits(result.correction)} units`
                            : "—"}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="calc-result" aria-live="polite">
                    <div>
                      <span>{mode} · plan math</span>
                      <p>
                        {plan.rounding === "down" ? "Rounded down" : "Rounded to nearest"} ·{" "}
                        {plan.increment}
                        -unit steps
                      </p>
                      {calcReady && (
                        <ExactDose
                          raw={result.raw}
                          rounded={result.rounded}
                          increment={plan.increment}
                        />
                      )}
                    </div>
                    <strong>
                      {calcReady ? fmt(result.rounded) : "—"}
                      <small> units</small>
                    </strong>
                  </div>
                </section>

                <section className="dose-flow-section dose-flow-log">
                  <h3>Log it</h3>
                  <DoseAmountField
                    label="Actual Rapid-acting given (units)"
                    value={actualDose}
                    increment={plan.increment}
                    disabled={saving}
                    onChange={(value) => {
                      setActualDose(value);
                      setActualDoseDirty(true);
                    }}
                  />
                  {actualDoseAdjusted && (
                    <div className="dose-adjustment">
                      <p>
                        <strong>
                          Plan math: {fmt(result.rounded)} units · Actual given: {actualDose} units
                        </strong>
                      </p>
                      <label className="field">
                        <span>Adjustment reason (optional)</span>
                        <input
                          value={adjustmentReason}
                          maxLength={500}
                          disabled={saving}
                          onChange={(event) => setAdjustmentReason(event.target.value)}
                        />
                      </label>
                      <label className="check-row">
                        <Checkbox
                          checked={!!adjustmentAcknowledgedAt}
                          disabled={saving}
                          onCheckedChange={(value) =>
                            setAdjustmentAcknowledgedAt(
                              value === true ? new Date().toISOString() : null,
                            )
                          }
                        />
                        <span>
                          I acknowledge the manual adjustment and have reviewed recent insulin and
                          current care instructions.
                        </span>
                      </label>
                    </div>
                  )}
                  {foodLoggable && (
                    <div className="paired-food-log">
                      <label className="check-row">
                        <Checkbox
                          checked={recordCalcFood}
                          disabled={saving}
                          onCheckedChange={(value) => setRecordCalcFood(value === true)}
                        />
                        <span>
                          Also log{" "}
                          {foodItems.length
                            ? foodItems.map((item) => item.name).join(", ")
                            : `${fmt(enteredCarbs ?? 0)} g of food`}{" "}
                          as a separate linked entry
                        </span>
                      </label>
                      {recordCalcFood && (
                        <>
                          <Choice
                            label="Food type"
                            value={calcFoodMeal ?? "Meal"}
                            onChange={(value) => setCalcFoodMeal(value as Entry["meal"])}
                            options={[
                              "Breakfast",
                              "Lunch",
                              "Dinner",
                              "Snack",
                              "Meal",
                              "Low treatment",
                            ]}
                          />
                          <label className="field">
                            <span>When was the food eaten? · {plan.timezone}</span>
                            <input
                              type="datetime-local"
                              required
                              value={calcFoodAt || doseAt}
                              onChange={(event) => setCalcFoodAt(event.target.value)}
                            />
                          </label>
                        </>
                      )}
                    </div>
                  )}
                  <label className="field">
                    <span>Dose date & time · {plan.timezone}</span>
                    <input
                      type="datetime-local"
                      required
                      value={doseAt}
                      onChange={(event) => setDoseAt(event.target.value)}
                    />
                  </label>
                  {hasReading &&
                    (source === "Finger-stick" ? (
                      <p className="helper">
                        This finger-stick will also be logged as a glucose reading at its measured
                        time when you log the dose. An identical reading already in the log is
                        skipped.
                      </p>
                    ) : (
                      <label className="check-row">
                        <Checkbox
                          checked={recordCalcGlucose}
                          onCheckedChange={(value) => setRecordCalcGlucose(value === true)}
                        />
                        <span>
                          Also log the{" "}
                          {glucoseStatus === "High"
                            ? "HI"
                            : glucoseStatus === "Low"
                              ? "LO"
                              : `${glucoseValue} mg/dL`}{" "}
                          Dexcom reading
                        </span>
                      </label>
                    ))}
                  <button
                    type="submit"
                    className="button primary full calc-log-button"
                    disabled={saving || logBlocker !== null}
                    aria-describedby={logBlocker ? "calc-log-blocker" : undefined}
                  >
                    {saving ? "Recording…" : "Log it"}
                  </button>
                  {logBlocker && (
                    <p id="calc-log-blocker" className="helper" role="status">
                      {logBlocker}
                    </p>
                  )}
                </section>
              </div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
