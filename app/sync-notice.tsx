"use client";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SyncStatus } from "@/lib/sync";

const changes = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;

/**
 * One-way sync trouble: changes the other Carby held back because they were edited there too,
 * or changes still waiting because the last attempt to send them failed. Quiet otherwise.
 */
export function SyncNotice({
  status,
  busy,
  canManage,
  onResolve,
}: {
  status: SyncStatus;
  busy: boolean;
  canManage: boolean;
  onResolve: (choice: "syncResend" | "syncDiscard") => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const conflicts = status.held.filter((held) => held.state === "conflict").length;
  return (
    <>
      {status.held.length > 0 && (
        <div className="notice timing-warning care-workspace-sync-warning" role="status">
          <p>
            {changes(status.held.length)} {status.held.length === 1 ? "wasn’t" : "weren’t"} sent to{" "}
            {status.target}.{" "}
            {conflicts === 0
              ? ""
              : conflicts === status.held.length
                ? `${conflicts === 1 ? "It was" : "They were"} changed there too.`
                : `${conflicts} ${conflicts === 1 ? "was" : "were"} changed there too.`}{" "}
            {status.held.find((held) => held.state === "rejected")?.error ?? ""}
          </p>
          {canManage && (
            <div className="sync-notice-actions">
              {conflicts > 0 && (
                <button
                  type="button"
                  className="button subtle care-workspace-sync-button"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  Send mine anyway
                </button>
              )}
              <button
                type="button"
                className="button subtle care-workspace-sync-button"
                disabled={busy}
                onClick={() => onResolve("syncDiscard")}
              >
                Keep theirs
              </button>
            </div>
          )}
        </div>
      )}
      {status.pending > 0 && status.error && (
        <p className="notice" role="status">
          {changes(status.pending)} waiting to send to {status.target}: {status.error} Carby keeps
          trying.
        </p>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>Replace their copies?</AlertDialogTitle>
          <AlertDialogDescription>
            {changes(conflicts)} will replace what {status.target} has for those records, including
            the edits made there.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep theirs for now</AlertDialogCancel>
            <AlertDialogAction
              className="danger-button"
              onClick={() => {
                setConfirming(false);
                onResolve("syncResend");
              }}
            >
              Replace their copies
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
