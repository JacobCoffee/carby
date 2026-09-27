"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  History,
  LayoutList,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  careContactKeys,
  emergencyInstructionKeys,
  getMealRatios,
  mealRatioKeys,
  planSchema,
  temperatureUnitLabels,
  temperatureUnits,
  type Plan,
  type TemperatureUnit,
} from "@/lib/care";
import { issueFlag } from "@/lib/setup-steps";
import {
  isPlanSection,
  planChanges,
  planSectionRows,
  planSections,
  sectionHint,
  sectionOfFlag,
  type PlanSectionChanges,
  type PlanSectionId,
} from "@/lib/plan-sections";
import { can } from "@/lib/people";
import { apiFetch } from "@/lib/person-request";
import { notifyCareChanged } from "@/lib/live-refresh";
import { CarbyWordmark } from "./carby-wordmark";
import PersonMenu from "./person-menu";
import { usePersonAccess } from "./person-context";
import { useSheetHeader } from "./sheet-header";
import { CareContactFields, OtherContactFields } from "./care-contacts";
import { EmergencyInstructionFields } from "./emergency-instructions";
import { GlucoseRangeFields } from "./glucose-range-fields";
import { MealRatioFields } from "./meal-ratio-fields";
import { NumberField, PlanSettingsFields, planSettingsKeys } from "./plan-settings-fields";
import TimeZoneField from "./time-zone-field";
import "./care-workspace.css";
import "./person-menu.css";
import "./plan-page.css";

export type PlanVersion = { plan: Plan; at: string };
type Section = PlanSectionId | "overview" | "history";

