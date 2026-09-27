"use client";
import Link from "next/link";
import { Toaster } from "@/components/ui/sonner";
import { personLabel } from "@/lib/people";
import { CarbyWordmark } from "./carby-wordmark";
import PersonMenu from "./person-menu";
import { usePersonAccess } from "./person-context";
import "./care-workspace.css";

/** A caregiver or viewer opened someone whose owner hasn't finished the care plan yet. */
export default function SetupPending() {
  const access = usePersonAccess();
  const name = personLabel(access.people.find((p) => p.id === access.person)?.name);
  return (
    <div className="care-redesign care-setup">
      <Toaster richColors />
      <header className="topbar care-workspace-topbar">
        <Link className="carby-brand" href="/" aria-label="Carby home">
          <CarbyWordmark />
        </Link>
        <div className="setup-header-person">
          <PersonMenu />
        </div>
      </header>
      <main className="care-setup-main">
        <section className="care-setup-intro care-setup-onboarding">
          <h1>{name}’s care plan isn’t set up yet</h1>
          <p>
            An owner needs to enter the care plan before anyone can log. Check back once they’ve
            finished, or switch to someone else.
          </p>
        </section>
      </main>
    </div>
  );
}
