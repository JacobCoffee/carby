"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Calendar, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
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
import { fromLocal, localInput, type Plan } from "@/lib/care";
import { appointmentSchema, type Appointment } from "@/lib/appointments";
import "./clinic-features.css";

function readable(at: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

/** The soonest upcoming appointment as a small header chip, or nothing when there is none. */
export function NextAppointmentChip({
  appointments,
  timezone,
  now,
}: {
  appointments: Appointment[];
  timezone: string;
  now: number;
}) {
  const next = appointments
    .filter((appointment) => Date.parse(appointment.at) >= now)
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  if (!next) return null;
  return (
    <span className="next-appointment-chip">
      <Calendar size={14} aria-hidden="true" />
      {next.title} · {readable(next.at, timezone)}
    </span>
  );
}

export default function AppointmentsPanel({
  appointments,
  plan,
  now,
  onSave,
  onDelete,
}: {
  appointments: Appointment[];
  plan: Pick<Plan, "timezone">;
  now: number;
  onSave: (appointment: Appointment) => Promise<boolean>;
  onDelete: (appointment: Appointment) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<Appointment | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Appointment | null>(null);
  const [at, setAt] = useState(""),
    [title, setTitle] = useState(""),
    [location, setLocation] = useState(""),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    if (editing === undefined) return;
    setError("");
    setSaving(false);
    setAt(
      editing
        ? localInput(new Date(editing.at), plan.timezone)
        : localInput(new Date(now + 3600000), plan.timezone),
    );
    setTitle(editing?.title ?? "");
    setLocation(editing?.location ?? "");
    setNote(editing?.note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const sorted = [...appointments].sort((a, b) => a.at.localeCompare(b.at));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const parsed = appointmentSchema.safeParse({
      id: editing?.id ?? crypto.randomUUID(),
      revision: editing?.revision,
      at: fromLocal(at, plan.timezone),
      title,
      location: location || undefined,
      note,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the appointment details.");
      return;
    }
    setSaving(true);
    if (await onSave(parsed.data)) setEditing(undefined);
    else setSaving(false);
  }
  return (
    <section className="insights-panel appointments-panel" aria-labelledby="appointments-heading">
      <header className="appointments-header">
        <div className="insights-panel-title">
          <div>
            <span className="insights-eyebrow">COMING UP</span>
            <h3 id="appointments-heading">Appointments</h3>
          </div>
        </div>
        <button type="button" className="button subtle" onClick={() => setEditing(null)}>
          <Plus size={15} aria-hidden="true" />
          Add appointment
        </button>
      </header>
      {sorted.length === 0 ? (
        <p className="helper">No appointments saved yet. Add clinic visits and classes here.</p>
      ) : (
        <ul className="appointment-list">
          {sorted.map((appointment) => (
            <li
              key={appointment.id}
              className={Date.parse(appointment.at) < now ? "is-past" : undefined}
            >
              <div>
                <strong>{appointment.title}</strong>
                <span className="care-reminder-detail">
                  {readable(appointment.at, plan.timezone)}
                </span>
                {appointment.location && (
                  <span className="care-reminder-detail">
                    <MapPin size={12} aria-hidden="true" /> {appointment.location}
                  </span>
                )}
                {appointment.note && <p className="helper">{appointment.note}</p>}
              </div>
              <div className="appointment-actions">
                <button
                  type="button"
                  className="button outline"
                  aria-label={`Edit ${appointment.title}`}
                  onClick={() => setEditing(appointment)}
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="button outline"
                  aria-label={`Delete ${appointment.title}`}
                  onClick={() => setDeleting(appointment)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open && !saving) setEditing(undefined);
        }}
      >
        <DialogContent className="care-dialog appointment-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit appointment" : "Add appointment"}</DialogTitle>
            <DialogDescription>
              Save the date, time, and any notes for this visit.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="entry-form">
            <label className="field">
              <span>Title</span>
              <input
                value={title}
                maxLength={120}
                required
                placeholder="Follow-up, post-hospital class…"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Date and time</span>
              <input
                type="datetime-local"
                value={at}
                required
                onChange={(event) => setAt(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Location (optional)</span>
              <input
                value={location}
                maxLength={200}
                onChange={(event) => setLocation(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Notes (optional)</span>
              <textarea
                value={note}
                maxLength={1000}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {error && (
              <p className="notice danger" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={saving}>
              {saving ? "Saving…" : "Save appointment"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete this appointment?</AlertDialogTitle>
          <AlertDialogDescription>
            {deleting ? `${deleting.title}, ${readable(deleting.at, plan.timezone)}` : ""}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep appointment</AlertDialogCancel>
            <AlertDialogAction
              className="danger-button"
              onClick={async (event) => {
                event.preventDefault();
                if (deleting && (await onDelete(deleting))) setDeleting(null);
              }}
            >
              Delete appointment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
