"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { PersonAccess } from "@/lib/people";

const PersonContext = createContext<PersonAccess | null>(null);

/** Set once per page by app/page.tsx: whose log this page shows, and this account's role there. */
export function PersonProvider({ value, children }: { value: PersonAccess; children: ReactNode }) {
  return <PersonContext value={value}>{children}</PersonContext>;
}

export function usePersonAccess(): PersonAccess {
  const access = useContext(PersonContext);
  if (!access) throw new Error("usePersonAccess needs a PersonProvider");
  return access;
}
