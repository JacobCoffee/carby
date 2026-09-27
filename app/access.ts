import { getCurrentUser, type User } from "@/app/auth";
import { database, type Database } from "@/db/raw";
import { profileSchema } from "@/lib/profile";
import {
  can,
  chooseMembership,
  personRoles,
  PERSON_COOKIE,
  PERSON_HEADER,
  PERSON_PARAM,
  type Membership,
  type Need,
  type PersonRole,
  type PersonSummary,
} from "@/lib/people";

/** The signed-in account, and the person this request acts for. */
export type Access = { user: User; person: string; role: PersonRole };

function reply(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function cookieValue(header: string | null, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("=")) || null;
  }
  return null;
}

const isRole = (role: string): role is PersonRole =>
  (personRoles as readonly string[]).includes(role);

async function memberRows(db: Database, account: string) {
  const rows = await db
    .prepare(
      "SELECT person, role, account_name FROM person_members WHERE account = $1 ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created, person",
    )
    .bind(account)
    .all<{ person: string; role: string; account_name: string }>();
  return rows.results;
}

/** Add a person owned by `user`, with an id nobody else can hold. */
export function createPersonStatements(db: Database, user: User, id: string, now: string) {
  return [
    db
      .prepare("INSERT INTO people (id, created_by, created) VALUES ($1, $2, $3)")
      .bind(id, user.userId, now),
    db
      .prepare(
        "INSERT INTO person_members (person, account, account_name, role, created) VALUES ($1, $2, $3, 'owner', $4)",
      )
      .bind(id, user.userId, user.displayName, now),
  ];
}

/**
 * The account's memberships, owners first. An account with none gets its own person: the one
 * whose id is the account id when that is still free (so records saved before people existed
 * stay its own), otherwise a new one. Reaching zero never restores access that was taken away.
 */
export async function memberships(db: Database, user: User): Promise<Membership[]> {
  let rows = await memberRows(db, user.userId);
  if (!rows.length) {
    const now = new Date().toISOString();
    // One statement, so two first visits at once wait on the same people row instead of each
    // creating a person.
    await db
      .prepare(
        "WITH p AS (INSERT INTO people (id, created_by, created) VALUES ($1, $1, $3) ON CONFLICT DO NOTHING RETURNING id) INSERT INTO person_members (person, account, account_name, role, created) SELECT id, $1, $2, 'owner', $3 FROM p ON CONFLICT DO NOTHING",
      )
      .bind(user.userId, user.displayName, now)
      .run();
    rows = await memberRows(db, user.userId);
    if (!rows.length) {
      // The account-id person exists but this account left it. Both inserts are conditional on
      // the account still having no membership, and batch() is SERIALIZABLE (retried on conflict),
      // so two first visits at once settle on one new person.
      const id = `person_${crypto.randomUUID()}`;
      await db.batch([
        db
          .prepare(
            "INSERT INTO people (id, created_by, created) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM person_members WHERE account = $2)",
          )
          .bind(id, user.userId, now),
        db
          .prepare(
            "INSERT INTO person_members (person, account, account_name, role, created) SELECT id, $2, $3, 'owner', $4 FROM people WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM person_members WHERE account = $2)",
          )
          .bind(id, user.userId, user.displayName, now),
      ]);
      rows = await memberRows(db, user.userId);
    }
  } else if (rows.some((row) => row.account_name !== user.displayName)) {
    await db
      .prepare("UPDATE person_members SET account_name = $1 WHERE account = $2")
      .bind(user.displayName, user.userId)
      .run();
  }
  return rows.flatMap((row) => (isRole(row.role) ? [{ person: row.person, role: row.role }] : []));
}

/** Everyone the account can reach, with the name from each person's profile. */
export async function listPeople(db: Database, user: User): Promise<PersonSummary[]> {
  const list = await memberships(db, user);
  if (!list.length) return [];
  const profiles = await db
    .prepare("SELECT owner, data FROM profiles WHERE owner = ANY($1)")
    .bind(list.map((m) => m.person))
    .all<{ owner: string; data: string }>();
  const names = new Map(
    profiles.results.map((row) => {
      const profile = profileSchema.safeParse(JSON.parse(row.data));
      return [row.owner, profile.success ? profile.data.name : null] as const;
    }),
  );
  return list.map((m) => ({ id: m.person, name: names.get(m.person) ?? null, role: m.role }));
}

export async function resolveAccess(
  db: Database,
  user: User,
  request: { named: string | null; cookie: string | null; write: boolean },
  need: Need,
): Promise<Access | Response> {
  const chosen = chooseMembership(await memberships(db, user), request);
  if ("status" in chosen)
    return chosen.status === 409
      ? reply("Carby was switched to someone else in another tab. Reload to continue.", 409)
      : reply("That person isn’t available to this account.", 404);
  const { person, role } = chosen.membership;
  if (!can(role, need))
    return reply(
      need === "manage" ? "Only an owner can change this." : "Your access is view only.",
      403,
    );
  return { user, person, role };
}
/**
 * The access an API request has. The page names its person in a header (or a `person` query
 * parameter for plain links such as downloads); the person cookie only picks the default.
 */
export async function accessFor(
  request: Request,
  user: User,
  need: Need,
): Promise<Access | Response> {
  try {
    return await resolveAccess(
      database(),
      user,
      {
        named:
          request.headers.get(PERSON_HEADER) ?? new URL(request.url).searchParams.get(PERSON_PARAM),
        cookie: cookieValue(request.headers.get("cookie"), PERSON_COOKIE),
        write: request.method !== "GET" && request.method !== "HEAD",
      },
      need,
    );
  } catch (e) {
    console.error("access check failed", e);
    return reply("Carby is unavailable right now. Please retry.", 503);
  }
}

/** Sign-in plus `accessFor`, for routes with no sign-in message of their own. */
export async function personAccess(request: Request, need: Need): Promise<Access | Response> {
  const user = await getCurrentUser();
  if (!user) return reply("Sign in to continue.", 401);
  return accessFor(request, user, need);
}

/** The cookie that makes `person` the default after a switch, accept or new person. */
export function personCookie(person: string | null, secure: boolean): string {
  const value = person === null ? "" : encodeURIComponent(person);
  const age = person === null ? 0 : 400 * 86400;
  return `${PERSON_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`;
}
