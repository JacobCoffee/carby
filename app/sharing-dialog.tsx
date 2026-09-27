"use client";
import { useEffect, useState } from "react";
import { Copy, KeyRound, Link2, Loader2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiScopes, scopeSummary, TOKEN_LABEL_MAX, type ApiScope } from "@/lib/api-tokens";
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
type Token = {
  id: string;
  label: string;
  scopes: ApiScope[];
  createdBy: string;
  created: string;
  lastUsed: string | null;
  yours: boolean;
};
/** GET /api/people. Members and invites come only to owners. */
type Loaded = {
  role: PersonRole;
  members?: Member[];
  invites?: Invite[];
  tokens: Token[];
  tokenScopes: ApiScope[];
  apiUrl: string;
};
type Confirm =
  | { kind: "remove"; member: Member }
  | { kind: "revoke"; invite: Invite }
  | { kind: "revokeToken"; token: Token }
  | null;
type Created = { token: string; label: string; scopes: ApiScope[] };

const scopeUses: Record<ApiScope, string> = {
  upload: "Upload glucose, food, insulin and notes",
  read: "Read glucose and the log",
};

async function post(
  body: unknown,
): Promise<{ ok?: boolean; error?: string; url?: string; token?: string }> {
  const response = await apiFetch("/api/people", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    url?: string;
    token?: string;
  };
  if (!response.ok) throw new Error(data.error ?? "Could not save that change. Please retry.");
  return data;
}

/** The `https://TOKEN@host/api/v1/` form xDrip+ takes as its Nightscout upload URL. */
function uploadUrl(apiUrl: string, token: string) {
  const url = new URL("/api/v1/", apiUrl);
  url.username = token;
  return url.toString();
}

function CopyField({ label, value, what }: { label: string; value: string; what: string }) {
  return (
    <div className="sharing-copy">
      <label className="field">
        <span>{label}</span>
        <input readOnly value={value} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <button
        type="button"
        className="button outline"
        onClick={() =>
          void navigator.clipboard
            .writeText(value)
            .then(() => toast.success(`${what} copied`))
            .catch(() => toast.error(`Copy failed. Select the ${what.toLowerCase()} and copy it.`))
        }
      >
        <Copy size={16} aria-hidden="true" />
        Copy
      </button>
    </div>
  );
}

