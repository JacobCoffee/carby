import { getCurrentUser } from "@/app/auth";
import {
  accessFor,
  createPersonStatements,
  listPeople,
  memberships,
  personAccess,
  personCookie,
} from "@/app/access";
import { database, type Database } from "@/db/raw";
import { canonicalOrigin } from "@/lib/auth-origin";
import {
  INVITE_DAYS,
  MAX_PEOPLE_PER_ACCOUNT,
  inviteTokenHash,
  keepsAnOwner,
  newInviteToken,
  peopleActionSchema,
  personRoles,
  type PersonRole,
} from "@/lib/people";

export const dynamic = "force-dynamic";

function reply(data: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (cookie) headers.set("Set-Cookie", cookie);
  return Response.json(data, { status, headers });
}

const secure = (request: Request) => new URL(request.url).protocol === "https:";
const isRole = (role: string): role is PersonRole =>
  (personRoles as readonly string[]).includes(role);

async function memberList(db: Database, person: string) {
  const rows = await db
    .prepare(
      "SELECT account, account_name, role, created FROM person_members WHERE person = $1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'caregiver' THEN 1 ELSE 2 END, created",
    )
    .bind(person)
    .all<{ account: string; account_name: string; role: string; created: string }>();
  return rows.results.flatMap((row) =>
    isRole(row.role)
      ? [{ account: row.account, name: row.account_name, role: row.role, since: row.created }]
      : [],
  );
}

/**
 * Run `sql` (a single-row change ending in RETURNING) and write one history row per row it
 * actually changed, in the same statement. `meta.changes` is then the number of rows changed.
 */
function changeWithHistory(
  db: Database,
  sql: string,
  args: unknown[],
  o: {
    person: string;
    entryId: string;
    actor: { userId: string; displayName: string };
    action: string;
    before: unknown;
    after: unknown;
  },
) {
  const at = (i: number) => `$${args.length + i}`;
  return db
    .prepare(
      `WITH changed AS (${sql}) INSERT INTO care_audit (id, owner, entry_id, actor_id, actor_name, action, "before", "after", at) SELECT ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(at).join(", ")} FROM changed`,
    )
    .bind(
      ...args,
      crypto.randomUUID(),
      o.person,
      o.entryId,
      o.actor.userId,
      o.actor.displayName,
      o.action,
      o.before === null ? null : JSON.stringify(o.before),
      o.after === null ? null : JSON.stringify(o.after),
      new Date().toISOString(),
    );
}

const OTHER_OWNER =
  "EXISTS (SELECT 1 FROM person_members o WHERE o.person = $1 AND o.role = 'owner' AND o.account <> $2)";
/** An owner who loses that role also loses the invites they created, so none can restore it. */
function dropInvitesOfFormerOwner(db: Database, person: string, account: string) {
  return db
    .prepare(
      "DELETE FROM person_invites WHERE person = $1 AND created_by = $2 AND accepted_at IS NULL AND NOT EXISTS (SELECT 1 FROM person_members WHERE person = $1 AND account = $2 AND role = 'owner')",
    )
    .bind(person, account);
}

