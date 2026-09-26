/** Who may sign in with OAuth. With both allowlists empty, nobody may. */

export type AllowlistEnv = { CARBY_ALLOWED_USERS?: string; CARBY_ALLOWED_EMAILS?: string };
export type Allowlist = { users: Set<string>; emails: Set<string> };

function entries(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseAllowlist(env: AllowlistEnv): Allowlist {
  return {
    users: new Set(entries(env.CARBY_ALLOWED_USERS)),
    emails: new Set(entries(env.CARBY_ALLOWED_EMAILS).map((email) => email.toLowerCase())),
  };
}

/**
 * Admit an exact `provider:subject` owner, or an allowlisted email the provider verified.
 * Either list may be used alone; with both empty, nobody is admitted.
 */
export function isAllowedOwner(
  allowlist: Allowlist,
  ownerId: string,
  email: string | null | undefined,
  emailVerified: boolean,
): boolean {
  if (allowlist.users.size === 0 && allowlist.emails.size === 0) return false;
  if (allowlist.users.has(ownerId)) return true;
  return (
    emailVerified === true && typeof email === "string" && allowlist.emails.has(email.toLowerCase())
  );
}
