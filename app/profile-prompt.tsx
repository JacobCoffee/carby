"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import OnboardingProfile from "./onboarding-profile";
import type { Profile } from "@/lib/profile";
import { usePersonAccess } from "./person-context";
import "./profile-prompt.css";

const DISMISS_KEY = "carby-profile-card-dismissed";

/**
 * For an account with no saved profile, a small dismissible card inviting personalization, plus
 * the dialog (reachable from that card or from Care tools > Profile) that collects or edits it.
 */
export default function ProfilePrompt({
  profile,
  timezone,
  onSaved,
  open,
  onOpenChange,
}: {
  profile: Profile | null;
  /** Care plan time zone, used only for the diagnosis-date "Today" shortcut. */
  timezone?: string;
  onSaved: (profile: Profile) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Per person, so dismissing the card for one child does not hide it for another.
  const { person, role } = usePersonAccess();
  const dismissKey = `${DISMISS_KEY}:${person}`;
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(dismissKey) === "1",
  );
  return (
    <>
      {!profile && !dismissed && role === "owner" && (
        <div className="profile-prompt-card" role="status">
          <p>
            <strong>Personalize Carby</strong> — add a name so the log, reports, and caregiver
            handoff can greet the person you care for by name.
          </p>
          <div className="profile-prompt-card-actions">
            <button type="button" className="button primary" onClick={() => onOpenChange(true)}>
              Personalize
            </button>
            <button
              type="button"
              className="button subtle"
              onClick={() => {
                setDismissed(true);
                try {
                  sessionStorage.setItem(dismissKey, "1");
                } catch {
                  // Storage may be unavailable in private browsing; dismissing still works for now.
                }
              }}
            >
              Not now
            </button>
          </div>
        </div>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="care-dialog profile-prompt-dialog">
          <DialogHeader>
            <DialogTitle>{profile ? "Edit profile" : "Personalize Carby"}</DialogTitle>
            <DialogDescription>
              Carby uses this only to personalize what you see. It is never used for dosing.
            </DialogDescription>
          </DialogHeader>
          <OnboardingProfile
            mode="edit"
            initial={profile}
            timezone={timezone}
            onSaved={(saved) => {
              onSaved(saved);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
