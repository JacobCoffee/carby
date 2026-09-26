/**
 * Pure profile normalization for the OAuth providers. Every value arrives from the network, so
 * each field is type-checked here and an email counts as verified only when the provider says so.
 */

export const PROVIDER_IDS = ["github", "google", "discord"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

type RawProfile = Record<string, unknown>;

export type NormalizedProfile = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  emailVerified: boolean;
};

export type ProfileIdentity = {
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function requiredId(value: unknown, provider: ProviderId): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value.toString();
  const id = text(value);
  if (!id) throw new TypeError(`The ${provider} profile has no account id.`);
  return id;
}

/** Pick the primary verified address from `GET /user/emails`, else any verified one. */
export function githubVerifiedEmail(emails: unknown): {
  email: string | null;
  emailVerified: boolean;
} {
  if (!Array.isArray(emails)) return { email: null, emailVerified: false };
  const verified = (emails as unknown[])
    .filter((entry): entry is RawProfile => typeof entry === "object" && entry !== null)
    .filter((entry) => entry.verified === true && text(entry.email) !== null);
  const chosen = verified.find((entry) => entry.primary === true) ?? verified[0];
  return chosen
    ? { email: text(chosen.email), emailVerified: true }
    : { email: null, emailVerified: false };
}

export function normalizeGitHubProfile(raw: object): NormalizedProfile {
  const profile = raw as RawProfile;
  const email = text(profile.email);
  return {
    id: requiredId(profile.id, "github"),
    name: text(profile.name) ?? text(profile.login),
    email,
    image: text(profile.avatar_url),
    emailVerified: email !== null && profile.emailVerified === true,
  };
}

export function normalizeGoogleProfile(raw: object): NormalizedProfile {
  const profile = raw as RawProfile;
  const email = text(profile.email);
  return {
    id: requiredId(profile.sub, "google"),
    name: text(profile.name),
    email,
    image: text(profile.picture),
    emailVerified: email !== null && profile.email_verified === true,
  };
}

/** Same derivation as the built-in Discord provider. */
export function discordAvatarUrl(raw: object): string {
  const profile = raw as RawProfile;
  const id = requiredId(profile.id, "discord");
  const avatar = profile.avatar;
  if (typeof avatar !== "string" || !avatar) {
    const defaultAvatarNumber =
      profile.discriminator === "0"
        ? Number(BigInt(id) >> BigInt(22)) % 6
        : parseInt(String(profile.discriminator)) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarNumber}.png`;
  }
  const format = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${format}`;
}

export function normalizeDiscordProfile(raw: object): NormalizedProfile {
  const profile = raw as RawProfile;
  const email = text(profile.email);
  return {
    id: requiredId(profile.id, "discord"),
    name: text(profile.global_name) ?? text(profile.username),
    email,
    image: discordAvatarUrl(profile),
    emailVerified: email !== null && profile.verified === true,
  };
}

const NORMALIZERS: Record<ProviderId, (profile: object) => NormalizedProfile> = {
  github: normalizeGitHubProfile,
  google: normalizeGoogleProfile,
  discord: normalizeDiscordProfile,
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Email, verification, and display name from the raw profile that @auth/core hands to the
 * `signIn` and `jwt` callbacks. Unknown providers and malformed profiles yield nothing verified.
 */
export function profileIdentity(provider: string, profile: unknown): ProfileIdentity {
  const none = { email: null, emailVerified: false, displayName: null };
  if (!isProviderId(provider) || typeof profile !== "object" || profile === null) return none;
  try {
    const { email, emailVerified, name } = NORMALIZERS[provider](profile);
    return { email, emailVerified, displayName: name };
  } catch {
    return none;
  }
}
