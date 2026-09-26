"use client";
import { useState, type FormEvent } from "react";
import { Check, Droplet, Loader2, Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { fromLocal, localInput, temperatureUnitLabels, type TemperatureUnit } from "@/lib/care";
import {
  TEMPERATURE_C_RANGE,
  checkInDetails,
  eatingLabels,
  eatingLevels,
  fluidsLabels,
  fluidsLevels,
  fromCelsius,
  illnessCheckInSchema,
  illnessLabel,
  illnessSymptomLabels,
  illnessSymptoms,
  toCelsius,
  withCheckIn,
  withoutCheckIn,
  type EatingLevel,
  type FluidsLevel,
  type IllnessCheckIn,
  type IllnessSymptom,
  type IllnessWindow,
} from "@/lib/illness";

function checkInTime(at: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

/** Check-ins as a timeline, oldest first. `onEdit` adds an edit button to each row. */
export function CheckInList({
  checkIns,
  timezone,
  unit,
  onEdit,
}: {
  checkIns: IllnessCheckIn[];
  timezone: string;
  unit: TemperatureUnit | undefined;
  onEdit?: (checkIn: IllnessCheckIn) => void;
}) {
  return (
    <ol className="check-in-list">
      {checkIns.map((checkIn) => (
        <li key={checkIn.id}>
          <time dateTime={checkIn.at}>{checkInTime(checkIn.at, timezone)}</time>
          <span>
            {checkInDetails(checkIn, unit).join(" · ")}
            {checkIn.note && <small>{checkIn.note}</small>}
          </span>
          {onEdit && (
            <button
              type="button"
              className="text-button"
              aria-label={`Edit check-in from ${checkInTime(checkIn.at, timezone)}`}
              onClick={() => onEdit(checkIn)}
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Toggle buttons for one optional choice: pressing the selected option clears it. */
function OptionalChoice<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <fieldset className="check-in-choice">
      <legend>{label}</legend>
      <div>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(value === option ? undefined : option)}
          >
            {labels[option]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Log or edit one timestamped observation during an illness. Saving stores the whole period
 * (so the change is audited and conflict-checked like any other period edit).
 */
export default function IllnessCheckInDialog({
  illness,
  timezone,
  initial,
  unit,
  saving,
  onClose,
  onSave,
  onLogKetones,
  onChooseUnit,
}: {
  illness: IllnessWindow;
  /** The care plan's zone: times are entered and shown in it, like every other entry. */
  timezone: string;
  initial: IllnessCheckIn | null;
  unit: TemperatureUnit | undefined;
  saving: boolean;
  onClose: () => void;
  onSave: (illness: IllnessWindow, message: string) => Promise<boolean>;
  onLogKetones: () => void;
  onChooseUnit: () => void;
}) {
  const zone = timezone;
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [at, setAt] = useState(() => localInput(new Date(initial?.at ?? Date.now()), zone));
  const [temperature, setTemperature] = useState(
    initial?.temperatureC !== undefined && unit
      ? String(fromCelsius(initial.temperatureC, unit))
      : "",
  );
  const [symptoms, setSymptoms] = useState<IllnessSymptom[]>(initial?.symptoms ?? []);
  const [vomited, setVomited] = useState(
    initial?.vomited !== undefined ? String(initial.vomited) : "",
  );
  const [fluids, setFluids] = useState<FluidsLevel | undefined>(initial?.fluids);
  const [eating, setEating] = useState<EatingLevel | undefined>(initial?.eating);
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  // A stored reading stays as recorded when no unit is chosen to edit it in.
  const keptTemperature = !unit ? initial?.temperatureC : undefined;
  const range = unit
    ? {
        min: fromCelsius(TEMPERATURE_C_RANGE.min, unit),
        max: fromCelsius(TEMPERATURE_C_RANGE.max, unit),
      }
    : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    let atIso: string;
    try {
      atIso = fromLocal(at, zone);
    } catch {
      setError("Enter a time that exists in this time zone.");
      return;
    }
    const parsed = illnessCheckInSchema.safeParse({
      id,
      at: atIso,
      temperatureC:
        temperature.trim() && unit ? toCelsius(Number(temperature), unit) : keptTemperature,
      symptoms: illnessSymptoms.filter((s) => symptoms.includes(s)),
      vomited: vomited.trim() ? Number(vomited) : undefined,
      fluids,
      eating,
      note: note.trim() || undefined,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.path[0] === "temperatureC" && range
          ? `Enter a temperature between ${range.min} and ${range.max} ${temperatureUnitLabels[unit!]}.`
          : (issue?.message ?? "Check this check-in."),
      );
      return;
    }
    let next: IllnessWindow;
    try {
      next = withCheckIn(illness, parsed.data, Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the check-in time.");
      return;
    }
    if (await onSave(next, initial ? "Check-in updated" : "Check-in saved")) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="care-dialog check-in-dialog">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit check-in" : "Log a check-in"}</DialogTitle>
          <DialogDescription>
            Illness · {illnessLabel(illness, timezone)}. Record only what you checked; every detail
            is optional.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="illness-form">
          <label className="field">
            <span>Time</span>
            <input
              type="datetime-local"
              required
              value={at}
              max={localInput(new Date(), zone)}
              onChange={(event) => setAt(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Temperature{unit ? ` (${temperatureUnitLabels[unit]})` : ""}</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={range?.min}
              max={range?.max}
              disabled={!unit}
              value={temperature}
              placeholder={
                keptTemperature !== undefined
                  ? `${keptTemperature} ${temperatureUnitLabels.C} (recorded)`
                  : undefined
              }
              onChange={(event) => setTemperature(event.target.value)}
            />
          </label>
          {!unit && (
            <p className="helper check-in-unit">
              Choose °F or °C in your care plan to record temperature.{" "}
              <button type="button" className="text-button" onClick={onChooseUnit}>
                Open care plan
              </button>
            </p>
          )}
          <fieldset className="check-in-symptoms">
            <legend>Symptoms</legend>
            <div>
              {illnessSymptoms.map((symptom) => (
                <label key={symptom} className="check-row">
                  <Checkbox
                    checked={symptoms.includes(symptom)}
                    onCheckedChange={(checked) =>
                      setSymptoms((current) =>
                        checked === true
                          ? [...current, symptom]
                          : current.filter((s) => s !== symptom),
                      )
                    }
                  />
                  <span>{illnessSymptomLabels[symptom]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span>Times vomited since the last check-in</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={50}
              step={1}
              value={vomited}
              placeholder="Leave blank if not checked"
              onChange={(event) => setVomited(event.target.value)}
            />
          </label>
          <OptionalChoice
            label="Fluids"
            options={fluidsLevels}
            labels={fluidsLabels}
            value={fluids}
            onChange={setFluids}
          />
          <OptionalChoice
            label="Eating"
            options={eatingLevels}
            labels={eatingLabels}
            value={eating}
            onChange={setEating}
          />
          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="check-in-ketones">
            <Droplet size={17} aria-hidden="true" />
            <span>Ketones are logged with a glucose reading, so sick-day timers see them.</span>
            <button type="button" className="button outline" onClick={onLogKetones}>
              Log glucose and ketones
            </button>
          </div>
          {error && (
            <p className="notice danger" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button primary full" disabled={saving}>
            {saving ? (
              <Loader2 size={17} className="spin" aria-hidden="true" />
            ) : (
              <Check size={17} aria-hidden="true" />
            )}
            {saving ? "Saving…" : "Save check-in"}
          </button>
          {initial && (
            <button
              type="button"
              className="text-button delete"
              disabled={saving}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={15} aria-hidden="true" />
              Delete this check-in
            </button>
          )}
        </form>
        <AlertDialog open={deleting} onOpenChange={setDeleting}>
          <AlertDialogContent>
            <AlertDialogTitle>Delete this check-in?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from this illness period, the daily log and reports.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>Keep check-in</AlertDialogCancel>
              <AlertDialogAction
                disabled={saving}
                className="danger-button"
                onClick={async (event) => {
                  event.preventDefault();
                  if (
                    initial &&
                    (await onSave(withoutCheckIn(illness, initial.id), "Check-in deleted"))
                  )
                    onClose();
                }}
              >
                Delete check-in
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
