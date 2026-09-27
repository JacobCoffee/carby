"use client";
import { useEffect, useState } from "react";
import { Copy, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INVITE_DAYS,
  personRoleDescriptions,
  personRoleLabels,
  personRoles,
  type PersonRole,
} from "@/lib/people";
import { apiFetch } from "@/lib/person-request";
import "./person-menu.css";

type Member = { account: string; name: string; role: PersonRole; since: string; you: boolean };
type Invite = { id: string; role: PersonRole; createdBy: string; created: string; expires: string };
type Confirm = { kind: "remove"; member: Member } | { kind: "revoke"; invite: Invite } | null;

async function post(body: unknown): Promise<{ ok?: boolean; error?: string; url?: string }> {
  const response = await apiFetch("/api/people", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; url?: string };
  if (!response.ok) throw new Error(data.error ?? "Could not save that change. Please retry.");
  return data;
}

/** Owners see who can reach this person, change or remove their access, and invite someone. */
export default function SharingDialog({
  open,
  onOpenChange,
  name,
  timezone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  timezone: string;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loadError, setLoadError] = useState("");
  const [inviteRole, setInviteRole] = useState<PersonRole>("caregiver");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void apiFetch("/api/people", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          members?: Member[];
          invites?: Invite[];
          error?: string;
        };
        if (!response.ok || !data.members) throw new Error(data.error ?? "Sharing is unavailable.");
        setMembers(data.members);
        setInvites(data.invites ?? []);
        setLoadError("");
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(e instanceof Error ? e.message : "Sharing is unavailable.");
      });
    return () => controller.abort();
  }, [open, version]);

  const date = (value: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(
      new Date(value),
    );

  async function run(body: unknown, success: string) {
    setBusy(true);
    try {
      const data = await post(body);
      toast.success(success);
      setVersion((v) => v + 1);
      return data;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that change. Please retry.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createInvite() {
    const data = await run({ action: "invite", role: inviteRole }, "Invite link created");
    if (data?.url) setLink(data.url);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setLink("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="care-dialog sharing-dialog">
        <DialogHeader>
          <DialogTitle>Sharing {name}’s care</DialogTitle>
          <DialogDescription>
            Everyone here signs in with their own account. Changes they make are recorded under
            their name.
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p className="notice danger" role="alert">
            {loadError}
          </p>
        ) : !members ? (
          <p className="helper" role="status">
            <Loader2 size={15} className="spin" aria-hidden="true" /> Loading…
          </p>
        ) : (
          <>
            <section className="sharing-section" aria-labelledby="sharing-members">
              <h3 id="sharing-members">People with access</h3>
              <ul className="sharing-list">
                {members.map((member) => (
                  <li key={member.account}>
                    <div className="sharing-who">
                      <strong>
                        {member.name}
                        {member.you && <small> · you</small>}
                      </strong>
                      <small>Since {date(member.since)}</small>
                    </div>
                    {member.you ? (
                      <span className="sharing-role">{personRoleLabels[member.role]}</span>
                    ) : (
                      <div className="sharing-actions">
                        <Select
                          value={member.role}
                          disabled={busy}
                          onValueChange={(role) =>
                            void run(
                              { action: "setRole", account: member.account, role },
                              `${member.name} is now a ${personRoleLabels[role as PersonRole].toLowerCase()}`,
                            )
                          }
                        >
                          <SelectTrigger
                            className="choice sharing-role-select"
                            aria-label={`Role for ${member.name}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {personRoles.map((role) => (
                              <SelectItem key={role} value={role}>
                                {personRoleLabels[role]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          type="button"
                          className="text-button delete"
                          disabled={busy}
                          onClick={() => setConfirm({ kind: "remove", member })}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="sharing-section" aria-labelledby="sharing-invite">
              <h3 id="sharing-invite">Invite someone</h3>
              <label className="field">
                <span>They’ll join as</span>
                <Select
                  value={inviteRole}
                  onValueChange={(role) => {
                    setInviteRole(role as PersonRole);
                    setLink("");
                  }}
                >
                  <SelectTrigger className="choice" aria-label="Role for the invite">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {personRoles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {personRoleLabels[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <p className="helper">{personRoleDescriptions[inviteRole]}</p>
              {link ? (
                <div className="sharing-link">
                  <label className="field">
                    <span>Invite link</span>
                    <input
                      readOnly
                      value={link}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                  <div className="sharing-link-actions">
                    <button
                      type="button"
                      className="button outline"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(link)
                          .then(() => toast.success("Link copied"))
                          .catch(() => toast.error("Copy failed. Select the link and copy it."))
                      }
                    >
                      <Copy size={16} aria-hidden="true" />
                      Copy link
                    </button>
                  </div>
                  <p className="helper">
                    Works once, for {INVITE_DAYS} days. Anyone who opens it while signed in can
                    join, so send it only to the person you mean.
                  </p>
                </div>
              ) : (
                <div className="sharing-link-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy}
                    onClick={() => void createInvite()}
                  >
                    {busy ? (
                      <Loader2 size={16} className="spin" aria-hidden="true" />
                    ) : (
                      <Link2 size={16} aria-hidden="true" />
                    )}
                    Create invite link
                  </button>
                </div>
              )}
            </section>

            {invites.length > 0 && (
              <section className="sharing-section" aria-labelledby="sharing-pending">
                <h3 id="sharing-pending">Unused invites</h3>
                <ul className="sharing-list">
                  {invites.map((invite) => (
                    <li key={invite.id}>
                      <div className="sharing-who">
                        <strong>{personRoleLabels[invite.role]} invite</strong>
                        <small>
                          From {invite.createdBy} · expires {date(invite.expires)}
                        </small>
                      </div>
                      <div className="sharing-actions">
                        <button
                          type="button"
                          className="text-button delete"
                          disabled={busy}
                          onClick={() => setConfirm({ kind: "revoke", invite })}
                        >
                          Revoke
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <AlertDialog open={confirm !== null} onOpenChange={(next) => !next && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogTitle>
              {confirm?.kind === "remove"
                ? `Remove ${confirm.member.name}’s access?`
                : "Revoke this invite?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "remove"
                ? `They can no longer see or log ${name}’s care. Their past changes stay in the history.`
                : "The link stops working. You can create a new one at any time."}
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>
                {confirm?.kind === "remove" ? "Keep access" : "Keep invite"}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                className="danger-button"
                onClick={async (event) => {
                  event.preventDefault();
                  if (!confirm) return;
                  const done =
                    confirm.kind === "remove"
                      ? await run(
                          { action: "removeMember", account: confirm.member.account },
                          `${confirm.member.name} no longer has access`,
                        )
                      : await run(
                          { action: "revokeInvite", id: confirm.invite.id },
                          "Invite revoked",
                        );
                  if (done) setConfirm(null);
                }}
              >
                {confirm?.kind === "remove" ? "Remove access" : "Revoke invite"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