// The open section lives in the URL hash, so Back steps between sections and links can deep-link.
const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = () => window.location.hash.slice(1);
const noHash = () => "";

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="choice" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function ChangeList({ sections }: { sections: PlanSectionChanges[] }) {
  return (
    <div className="plan-change-list">
      {sections.map(({ id, title, changes }) => (
        <section key={id} aria-label={title}>
          <h3>{title}</h3>
          <ul>
            {changes.map((change, index) => (
              <li key={`${change.label}-${index}`}>
                <span className="plan-change-label">{change.label}</span>
                <span className="plan-change-values">
                  <del>
                    <span className="sr-only">Was </span>
                    {change.before}
                  </del>
                  <ChevronRight size={15} aria-hidden="true" />
                  <ins>
                    <span className="sr-only">Now </span>
                    {change.after}
                  </ins>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function PlanPage({
  initialPlan,
  initialHistory,
  name,
}: {
  initialPlan: Plan;
  initialHistory: PlanVersion[];
  name?: string;
}) {
  const access = usePersonAccess();
  const sheetHeader = useSheetHeader();
  const canManage = can(access.role, "manage");
  const [plan, setPlan] = useState(initialPlan);
  const [draft, setDraft] = useState(initialPlan);
  const [history, setHistory] = useState(initialHistory);
  const [flags, setFlags] = useState<ReadonlySet<string>>(new Set());
  const [reviewing, setReviewing] = useState<Plan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState<"reset" | "leave" | null>(null);
  const hash = useSyncExternalStore(subscribeHash, readHash, noHash);
  const section: Section = hash === "history" ? "history" : isPlanSection(hash) ? hash : "overview";
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const shownSection = useRef(section);
  // Set once the person confirms leaving, so the browser's own unsaved-changes prompt stays quiet.
  const leaving = useRef(false);

  const changes = planChanges(plan, draft);
  const changeCount = changes.reduce((sum, { changes }) => sum + changes.length, 0);
  const dirty = changeCount > 0;
  const flaggedSections = new Set(
    [...flags].map(sectionOfFlag).filter((id): id is PlanSectionId => id !== null),
  );
  const savedRows = planSectionRows(plan);
  const timeFormat = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: plan.timezone,
  });
  const when = (at: string) => timeFormat.format(new Date(at));

  // A new section starts at its heading: scroll the panel into view if the page was scrolled
  // past it, and move focus there so keyboard and screen reader users land in the new content.
  useEffect(() => {
    if (shownSection.current === section) return;
    shownSection.current = section;
    const top = panel.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollBy({ top: top - 16 });
    heading.current?.focus({ preventScroll: true });
  }, [section]);

  // Closing or reloading the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Apply an edit and clear the marks on the fields it touched. */
  function update(next: Plan, ...fields: string[]) {
    setDraft(next);
    if (flags.size)
      setFlags(
        (current) =>
          new Set(
            [...current].filter(
              (flag) => !fields.some((field) => flag === field || flag.startsWith(`${field}.`)),
            ),
          ),
      );
  }

  function review() {
    const parsed = planSchema.safeParse(draft);
    const found = new Set<string>(
      parsed.success ? [] : parsed.error.issues.map((issue) => issueFlag(issue.path)),
    );
    setFlags(found);
    if (!parsed.success) {
      const first = planSections.find(({ id }) =>
        [...found].some((flag) => sectionOfFlag(flag) === id),
      );
      if (first) window.location.hash = first.id;
      toast.error(
        first ? `Check the marked values in ${first.title}.` : "Check the care plan values.",
      );
      return;
    }
    setConfirmed(false);
    setReviewing(parsed.data);
  }

  async function save() {
    if (!reviewing || !confirmed) return;
    setSaving(true);
    try {
      const response = await apiFetch("/api/care", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "plan", plan: reviewing }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error);
      setPlan(reviewing);
      setDraft(reviewing);
      setHistory((versions) => [{ plan: reviewing, at: new Date().toISOString() }, ...versions]);
      setReviewing(null);
      toast.success("Care plan updated");
      notifyCareChanged();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDiscard() {
    if (discard === "leave") {
      leaving.current = true;
      window.location.assign("/");
      return;
    }
    setDraft(plan);
    setFlags(new Set());
    setDiscard(null);
  }

  const flagged = (field: string) => flags.has(field);
  const flaggedKeys = <K extends string>(group: string, keys: readonly K[]) =>
    keys.filter((key) => flags.has(`${group}.${key}`));
  const otherContactFlags = [...flags].flatMap((flag) =>
    flag.startsWith("otherContacts.") ? [flag.slice("otherContacts.".length)] : [],
  );
  const title =
    section === "overview"
      ? "Overview"
      : section === "history"
        ? "Plan history"
        : planSections.find(({ id }) => id === section)!.title;
  const optional = planSections.find(({ id }) => id === section)?.optional;

  return (
    <div className="care-redesign plan-page">
      <Toaster richColors />
      <header className="topbar care-workspace-topbar" {...sheetHeader}>
        <Link className="carby-brand" href="/" aria-label="Carby home">
          <CarbyWordmark />
        </Link>
        <div className="workspace-header-tools">
          <Link
            className="button subtle plan-leave"
            href="/"
            aria-label="Back to daily care"
            onClick={(event) => {
              if (!dirty) return;
              event.preventDefault();
              setDiscard("leave");
            }}
          >
            <ArrowLeft size={17} aria-hidden="true" />
            <span>Daily care</span>
          </Link>
          <PersonMenu name={name} timezone={plan.timezone} />
        </div>
      </header>

      <div className="care-sheet">
        <main className="plan-main" data-view={hash ? "section" : "index"}>
          <aside className="plan-index">
            <div className="plan-index-head">
              <h1>{name ? `${name}’s care plan` : "Care plan"}</h1>
              <p>{history[0] ? `Saved ${when(history[0].at)}` : "Not saved yet"}</p>
            </div>
            <nav aria-label="Care plan sections">
              <ul className="plan-index-list">
                <li>
                  <a
                    href="#overview"
                    aria-current={section === "overview" ? "page" : undefined}
                    className="plan-index-link"
                  >
                    <LayoutList size={17} aria-hidden="true" />
                    <span className="plan-index-copy">
                      <span className="plan-index-title">Overview</span>
                      <small>Every saved value at a glance</small>
                    </span>
                  </a>
                </li>
              </ul>
              <ol className="plan-index-list plan-index-sections">
                {planSections.map(({ id, title, optional }) => {
                  const changed = changes.some((entry) => entry.id === id);
                  const attention = flaggedSections.has(id);
                  return (
                    <li key={id}>
                      <a
                        href={`#${id}`}
                        aria-current={section === id ? "page" : undefined}
                        data-state={attention ? "attention" : changed ? "changed" : undefined}
                        className="plan-index-link"
                      >
                        <span className="plan-index-mark" aria-hidden="true">
                          {attention ? <AlertTriangle size={14} /> : null}
                        </span>
                        <span className="plan-index-copy">
                          <span className="plan-index-title">
                            {title}
                            {optional && <span className="plan-index-optional">Optional</span>}
                          </span>
                          <small>
                            {attention
                              ? "Needs a value"
                              : changed
                                ? "Unsaved changes"
                                : sectionHint(plan, id)}
                          </small>
                        </span>
                        <ChevronRight className="plan-index-chevron" size={16} aria-hidden="true" />
                      </a>
                    </li>
                  );
                })}
              </ol>
              <ul className="plan-index-list plan-index-secondary">
                <li>
                  <a
                    href="#history"
                    aria-current={section === "history" ? "page" : undefined}
                    className="plan-index-link"
                  >
                    <History size={17} aria-hidden="true" />
                    <span className="plan-index-copy">
                      <span className="plan-index-title">Plan history</span>
                      <small>{plural(history.length, "saved version")}</small>
                    </span>
                    <ChevronRight className="plan-index-chevron" size={16} aria-hidden="true" />
                  </a>
                </li>
              </ul>
            </nav>
          </aside>

          <section ref={panel} className="plan-panel" aria-labelledby="plan-panel-title">
            <button
              type="button"
              className="text-button plan-panel-back"
              onClick={() => {
                window.location.hash = "";
              }}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              All sections
            </button>
            <header className="plan-panel-head">
              <h2 id="plan-panel-title" ref={heading} tabIndex={-1}>
                {title}
              </h2>
              {optional && <span className="setup-optional">Optional</span>}
            </header>
            {!canManage && (
              <p className="notice" role="status">
                Only an owner can change the care plan. You can read it here.
              </p>
            )}

            {section === "overview" && (
              <div className="plan-overview">
                {dirty && (
                  <p className="plan-overview-note">
                    This shows the saved plan. Your {plural(changeCount, "unsaved change")} appear
                    after you save.
                  </p>
                )}
                {planSections.map(({ id, title }) => (
                  <section
                    key={id}
                    className="setup-review-group"
                    aria-labelledby={`overview-${id}`}
                  >
                    <div className="setup-review-head">
                      <h3 id={`overview-${id}`}>{title}</h3>
                      <a className="text-button" href={`#${id}`}>
                        {canManage ? "Edit" : "View"}
                        <span className="sr-only"> {title}</span>
                      </a>
                    </div>
                    {savedRows[id].length ? (
                      <dl>
                        {savedRows[id].map((row, index) => (
                          <div key={`${row.label}-${index}`}>
                            <dt>{row.label}</dt>
                            <dd>{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="plan-overview-empty">None added.</p>
                    )}
                  </section>
                ))}
              </div>
            )}

            {section === "history" && (
              <ol className="plan-history-list">
                {history.length === 0 && (
                  <li className="plan-overview-empty">No saved versions yet.</li>
                )}
                {history.map((version, index) => {
                  const previous = history[index + 1];
                  const diff = previous ? planChanges(previous.plan, version.plan) : [];
                  return (
                    <li key={version.at}>
                      <div className="plan-history-head">
                        <h3>{when(version.at)}</h3>
                        {index === 0 && <span className="setup-optional">Current</span>}
                      </div>
                      {!previous ? (
                        <p className="plan-overview-empty">First saved plan.</p>
                      ) : diff.length ? (
                        <ChangeList sections={diff} />
                      ) : (
                        <p className="plan-overview-empty">Saved with no changed values.</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            <form
              className="care-setup-form plan-form"
              noValidate
              hidden={section === "overview" || section === "history"}
              onSubmit={(event) => {
                event.preventDefault();
                if (canManage && dirty) review();
              }}
            >
              <fieldset className="plan-form-fields" disabled={!canManage || saving}>
                {section === "math" && (
                  <>
                    <p className="plan-intro">
                      The numbers the insulin calculator uses. Copy each one from your current care
                      plan.
                    </p>
                    <div className="two-fields">
                      <NumberField
                        label="Glucose target (mg/dL)"
                        value={draft.target}
                        min={70}
                        max={250}
                        step="any"
                        required
                        invalid={flagged("target")}
                        onChange={(target) => update({ ...draft, target }, "target")}
                      />
                      <NumberField
                        label="Correction factor (mg/dL per unit)"
                        value={draft.factor}
                        min={1}
                        max={1000}
                        step="any"
                        required
                        invalid={flagged("factor")}
                        onChange={(factor) => update({ ...draft, factor }, "factor")}
                      />
                    </div>
                    <MealRatioFields
                      ratios={getMealRatios(draft)}
                      flagged={flaggedKeys("mealRatios", mealRatioKeys)}
                      onChange={(mealRatios, changed) =>
                        update({ ...draft, mealRatios }, `mealRatios.${changed}`)
                      }
                    />
                    <div className="two-fields plan-form-row">
                      <NumberField
                        label="Correction review interval (hours)"
                        helper="How long after a correction the review reminder appears."
                        value={draft.correctionHours}
                        min={0.01}
                        max={24}
                        step="any"
                        required
                        invalid={flagged("correctionHours")}
                        onChange={(correctionHours) =>
                          update({ ...draft, correctionHours }, "correctionHours")
                        }
                      />
                    </div>
                    <div className="two-fields plan-form-row">
                      <Choice
                        label="Dose increments"
                        value={String(draft.increment)}
                        onChange={(value) => update({ ...draft, increment: Number(value) })}
                        options={[
                          { value: "0.5", label: "0.5 unit" },
                          { value: "1", label: "1 unit" },
                        ]}
                      />
                      <Choice
                        label="Rounding rule"
                        value={draft.rounding}
                        onChange={(value) =>
                          update({ ...draft, rounding: value === "down" ? "down" : "nearest" })
                        }
                        options={[
                          { value: "down", label: "Round down" },
                          { value: "nearest", label: "Round to nearest" },
                        ]}
                      />
                    </div>
                  </>
                )}

                {section === "ranges" && (
                  <div className="plan-lead-legend">
                    <GlucoseRangeFields
                      ranges={draft.glucoseRanges}
                      invalid={flagged("glucoseRanges")}
                      onChange={(glucoseRanges) => {
                        const { glucoseRanges: _, ...rest } = draft;
                        update(glucoseRanges ? { ...rest, glucoseRanges } : rest, "glucoseRanges");
                      }}
                    />
                  </div>
                )}

                {section === "safety" && (
                  <div className="plan-lead-legend">
                    <PlanSettingsFields
                      draft={draft}
                      invalid={planSettingsKeys.filter((key) => flags.has(key))}
                      onChange={(next, changed) => {
                        // A toggled-off group is absent from `next`, so copy each key rather than spread.
                        const merged: Record<string, unknown> = { ...draft };
                        for (const key of planSettingsKeys) {
                          if (key in next) merged[key] = next[key];
                          else delete merged[key];
                        }
                        update(merged as Plan, changed);
                      }}
                    />
                  </div>
                )}

                {section === "schedule" && (
                  <>
                    <p className="plan-intro">
                      When the long-acting reminder appears, and the time zone every view, reminder
                      and report uses.
                    </p>
                    <fieldset>
                      <legend>Long-acting insulin</legend>
                      <div className="two-fields">
                        <NumberField
                          label="Long-acting units"
                          helper="Enter 0 if there is no scheduled long-acting dose. That turns the reminder off."
                          value={draft.basal}
                          min={0}
                          max={100}
                          step={0.5}
                          required
                          invalid={flagged("basal")}
                          onChange={(basal) =>
                            update(
                              { ...draft, basal, basalTime: basal === 0 ? "" : draft.basalTime },
                              "basal",
                              "basalTime",
                            )
                          }
                        />
                        <label className="field">
                          <span>Long-acting time</span>
                          <input
                            type="time"
                            required={draft.basal > 0}
                            disabled={draft.basal === 0}
                            aria-invalid={flagged("basalTime") || undefined}
                            value={draft.basalTime}
                            onChange={(event) =>
                              update({ ...draft, basalTime: event.target.value }, "basalTime")
                            }
                          />
                        </label>
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>Time and units</legend>
                      <div className="two-fields">
                        <TimeZoneField
                          value={draft.timezone}
                          onChange={(timezone) => update({ ...draft, timezone }, "timezone")}
                        />
                        <label className="field">
                          <span>Temperature unit (illness check-ins)</span>
                          <Select
                            value={draft.temperatureUnit ?? ""}
                            onValueChange={(value) =>
                              update(
                                { ...draft, temperatureUnit: value as TemperatureUnit },
                                "temperatureUnit",
                              )
                            }
                          >
                            <SelectTrigger className="choice" aria-label="Temperature unit">
                              <SelectValue placeholder="Choose a unit" />
                            </SelectTrigger>
                            <SelectContent>
                              {temperatureUnits.map((unit) => (
                                <SelectItem key={unit} value={unit}>
                                  {temperatureUnitLabels[unit]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                      </div>
                    </fieldset>
                    <p className="helper">
                      Reminders use the schedule saved here while Carby is open. They do not confirm
                      whether insulin was given and do not schedule external notifications.
                    </p>
                  </>
                )}

                {section === "contacts" && (
                  <div className="plan-lead-legend">
                    <CareContactFields
                      values={draft.contacts ?? {}}
                      invalid={flaggedKeys("contacts", careContactKeys)}
                      onChange={(contacts, changed) =>
                        update({ ...draft, contacts }, `contacts.${changed}`)
                      }
                    />
                    <OtherContactFields
                      values={draft.otherContacts ?? []}
                      invalid={otherContactFlags}
                      onChange={(otherContacts) => {
                        const { otherContacts: _, ...rest } = draft;
                        update(
                          otherContacts.length ? { ...rest, otherContacts } : rest,
                          "otherContacts",
                        );
                      }}
                    />
                  </div>
                )}

                {section === "instructions" && (
                  <div className="plan-lead-legend">
                    <EmergencyInstructionFields
                      values={draft.emergencyInstructions ?? {}}
                      invalid={flaggedKeys("emergencyInstructions", emergencyInstructionKeys)}
                      onChange={(emergencyInstructions, changed) =>
                        update(
                          { ...draft, emergencyInstructions },
                          `emergencyInstructions.${changed}`,
                        )
                      }
                    />
                    <label className="field">
                      <span>Care team instructions or notes</span>
                      <textarea
                        value={draft.note}
                        maxLength={1000}
                        aria-invalid={flagged("note") || undefined}
                        onChange={(event) => update({ ...draft, note: event.target.value }, "note")}
                      />
                    </label>
                  </div>
                )}
              </fieldset>
            </form>
          </section>
        </main>
      </div>

      {canManage && dirty && (
        <section className="plan-savebar" aria-label="Unsaved changes">
          <p aria-live="polite">
            <strong>{plural(changeCount, "unsaved change")}</strong>
            <span> in {changes.map(({ title }) => title).join(", ")}</span>
          </p>
          <div className="plan-savebar-actions">
            <button
              type="button"
              className="button outline"
              disabled={saving}
              onClick={() => setDiscard("reset")}
            >
              Discard changes
            </button>
            <button type="button" className="button primary" disabled={saving} onClick={review}>
              Review and save
            </button>
          </div>
        </section>
      )}

      <Dialog
        open={reviewing !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setReviewing(null);
        }}
      >
        <DialogContent className="care-dialog plan-review-dialog">
          <DialogHeader>
            <DialogTitle>Review changes</DialogTitle>
            <DialogDescription>
              Check each value against your clinician’s current instructions. Earlier entries keep
              the plan they were logged with.
            </DialogDescription>
          </DialogHeader>
          {reviewing && <ChangeList sections={planChanges(plan, reviewing)} />}
          <label className="check-row plan-review-confirm">
            <Checkbox
              checked={confirmed}
              disabled={saving}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            <span>These values match your clinician’s instructions.</span>
          </label>
          <DialogFooter className="plan-review-actions">
            <button
              type="button"
              className="button outline"
              disabled={saving}
              onClick={() => setReviewing(null)}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!confirmed || saving}
              onClick={() => void save()}
            >
              {saving && <Loader2 className="spin" size={17} aria-hidden="true" />}
              {saving ? "Saving…" : "Save care plan"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discard !== null} onOpenChange={(open) => !open && setDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {discard === "leave" ? "Leave without saving?" : "Discard unsaved changes?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {plural(changeCount, "change")} to the care plan will be lost. The saved plan stays as
            it is.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="danger-button"
              onClick={(event) => {
                event.preventDefault();
                confirmDiscard();
              }}
            >
              {discard === "leave" ? "Leave without saving" : "Discard changes"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