/**
 * Owners see who can reach this person, change or remove their access, and invite someone.
 * Everyone sees their own API tokens (owners see all of them), and can make and revoke them.
 */
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
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [inviteRole, setInviteRole] = useState<PersonRole>("caregiver");
  const [link, setLink] = useState("");
  const [tokenLabel, setTokenLabel] = useState("");
  const [tokenScopes, setTokenScopes] = useState<ApiScope[] | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void apiFetch("/api/people", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as Partial<Loaded> & { error?: string };
        if (!response.ok || !data.role || !data.tokens || !data.tokenScopes || !data.apiUrl)
          throw new Error(data.error ?? "Sharing is unavailable.");
        setLoaded({
          role: data.role,
          members: data.members,
          invites: data.invites,
          tokens: data.tokens,
          tokenScopes: data.tokenScopes,
          apiUrl: data.apiUrl,
        });
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

  // Every scope the account may give is ticked until someone changes the choice.
  const chosenScopes = tokenScopes ?? loaded?.tokenScopes ?? [];
  async function createToken() {
    const label = tokenLabel.trim();
    const data = await run({ action: "createToken", label, scopes: chosenScopes }, "Token created");
    if (data?.token) {
      setCreated({ token: data.token, label, scopes: chosenScopes });
      setTokenLabel("");
      setTokenScopes(null);
    }
  }

  const members = loaded?.members;
  const invites = loaded?.invites ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setLink("");
          setCreated(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="care-dialog sharing-dialog">
        <DialogHeader>
          <DialogTitle>Sharing {name}’s care</DialogTitle>
          <DialogDescription>
            Everyone here signs in with their own account, and apps use a token made by one of them.
            Changes are recorded under that person’s name.
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p className="notice danger" role="alert">
            {loadError}
          </p>
        ) : !loaded ? (
          <p className="helper" role="status">
            <Loader2 size={15} className="spin" aria-hidden="true" /> Loading…
          </p>
        ) : (
          <>
            {members && (
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

            <section className="sharing-section" aria-labelledby="sharing-tokens">
              <h3 id="sharing-tokens">Connected apps</h3>
              <p className="helper">
                Apps such as xDrip+, Juggluco, Loop or Trio can send glucose and doses to {name}’s
                log as if it were a Nightscout site. Give each app its own token. It acts as the
                person who made it, and stops working if they lose access.
              </p>
              {loaded.tokens.length > 0 && (
                <ul className="sharing-list">
                  {loaded.tokens.map((token) => (
                    <li key={token.id}>
                      <div className="sharing-who">
                        <strong>{token.label}</strong>
                        <small>
                          {scopeSummary(token.scopes)} ·{" "}
                          {token.yours ? "yours" : `made by ${token.createdBy}`} ·{" "}
                          {token.lastUsed ? `last used ${date(token.lastUsed)}` : "not used yet"}
                        </small>
                      </div>
                      {(token.yours || loaded.role === "owner") && (
                        <div className="sharing-actions">
                          <button
                            type="button"
                            className="text-button delete"
                            disabled={busy}
                            onClick={() => setConfirm({ kind: "revokeToken", token })}
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {created ? (
                <div className="sharing-link">
                  <p className="notice" role="status">
                    Copy the token now. Carby shows it only once.
                  </p>
                  <CopyField label="Nightscout URL" value={loaded.apiUrl} what="URL" />
                  <CopyField
                    label={`Token for ${created.label}`}
                    value={created.token}
                    what="Token"
                  />
                  {created.scopes.includes("upload") && (
                    <CopyField
                      label="URL with the token, for xDrip+"
                      value={uploadUrl(loaded.apiUrl, created.token)}
                      what="URL"
                    />
                  )}
                  <p className="helper">
                    In the app, enter the Nightscout URL as the site and the token as the API secret
                    or access token. Anyone with the token can{" "}
                    {created.scopes.includes("upload") ? "add to" : "read"} {name}’s log, so keep it
                    private.
                  </p>
                  <div className="sharing-link-actions">
                    <button
                      type="button"
                      className="button outline"
                      onClick={() => setCreated(null)}
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <div className="sharing-token-form">
                  <label className="field">
                    <span>App name</span>
                    <input
                      value={tokenLabel}
                      maxLength={TOKEN_LABEL_MAX}
                      placeholder="xDrip+ on my phone"
                      disabled={busy}
                      onChange={(event) => setTokenLabel(event.target.value)}
                    />
                  </label>
                  <fieldset className="sharing-scopes">
                    <legend>The app can</legend>
                    {apiScopes
                      .filter((scope) => loaded.tokenScopes.includes(scope))
                      .map((scope) => (
                        <label className="check-row" key={scope}>
                          <Checkbox
                            checked={chosenScopes.includes(scope)}
                            disabled={busy}
                            onCheckedChange={(checked) =>
                              setTokenScopes(
                                checked === true
                                  ? [...chosenScopes, scope]
                                  : chosenScopes.filter((s) => s !== scope),
                              )
                            }
                          />
                          {scopeUses[scope]}
                        </label>
                      ))}
                  </fieldset>
                  <div className="sharing-link-actions">
                    <button
                      type="button"
                      className="button outline"
                      disabled={busy || !tokenLabel.trim() || chosenScopes.length === 0}
                      onClick={() => void createToken()}
                    >
                      <KeyRound size={16} aria-hidden="true" />
                      Create token
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
        <AlertDialog open={confirm !== null} onOpenChange={(next) => !next && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogTitle>
              {confirm?.kind === "remove"
                ? `Remove ${confirm.member.name}’s access?`
                : confirm?.kind === "revokeToken"
                  ? `Revoke the token for ${confirm.token.label}?`
                  : "Revoke this invite?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "remove"
                ? `They can no longer see or log ${name}’s care, and their app tokens stop working. Their past changes stay in the history.`
                : confirm?.kind === "revokeToken"
                  ? "The app stops reaching this log at once. What it already sent stays."
                  : "The link stops working. You can create a new one at any time."}
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>
                {confirm?.kind === "remove"
                  ? "Keep access"
                  : confirm?.kind === "revokeToken"
                    ? "Keep token"
                    : "Keep invite"}
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
                      : confirm.kind === "revokeToken"
                        ? await run(
                            { action: "revokeToken", id: confirm.token.id },
                            "Token revoked",
                          )
                        : await run(
                            { action: "revokeInvite", id: confirm.invite.id },
                            "Invite revoked",
                          );
                  if (done) setConfirm(null);
                }}
              >
                {confirm?.kind === "remove"
                  ? "Remove access"
                  : confirm?.kind === "revokeToken"
                    ? "Revoke token"
                    : "Revoke invite"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
