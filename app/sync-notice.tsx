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
 * Sync trouble: changes the other Carby held back because they were edited there too, its own
 * changes held back here for the same reason, or changes still waiting because the last attempt
 * to send or get them failed. Quiet otherwise.
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
  onResolve: (choice: "syncResend" | "syncDiscard" | "syncPullSend" | "syncPullDiscard") => void;
}) {
  const [confirming, setConfirming] = useState<"push" | "pull" | null>(null);
  const conflicts = status.held.filter((held) => held.state === "conflict").length;
  const pulledHeld = status.pull?.held ?? 0;
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
                  onClick={() => setConfirming("push")}
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
      {pulledHeld > 0 && (
        <div className="notice timing-warning care-workspace-sync-warning" role="status">
          <p>
            {changes(pulledHeld)} from {status.target} {pulledHeld === 1 ? "wasn’t" : "weren’t"}{" "}
            applied here. The same {pulledHeld === 1 ? "record was" : "records were"} changed here
            too.
          </p>
          {canManage && (
            <div className="sync-notice-actions">
              <button
                type="button"
                className="button subtle care-workspace-sync-button"
                disabled={busy}
                onClick={() => setConfirming("pull")}
              >
                Use theirs
              </button>
              <button
                type="button"
                className="button subtle care-workspace-sync-button"
                disabled={busy}
                onClick={() => onResolve("syncPullDiscard")}
              >
                Keep mine
              </button>
            </div>
          )}
        </div>
      )}
      {status.pull?.error && (
        <p className="notice" role="status">
          Couldn’t get changes from {status.target}: {status.pull.error} Carby keeps trying.
        </p>
      )}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {confirming === "pull" ? "Replace your copies?" : "Replace their copies?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirming === "pull"
              ? `${changes(pulledHeld)} from ${status.target} will replace what you have here for those records, including the edits made here.`
              : `${changes(conflicts)} will replace what ${status.target} has for those records, including the edits made there.`}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {confirming === "pull" ? "Keep mine for now" : "Keep theirs for now"}
            </AlertDialogCancel>
            <AlertDialogAction
              className="danger-button"
              onClick={() => {
                const choice = confirming;
                setConfirming(null);
                onResolve(choice === "pull" ? "syncPullSend" : "syncResend");
              }}
            >
              {confirming === "pull" ? "Replace my copies" : "Replace their copies"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
