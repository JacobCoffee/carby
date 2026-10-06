import { z } from "zod";

/** Which account may reach whose records. Pure rules only; app/access.ts applies them. */
export const personRoles = ["owner", "caregiver", "viewer"] as const;
export type PersonRole = (typeof personRoles)[number];
export const personRoleLabels: Record<PersonRole, string> = {
  owner: "Owner",
  caregiver: "Caregiver",
  viewer: "Viewer",
};
export const personRoleDescriptions: Record<PersonRole, string> = {
  owner: "Everything, including the care plan, Dexcom, backups and sharing.",
  caregiver: "Sees everything and logs care. Can’t change the care plan, Dexcom or sharing.",
  viewer: "Sees everything. Can’t log or change anything.",
};

/**
 * What a request needs. `read` covers viewing and refreshing device data, `log` adds care
 * records (entries, illness, appointments, saved foods), and `manage` covers the care plan,
 * profile, device connections, backups and sharing.
 */
export type Need = "read" | "log" | "manage";
const allowed: Record<Need, readonly PersonRole[]> = {
  read: personRoles,
  log: ["owner", "caregiver"],
  manage: ["owner"],
};
export function can(role: PersonRole, need: Need): boolean {
  return allowed[need].includes(role);
}

/** The request header, query parameter and cookie that name the person a request is for. */
export const PERSON_HEADER = "x-carby-person";
export const PERSON_PARAM = "person";
export const PERSON_COOKIE = "carby_person";
export const INVITE_DAYS = 7;
export const MAX_PEOPLE_PER_ACCOUNT = 20;

export type Membership = { person: string; role: PersonRole };

/** One person an account can reach, for the switcher. */
export type PersonSummary = { id: string; name: string | null; role: PersonRole };
/** What the page knows about whose log it shows. */
export type PersonAccess = { person: string; role: PersonRole; people: PersonSummary[] };

/**
 * Pick the person a request is for. A named person must be one of the account's; an unnamed
 * read falls back to the cookie's choice, then the first membership. An unnamed write is refused
 * once the account reaches more than one person, so a tab left open on one child can never
 * record into another child's log after a switch in a different tab.
 */
export function chooseMembership(
  memberships: readonly Membership[],
  o: { named: string | null; cookie: string | null; write: boolean },
): { membership: Membership } | { status: 404 | 409 } {
  if (o.named !== null) {
    const membership = memberships.find((m) => m.person === o.named);
    return membership ? { membership } : { status: 404 };
  }
  if (o.write && memberships.length > 1) return { status: 409 };
  const membership =
    memberships.find((m) => m.person === o.cookie) ?? (memberships[0] as Membership | undefined);
  return membership ? { membership } : { status: 404 };
}

/**
 * The person a page opens. The cookie's choice wins; without one, the first person (owners first)
 * with a saved care plan, so an empty person made before an invite was accepted never hides the
 * log the account was invited to. A browser that never stored the cookie, such as an iOS home
 * screen app, otherwise opens that empty person every time.
 */
export function openingPerson<T extends { id: string }>(
  people: readonly T[],
  chosen: string | undefined,
  planned: ReadonlySet<string>,
): T | undefined {
  return people.find((p) => p.id === chosen) ?? people.find((p) => planned.has(p.id)) ?? people[0];
}

/**
 * Whether a change leaves the person with at least one owner. `role: null` removes the member.
 * Every person keeps an owner, so there is always someone who can manage the care plan and sharing.
 */
export function keepsAnOwner(
  members: readonly { account: string; role: PersonRole }[],
  account: string,
  role: PersonRole | null,
): boolean {
  return members.some(
    (m) => m.role === "owner" && (m.account === account ? role === "owner" : true),
  );
}

/** The name shown for a person: their profile name, or a neutral label until one is saved. */
export function personLabel(name: string | null | undefined): string {
  return name?.trim() || "Unnamed person";
}

export const inviteRoleSchema = z.enum(personRoles);
export const peopleActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("switch"), person: z.string().min(1).max(300) }),
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("invite"), role: inviteRoleSchema }),
  z.object({ action: z.literal("revokeInvite"), id: z.string().uuid() }),
  z.object({
    action: z.literal("setRole"),
    account: z.string().min(1).max(300),
    role: inviteRoleSchema,
  }),
  z.object({ action: z.literal("removeMember"), account: z.string().min(1).max(300) }),
  z.object({ action: z.literal("leave") }),
  z.object({ action: z.literal("accept"), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
]);
export type PeopleAction = z.infer<typeof peopleActionSchema>;

/** A new invite token: 32 random bytes, base64url. Only its hash is stored. */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function inviteTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