/** The people this account reaches, and for owners of the active person, who shares it. */
export async function GET(request: Request) {
  const access = await personAccess(request, "read");
  if (access instanceof Response) return access;
  try {
    const db = database();
    const people = await listPeople(db, access.user);
    if (access.role !== "owner") return reply({ person: access.person, role: access.role, people });
    const invites = await db
      .prepare(
        "SELECT id, role, created_by_name, created, expires FROM person_invites WHERE person = $1 AND accepted_at IS NULL AND expires > $2 ORDER BY created DESC",
      )
      .bind(access.person, new Date().toISOString())
      .all<{
        id: string;
        role: string;
        created_by_name: string;
        created: string;
        expires: string;
      }>();
    return reply({
      person: access.person,
      role: access.role,
      people,
      members: (await memberList(db, access.person)).map((m) => ({
        ...m,
        you: m.account === access.user.userId,
      })),
      invites: invites.results.flatMap((row) =>
        isRole(row.role)
          ? [
              {
                id: row.id,
                role: row.role,
                createdBy: row.created_by_name,
                created: row.created,
                expires: row.expires,
              },
            ]
          : [],
      ),
    });
  } catch (e) {
    console.error("people load failed", e);
    return reply({ error: "Sharing details are unavailable. Please retry." }, 503);
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in first." }, 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return reply({ error: "Request origin rejected." }, 403);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return reply({ error: "Invalid JSON request." }, 400);
  }
  const parsed = peopleActionSchema.safeParse(raw);
  if (!parsed.success) return reply({ error: "Invalid request." }, 400);
  const body = parsed.data;
  try {
    const db = database();
    const now = new Date().toISOString();

    if (body.action === "accept") {
      // One statement: the invite is used once, and only while its creator is still an owner;
      // the membership and its history row follow it.
      const joined = await db
        .prepare(
          `WITH inv AS (UPDATE person_invites SET accepted_by = $2, accepted_at = $4 WHERE token_hash = $1 AND accepted_at IS NULL AND expires > $4 AND EXISTS (SELECT 1 FROM person_members m WHERE m.person = person_invites.person AND m.account = person_invites.created_by AND m.role = 'owner') RETURNING id, person, role),
           ins AS (INSERT INTO person_members (person, account, account_name, role, created) SELECT person, $2, $3, role, $4 FROM inv ON CONFLICT DO NOTHING RETURNING person, role),
           aud AS (INSERT INTO care_audit (id, owner, entry_id, actor_id, actor_name, action, "before", "after", at) SELECT $5, ins.person, $2, $2, $3, 'access granted', NULL, json_build_object('account', $2::text, 'role', ins.role)::text, $4 FROM ins)
           SELECT person FROM inv`,
        )
        .bind(
          await inviteTokenHash(body.token),
          user.userId,
          user.displayName,
          now,
          crypto.randomUUID(),
        )
        .first<{ person: string }>();
      if (!joined)
        return reply(
          { error: "This invite has expired or was already used. Ask for a new one." },
          410,
        );
      return reply(
        { ok: true, person: joined.person },
        200,
        personCookie(joined.person, secure(request)),
      );
    }

    if (body.action === "switch") {
      const reachable = await memberships(db, user);
      if (!reachable.some((m) => m.person === body.person))
        return reply({ error: "That person isn’t available to this account." }, 404);
      return reply(
        { ok: true, person: body.person },
        200,
        personCookie(body.person, secure(request)),
      );
    }

    if (body.action === "create") {
      const owned = (await memberships(db, user)).filter((m) => m.role === "owner");
      if (owned.length >= MAX_PEOPLE_PER_ACCOUNT)
        return reply({ error: `One account can own up to ${MAX_PEOPLE_PER_ACCOUNT} people.` }, 400);
      const person = `person_${crypto.randomUUID()}`;
      await db.batch(createPersonStatements(db, user, person, now));
      return reply({ ok: true, person }, 200, personCookie(person, secure(request)));
    }

    // Everything below acts on the person this page was opened for.
    const access = await accessFor(request, user, body.action === "leave" ? "read" : "manage");
    if (access instanceof Response) return access;
    const person = access.person;

    if (body.action === "invite") {
      const token = newInviteToken();
      const id = crypto.randomUUID();
      const expires = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString();
      await changeWithHistory(
        db,
        "INSERT INTO person_invites (id, person, token_hash, role, created_by, created_by_name, created, expires) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [
          id,
          person,
          await inviteTokenHash(token),
          body.role,
          user.userId,
          user.displayName,
          now,
          expires,
        ],
        {
          person,
          entryId: id,
          actor: user,
          action: "invite created",
          before: null,
          after: { role: body.role, expires },
        },
      ).run();
      const base = canonicalOrigin({ APP_URL: process.env.APP_URL }) ?? new URL(request.url);
      return reply({
        ok: true,
        url: new URL(`/invite/${token}`, base).toString(),
        invite: { id, role: body.role, createdBy: user.displayName, created: now, expires },
      });
    }

    if (body.action === "revokeInvite") {
      const revoked = await changeWithHistory(
        db,
        "DELETE FROM person_invites WHERE id = $1 AND person = $2 AND accepted_at IS NULL RETURNING id",
        [body.id, person],
        {
          person,
          entryId: body.id,
          actor: user,
          action: "invite revoked",
          before: null,
          after: null,
        },
      ).run();
      return revoked.meta.changes
        ? reply({ ok: true })
        : reply({ error: "That invite was already used or removed." }, 404);
    }

    const members = await memberList(db, person);
    const account = body.action === "leave" ? user.userId : body.account;
    const current = members.find((m) => m.account === account);
    if (!current) return reply({ error: "That account no longer has access." }, 404);

    if (body.action === "setRole") {
      if (current.role === body.role) return reply({ ok: true });
      if (!keepsAnOwner(members, account, body.role))
        return reply(
          { error: "Every person needs an owner. Make someone else an owner first." },
          400,
        );
      const [changed] = await db.batch([
        changeWithHistory(
          db,
          `UPDATE person_members SET role = $3 WHERE person = $1 AND account = $2 AND ($3 = 'owner' OR role <> 'owner' OR ${OTHER_OWNER}) RETURNING account`,
          [person, account, body.role],
          {
            person,
            entryId: account,
            actor: user,
            action: "access changed",
            before: { account, role: current.role },
            after: { account, role: body.role },
          },
        ),
        dropInvitesOfFormerOwner(db, person, account),
      ]);
      return changed?.meta?.changes
        ? reply({ ok: true })
        : reply({ error: "Sharing changed at the same time. Reload and try again." }, 409);
    }

    // removeMember or leave.
    if (!keepsAnOwner(members, account, null))
      return reply(
        {
          error:
            body.action === "leave"
              ? "You’re the only owner. Make someone else an owner before you leave."
              : "Every person needs an owner. Make someone else an owner first.",
        },
        400,
      );
    const [removed] = await db.batch([
      changeWithHistory(
        db,
        `DELETE FROM person_members WHERE person = $1 AND account = $2 AND (role <> 'owner' OR ${OTHER_OWNER}) RETURNING account`,
        [person, account],
        {
          person,
          entryId: account,
          actor: user,
          action: "access removed",
          before: { account, role: current.role },
          after: null,
        },
      ),
      dropInvitesOfFormerOwner(db, person, account),
    ]);
    if (!removed?.meta?.changes)
      return reply({ error: "Sharing changed at the same time. Reload and try again." }, 409);
    return body.action === "leave"
      ? reply({ ok: true }, 200, personCookie(null, secure(request)))
      : reply({ ok: true });
  } catch (e) {
    console.error("people change failed", e);
    return reply({ error: "Could not save that change. Please retry." }, 503);
  }
}
