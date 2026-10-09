"use client";
import { useState, type FormEvent } from "react";
import { Check, ClipboardPlus, Loader2, Sun, Trash2 } from "lucide-react";
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
import {
  illnessSchema,
  endPeriodNow,
  validateIllnessDates,
  periodKind,
  periodKindLabels,
  type IllnessCheckIn,
  type IllnessWindow,
  type PeriodKind,
} from "@/lib/illness";
import { dateKey, type TemperatureUnit } from "@/lib/care";
import { CheckInList } from "./illness-check-in-dialog";

export default function IllnessDialog({
  initial,
  startAt,
  timezone,
  day,
  unit,
  onCheckIn,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  initial: IllnessWindow | null;
  /** A new period's start as a local date-time input value; without it, the day, all day. */
  startAt?: string;
  timezone: string;
  day: string;
  unit: TemperatureUnit | undefined;
  /** Close this dialog and open the check-in editor (null = new check-in) for a saved period. */
  onCheckIn: (illnessId: string, checkIn: IllnessCheckIn | null) => void;
  saving: boolean;
  onClose: () => void;
  /** `ended` is true when the period was closed with "All better". */
  onSave: (illness: IllnessWindow, ended?: boolean) => Promise<boolean>;
  onDelete: (illness: IllnessWindow) => Promise<boolean>;
}) {
  const zone = initial?.timezone ?? timezone;
  const today = dateKey(new Date(), zone);
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [kind, setKind] = useState<PeriodKind>(initial ? periodKind(initial) : "illness");
  const [startDate, setStartDate] = useState(
    initial?.startDate ?? startAt?.slice(0, 10) ?? (day && day <= today ? day : today),
  );
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [ongoing, setOngoing] = useState(!initial?.endDate);
  const [allDay, setAllDay] = useState(initial ? !initial.startTime && !initial.endTime : !startAt);
  const [startTime, setStartTime] = useState(initial?.startTime ?? startAt?.slice(11, 16) ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const isSickKind = kind === "illness";
  const dirty =
    !!initial &&
    (kind !== periodKind(initial) ||
      startDate !== initial.startDate ||
      (startTime || undefined) !== initial.startTime ||
      (ongoing ? null : endDate) !== initial.endDate ||
      (endTime || undefined) !== initial.endTime ||
      note !== initial.note);
  function formPeriod() {
    return illnessSchema.safeParse({
      id,
      revision: initial?.revision,
      kind,
      startDate,
      startTime: allDay || !startTime ? undefined : startTime,
      endDate: ongoing ? null : endDate,
      endTime: allDay || ongoing || !endTime ? undefined : endTime,
      timezone: zone,
      note,
      // Check-ins are edited in their own dialog; a period edit keeps them as saved.
      checkIns: initial?.checkIns,
    });
  }
  /** Saves the period, then closes, or hands over to `next` (such as the check-in editor). */
  async function save(period: IllnessWindow | null, ended = false, next = onClose) {
    if (!period) return;
    try {
      validateIllnessDates(period, Date.now());
      if (await onSave(period, ended)) next();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the dates.");
    }
  }
  async function submit(event: FormEvent, next?: () => void) {
    event.preventDefault();
    setError("");
    const parsed = formPeriod();
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the dates.");
      return;
    }
    await save(parsed.data, false, next);
  }
  // A check-in belongs to a saved period, so a new or changed one is saved first.
  const saveFirst = !initial || dirty;
  async function endNow() {
    setError("");
    const parsed = formPeriod();
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the dates.");
      return;
    }
    const now = Date.now();
    const ended = illnessSchema.safeParse(endPeriodNow(parsed.data, now));
    if (!ended.success) {
      setError(ended.error.issues[0]?.message ?? "Check the dates.");
      return;
    }
    await save(ended.data, true);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="care-dialog illness-dialog">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit period" : "Log a period"}</DialogTitle>
          <DialogDescription>
            {isSickKind
              ? "Mark the days you were sick. The full range appears on the chart and in each day’s log."
              : "Mark this period. The full range appears on the chart and in each day’s log."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="illness-form">
          {initial && !initial.endDate && isSickKind && (
            <div className="illness-all-better">
              <Sun size={19} aria-hidden="true" />
              <div>
                <strong>Feeling better?</strong>
                <span>Ends this illness now. Readings from here on won’t count as sick.</span>
              </div>
              <button
                type="button"
                className="button outline"
                disabled={saving}
                onClick={() => void endNow()}
              >
                All better
              </button>
            </div>
          )}
          <label className="field">
            <span>Type</span>
            <Select value={kind} onValueChange={(value) => setKind(value as PeriodKind)}>
              <SelectTrigger className="choice" aria-label="Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(periodKindLabels) as PeriodKind[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {periodKindLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            <span>Started</span>
            <div className="illness-field-row">
              <input
                type="date"
                value={startDate}
                max={today}
                required
                onChange={(event) => setStartDate(event.target.value)}
              />
              {!allDay && (
                <input
                  type="time"
                  aria-label="Start time"
                  value={startTime}
                  required
                  onChange={(event) => setStartTime(event.target.value)}
                />
              )}
            </div>
          </label>
          <label className="illness-ongoing">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(event) => {
                setAllDay(event.target.checked);
                if (event.target.checked) {
                  setStartTime("");
                  setEndTime("");
                }
              }}
            />
            All day
          </label>
          <label className="illness-ongoing">
            <input
              type="checkbox"
              checked={ongoing}
              onChange={(event) => {
                setOngoing(event.target.checked);
                if (!event.target.checked && !endDate) setEndDate(today);
                if (event.target.checked) setEndTime("");
              }}
            />
            {isSickKind ? "Still sick / ongoing" : "Still ongoing"}
          </label>
          {!ongoing && (
            <label className="field">
              <span>Last day {isSickKind ? "sick" : "in this period"} (included)</span>
              <div className="illness-field-row">
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  max={today}
                  required
                  onChange={(event) => setEndDate(event.target.value)}
                />
                {!allDay && (
                  <input
                    type="time"
                    aria-label="End time"
                    value={endTime}
                    required
                    onChange={(event) => setEndTime(event.target.value)}
                  />
                )}
              </div>
            </label>
          )}
          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              value={note}
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Symptoms or anything you want to remember"
            />
          </label>
          <p className="helper">Calendar days in {zone}. You can end or adjust this range later.</p>
          {isSickKind && (!initial || periodKind(initial) === "illness") && (
            <section className="illness-check-ins" aria-label="Check-ins">
              <div>
                <h3>Check-ins</h3>
                <button
                  type="button"
                  className="button outline"
                  disabled={saving}
                  onClick={(event) =>
                    saveFirst ? void submit(event, () => onCheckIn(id, null)) : onCheckIn(id, null)
                  }
                >
                  <ClipboardPlus size={17} aria-hidden="true" />
                  {saveFirst ? "Save and log a check-in" : "Log a check-in"}
                </button>
              </div>
              {initial?.checkIns?.length ? (
                <CheckInList
                  checkIns={initial.checkIns}
                  timezone={timezone}
                  unit={unit}
                  onEdit={dirty ? undefined : (checkIn) => onCheckIn(id, checkIn)}
                />
              ) : (
                <p>
                  {initial ? "No check-ins yet for this illness." : "None yet."} Log temperature,
                  symptoms, vomiting, fluids and eating as they happen.
                </p>
              )}
            </section>
          )}
          {error && (
            <p className="notice danger" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button primary full" disabled={saving}>
            {saving ? <Loader2 size={17} className="spin" /> : <Check size={17} />}Save period
          </button>
          {initial && (
            <button
              type="button"
              className="text-button delete"
              disabled={saving}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={15} />
              Delete this period
            </button>
          )}
        </form>
        <AlertDialog open={deleting} onOpenChange={setDeleting}>
          <AlertDialogContent>
            <AlertDialogTitle>Delete this period?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes its band and notes from the chart and log.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>Keep range</AlertDialogCancel>
              <AlertDialogAction
                disabled={saving}
                className="danger-button"
                onClick={async (event) => {
                  event.preventDefault();
                  if (initial && (await onDelete(initial))) onClose();
                }}
              >
                Delete range
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
