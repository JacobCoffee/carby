import Link from "next/link";
import { requireCurrentUser } from "@/app/auth";
import { database } from "@/db/raw";
import { profileSchema } from "@/lib/profile";
import {
  inviteTokenHash,
  personLabel,
  personRoleDescriptions,
  personRoleLabels,
  personRoles,
  type PersonRole,
} from "@/lib/people";
import { CarbyWordmark } from "../../carby-wordmark";
import InviteAccept from "../invite-accept";
import "../../care-workspace.css";
import "../../person-menu.css";

export const dynamic = "force-dynamic";

type Invite = { person: string; role: PersonRole; createdBy: string; name: string | null };

async function findInvite(token: string): Promise<Invite | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = database();
  const row = await db
    .prepare(
      "SELECT i.person, i.role, i.created_by_name, p.data FROM person_invites i LEFT JOIN profiles p ON p.owner = i.person WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires > $2 AND EXISTS (SELECT 1 FROM person_members m WHERE m.person = i.person AND m.account = i.created_by AND m.role = 'owner')",
    )
    .bind(await inviteTokenHash(token), new Date().toISOString())
    .first<{ person: string; role: string; created_by_name: string; data: string | null }>();
  if (!row || !(personRoles as readonly string[]).includes(row.role)) return null;
  const profile = row.data ? profileSchema.safeParse(JSON.parse(row.data)) : null;
  return {
    person: row.person,
    role: row.role as PersonRole,
    createdBy: row.created_by_name,
    name: profile?.success ? profile.data.name : null,
  };
}

/** Where an invite link lands. Reading it changes nothing; only Accept uses the invite. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireCurrentUser(`/invite/${token}`);
  const invite = await findInvite(token);
  const already = invite
    ? await database()
        .prepare("SELECT 1 FROM person_members WHERE person = $1 AND account = $2")
        .bind(invite.person, user.userId)
        .first()
    : null;
  const name = invite ? personLabel(invite.name) : "";
  return (
    <div className="care-redesign care-setup">
      <header className="topbar care-workspace-topbar">
        <Link className="carby-brand" href="/" aria-label="Carby home">
          <CarbyWordmark />
        </Link>
        <span className="setup-header-label">Signed in as {user.displayName}</span>
      </header>
      <main className="care-setup-main">
        <section className="care-setup-intro care-setup-onboarding invite-card">
          {!invite ? (
            <>
              <h1>This invite can’t be used</h1>
              <p>It has expired, was already used, or was removed. Ask for a new invite link.</p>
              <div className="invite-actions">
                <Link className="button outline" href="/">
                  Open Carby
                </Link>
              </div>
            </>
          ) : already ? (
            <>
              <h1>You already share {name}’s care</h1>
              <p>This account already has access. The invite is still unused.</p>
              <div className="invite-actions">
                <Link className="button primary" href="/">
                  Open Carby
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1>Join {name}’s care</h1>
              <p>
                {invite.createdBy} invited you as a {personRoleLabels[invite.role].toLowerCase()}.{" "}
                {personRoleDescriptions[invite.role]}
              </p>
              <p>
                You’ll join as <strong>{user.displayName}</strong>. Owners can see who has access
                and change or remove it at any time.
              </p>
              <InviteAccept token={token} name={name} />
            </>
          )}
        </section>
      </main>
    </div>
  );
}
