"use client";
import { useState } from "react";
import { ChevronsUpDown, LogOut, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { personLabel, personRoleLabels } from "@/lib/people";
import { apiFetch } from "@/lib/person-request";
import { usePersonAccess } from "./person-context";
import { useHoverMenu } from "./hover-menu";
import SharingDialog from "./sharing-dialog";
import "./person-menu.css";

async function change(body: unknown) {
  const response = await apiFetch("/api/people", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Could not switch. Please retry.");
  // A full load, so nothing from the previous person's page (state, charts, caches) survives.
  window.location.assign("/");
}

/**
 * Whose log this is, and the way to switch, add someone, share or leave. `timezone` turns on the
 * sharing dialog, which needs the care plan for its dates; `name` overrides the saved name after
 * a profile edit on this page.
 */
export default function PersonMenu({ name, timezone }: { name?: string; timezone?: string }) {
  const access = usePersonAccess();
  const [busy, setBusy] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const current = access.people.find((p) => p.id === access.person);
  const hover = useHoverMenu();
  const label = personLabel(name ?? current?.name);
  const run = (body: unknown) => {
    setBusy(true);
    change(body).catch((e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not switch. Please retry.");
      setBusy(false);
    });
  };
  return (
    <>
      <DropdownMenu {...hover.root}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="button subtle person-menu-trigger"
            disabled={busy}
            aria-label={`Showing ${label}’s log. Switch person or share.`}
            {...hover.trigger}
          >
            <span className="person-menu-avatar" aria-hidden="true">
              {label.slice(0, 1).toUpperCase()}
            </span>
            <span className="person-menu-name">{label}</span>
            <ChevronsUpDown size={15} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="person-menu header-menu" {...hover.content}>
          <DropdownMenuLabel>Whose log</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={access.person}
            onValueChange={(person) => {
              if (person !== access.person) run({ action: "switch", person });
            }}
          >
            {access.people.map((person) => (
              <DropdownMenuRadioItem key={person.id} value={person.id} disabled={busy}>
                <span className="person-menu-item">
                  {personLabel(person.id === access.person ? label : person.name)}
                  <small>{personRoleLabels[person.role]}</small>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={busy} onSelect={() => run({ action: "create" })}>
            <UserPlus size={17} aria-hidden="true" />
            Add a person
          </DropdownMenuItem>
          {timezone && (
            <DropdownMenuItem onSelect={() => setSharingOpen(true)}>
              <Users size={17} aria-hidden="true" />
              Sharing and access
            </DropdownMenuItem>
          )}
          {access.role !== "owner" && (
            <DropdownMenuItem disabled={busy} onSelect={() => setLeaving(true)}>
              <LogOut size={17} aria-hidden="true" />
              Leave {label}’s care
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {timezone && (
        <SharingDialog
          open={sharingOpen}
          onOpenChange={setSharingOpen}
          name={label}
          timezone={timezone}
        />
      )}
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogTitle>Leave {label}’s care?</AlertDialogTitle>
          <AlertDialogDescription>
            You’ll stop seeing {label}’s log. An owner can invite you again.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Stay</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="danger-button"
              onClick={(event) => {
                event.preventDefault();
                run({ action: "leave" });
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
