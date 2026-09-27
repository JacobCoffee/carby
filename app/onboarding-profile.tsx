"use client";

import { apiFetch } from "@/lib/person-request";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { dateKey } from "@/lib/care";
import {
  profileRoleLabels,
  profileRoles,
  profileSchema,
  type Profile,
  type ProfileRole,
} from "@/lib/profile";
import "./onboarding-profile.css";

type Mode = "setup" | "edit";
type StepId = "welcome" | "name" | "role" | "diagnosis";

async function saveProfile(profile: Profile): Promise<Profile> {
  const response = await apiFetch("/api/care", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "profile", profile }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Your profile could not be saved. Please retry.");
  return profile;
}

/**
 * A small multi-step form that collects the optional personalization profile: the name of the
 * person with diabetes, who is using Carby, and (optionally) when they were diagnosed. In `setup`
 * mode it opens with a welcome step and can be skipped entirely; in `edit` mode it starts on the
 * name step, prefilled from `initial`, for editing an existing profile from Care tools.
 */
export default function OnboardingProfile({
  mode,
  initial,
  timezone,
  onSaved,
  onSkip,
  onCancel,
}: {
  mode: Mode;
  initial?: Profile | null;
  /** Care plan time zone, used only to compute "today" for the diagnosis-date shortcut. */
  timezone?: string;
  onSaved: (profile: Profile) => void;
  /** Setup only: leave without saving anything. */
  onSkip?: () => void;
  /** Edit only: close without saving. */
  onCancel?: () => void;
}) {
  const steps: StepId[] =
    mode === "setup" ? ["welcome", "name", "role", "diagnosis"] : ["name", "role", "diagnosis"];
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState<ProfileRole | "">(initial?.role ?? "");
  const [caregiverName, setCaregiverName] = useState(initial?.caregiverName ?? "");
  const [diagnosedOn, setDiagnosedOn] = useState(initial?.diagnosedOn ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepId = steps[index];
  useEffect(() => {
    headingRef.current?.focus();
  }, [stepId]);

  function go(next: number, dir: "forward" | "backward") {
    setDirection(dir);
    setIndex(next);
    setError("");
  }
  const canAdvance =
    stepId === "welcome" ||
    (stepId === "name" && name.trim().length > 0) ||
    (stepId === "role" && role !== "") ||
    stepId === "diagnosis";

  async function finish() {
    const parsed = profileSchema.safeParse({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      role,
      ...(role !== "self" && caregiverName.trim() ? { caregiverName: caregiverName.trim() } : {}),
      ...(diagnosedOn ? { diagnosedOn } : {}),
    });
    if (!parsed.success) {
      setError("Check the values above.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveProfile(parsed.data);
      onSaved(parsed.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your profile could not be saved. Please retry.");
      setSaving(false);
    }
  }
  function next() {
    if (!canAdvance || saving) return;
    if (index === steps.length - 1) {
      void finish();
      return;
    }
    go(index + 1, "forward");
  }
  function back() {
    if (index === 0 || saving) return;
    go(index - 1, "backward");
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      next();
    }
  }
  const today = dateKey(new Date(), timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);

  return (
    <div className="profile-steps" onKeyDown={onKeyDown}>
      <div
        className="profile-steps-progress"
        role="progressbar"
        aria-label="Personalization progress"
        aria-valuenow={index + 1}
        aria-valuemin={1}
        aria-valuemax={steps.length}
      >
        {steps.map((step, i) => (
          <span key={step} className={i <= index ? "is-done" : undefined} aria-hidden="true" />
        ))}
      </div>
      <div key={stepId} className={`profile-step is-${direction}`}>
        {stepId === "welcome" && (
          <>
            <h2 ref={headingRef} tabIndex={-1}>
              Let&rsquo;s personalize Carby
            </h2>
            <p>
              A couple of quick questions make Carby feel like it belongs to your family. You can
              skip this and add it later from Care tools.
            </p>
          </>
        )}
        {stepId === "name" && (
          <>
            <h2 ref={headingRef} tabIndex={-1}>
              What&rsquo;s the name of the person with diabetes?
            </h2>
            <label className="field">
              <span>Name</span>
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                required
              />
            </label>
          </>
        )}
        {stepId === "role" && (
          <>
            <h2 ref={headingRef} tabIndex={-1}>
              Who&rsquo;s using Carby?
            </h2>
            <div className="choice-group" role="radiogroup" aria-label="Who is using Carby">
              {profileRoles.map((option) => (
                <label
                  key={option}
                  className={`choice-card${role === option ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={option}
                    checked={role === option}
                    onChange={() => setRole(option)}
                  />
                  {profileRoleLabels[option]}
                </label>
              ))}
            </div>
            {role && role !== "self" && (
              <label className="field">
                <span>Your name (optional)</span>
                <input
                  value={caregiverName}
                  onChange={(event) => setCaregiverName(event.target.value)}
                  maxLength={60}
                  placeholder="Shown on the caregiver handoff"
                />
              </label>
            )}
          </>
        )}
        {stepId === "diagnosis" && (
          <>
            <h2 ref={headingRef} tabIndex={-1}>
              {name.trim() ? `When was ${name.trim()} diagnosed?` : "When were they diagnosed?"}
            </h2>
            <p className="helper">
              Optional. Carby only uses this to personalize copy, never for dosing.
            </p>
            <div className="field-row">
              <label className="field">
                <span>Diagnosis date (optional)</span>
                <input
                  type="date"
                  value={diagnosedOn}
                  max={today}
                  onChange={(event) => setDiagnosedOn(event.target.value)}
                />
              </label>
              <button type="button" className="button subtle" onClick={() => setDiagnosedOn(today)}>
                Today
              </button>
            </div>
          </>
        )}
      </div>
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      <div className="profile-steps-actions">
        {index > 0 ? (
          <button type="button" className="button subtle" onClick={back} disabled={saving}>
            Back
          </button>
        ) : mode === "setup" ? (
          <button type="button" className="button subtle" onClick={onSkip} disabled={saving}>
            Skip for now
          </button>
        ) : (
          <button type="button" className="button subtle" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="button primary"
          onClick={next}
          disabled={!canAdvance || saving}
        >
          {saving
            ? "Saving…"
            : index === steps.length - 1
              ? mode === "edit"
                ? "Save"
                : "Continue"
              : "Continue"}
        </button>
      </div>
    </div>
  );
}
