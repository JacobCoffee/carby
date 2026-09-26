import { Auth, type AuthConfig } from "@auth/core";
import { getToken } from "@auth/core/jwt";
import Discord from "@auth/core/providers/discord";
import GitHub from "@auth/core/providers/github";
import Google from "@auth/core/providers/google";
import type { Account } from "@auth/core/types";
import { isAllowedOwner, parseAllowlist, type AllowlistEnv } from "./auth-allowlist";
import { AUTH_BASE_PATH, canonicalOrigin, safeAuthRedirectPath } from "./auth-origin";
import {
  PROVIDER_IDS,
  githubVerifiedEmail,
  isProviderId,
  normalizeDiscordProfile,
  normalizeGitHubProfile,
  normalizeGoogleProfile,
  profileIdentity,
  type ProviderId,
} from "./auth-providers";
import { SIGN_IN_PATH } from "./local-session";

export type AuthEnv = AllowlistEnv & {
  APP_URL?: string;
  AUTH_SECRET?: string;
  AUTH_GITHUB_ID?: string;
  AUTH_GITHUB_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
  AUTH_DISCORD_ID?: string;
  AUTH_DISCORD_SECRET?: string;
  CARBY_AUTH_MODE?: string;
  CARBY_LOCAL_SESSION_SECRET?: string;
  CARBY_LOCAL_LAUNCHER?: string;
};

export type OAuthUser = { userId: string; displayName: string };

// A short secret would let anyone holding a session cookie brute-force the encryption key.
const MIN_SECRET_LENGTH = 32;
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

function present(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function authSecret(env: AuthEnv): string | null {
  const secret = present(env.AUTH_SECRET);
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

const CREDENTIAL_KEYS = {
  github: ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"],
  google: ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"],
  discord: ["AUTH_DISCORD_ID", "AUTH_DISCORD_SECRET"],
} as const satisfies Record<ProviderId, readonly [keyof AuthEnv, keyof AuthEnv]>;

function credentials(env: AuthEnv, provider: ProviderId) {
  const [idKey, secretKey] = CREDENTIAL_KEYS[provider];
  const clientId = present(env[idKey]);
  const clientSecret = present(env[secretKey]);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function enabled(env: AuthEnv): boolean {
  return canonicalOrigin(env) !== null && authSecret(env) !== null;
}

/** Providers with both credentials set, in a fixed order; none while OAuth itself is off. */
export function configuredProviderIds(env: AuthEnv): ProviderId[] {
  if (!enabled(env)) return [];
  return PROVIDER_IDS.filter((id) => credentials(env, id) !== null);
}

async function githubUserinfo({ tokens }: { tokens: { access_token?: string } }) {
  const headers = { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": "authjs" };
  const user = await fetch(GITHUB_USER_URL, { headers });
  if (!user.ok) throw new Error(`GitHub user lookup failed with status ${user.status}.`);
  const profile = await user.json();
  // The public `email` on /user is never verified, so it is always replaced.
  const emails = await fetch(GITHUB_EMAILS_URL, { headers });
  const verified = emails.ok
    ? githubVerifiedEmail(await emails.json())
    : { email: null, emailVerified: false };
  return { ...profile, ...verified };
}

function providers(env: AuthEnv): AuthConfig["providers"] {
  const list: AuthConfig["providers"] = [];
  const github = credentials(env, "github");
  if (github) {
    list.push(
      GitHub({ ...github, userinfo: { request: githubUserinfo }, profile: normalizeGitHubProfile }),
    );
  }
  const google = credentials(env, "google");
  if (google) list.push(Google({ ...google, profile: normalizeGoogleProfile }));
  const discord = credentials(env, "discord");
  if (discord) list.push(Discord({ ...discord, profile: normalizeDiscordProfile }));
  return list;
}

/** `provider:subject`, the stable owner id for an OAuth account. No cross-provider linking. */
export function oauthOwnerId(account: Account | null | undefined): string | null {
  if (!account || (account.type !== "oauth" && account.type !== "oidc")) return null;
  if (!isProviderId(account.provider)) return null;
  const subject = account.providerAccountId;
  if (typeof subject !== "string" || !subject.trim()) return null;
  return `${account.provider}:${subject}`;
}

/** Same-origin redirects only, mirroring @auth/core's default callback. */
export function authRedirectUrl(url: string, baseUrl: string): string {
  const origin = new URL(baseUrl).origin;
  let path = url;
  if (!url.startsWith("/")) {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return baseUrl;
    }
    if (target.origin !== origin) return baseUrl;
    path = `${target.pathname}${target.search}${target.hash}`;
  }
  // Sign-out lands on the sign-in chooser, which never signs anyone in by itself.
  if (path === SIGN_IN_PATH) return `${origin}${SIGN_IN_PATH}`;
  return `${origin}${safeAuthRedirectPath(path)}`;
}

/** The @auth/core config, or null when OAuth is unavailable. Nobody is ever admitted by default. */
export function buildAuthConfig(env: AuthEnv): AuthConfig | null {
  const origin = canonicalOrigin(env);
  const secret = authSecret(env);
  if (!origin || !secret) return null;
  const configured = providers(env);
  if (configured.length === 0) return null;
  return {
    trustHost: true,
    basePath: AUTH_BASE_PATH,
    secret,
    useSecureCookies: origin.protocol === "https:",
    session: { strategy: "jwt" },
    providers: configured,
    pages: { signIn: SIGN_IN_PATH, error: SIGN_IN_PATH },
    callbacks: {
      signIn({ account, profile }) {
        const ownerId = oauthOwnerId(account);
        if (!ownerId || !account) return false;
        const { email, emailVerified } = profileIdentity(account.provider, profile);
        return isAllowedOwner(parseAllowlist(env), ownerId, email, emailVerified);
      },
      jwt({ token, account, profile }) {
        // Runs on every session read too, so a revoked owner's cookie is cleared, not renewed.
        if (!account) return tokenStillAllowed(token, env) ? token : null;
        const ownerId = oauthOwnerId(account);
        if (!ownerId) return null;
        const identity = profileIdentity(account.provider, profile);
        return {
          ownerId,
          displayName: identity.displayName ?? ownerId,
          email: identity.email,
          emailVerified: identity.emailVerified,
        };
      },
      redirect({ url, baseUrl }) {
        return authRedirectUrl(url, baseUrl);
      },
    },
  };
}

function secureCookie(env: AuthEnv): boolean {
  return canonicalOrigin(env)?.protocol === "https:";
}

function tokenStillAllowed(
  token: Record<string, unknown>,
  env: AuthEnv,
): token is Record<string, unknown> & { ownerId: string } {
  const { ownerId, email, emailVerified } = token;
  if (typeof ownerId !== "string" || !ownerId) return false;
  const verifiedEmail = typeof email === "string" ? email : null;
  return isAllowedOwner(parseAllowlist(env), ownerId, verifiedEmail, emailVerified === true);
}

/** True when the request carries any OAuth session cookie, valid or not, including chunks. */
export function hasOAuthSessionCookie(headers: Pick<Headers, "get">, env: AuthEnv): boolean {
  const name = `${secureCookie(env) ? "__Secure-" : ""}authjs.session-token`;
  return cookiePairs(headers.get("cookie")).some((pair) => {
    const key = pairName(pair);
    return key === name || (key.startsWith(`${name}.`) && /^\d+$/.test(key.slice(name.length + 1)));
  });
}

/**
 * The OAuth user for a valid session cookie. The allowlist is checked again on every call, so
 * removing an entry revokes existing sessions at once. Only the cookie is read, never a header.
 */
export async function oauthSessionUser(
  headers: Pick<Headers, "get">,
  env: AuthEnv,
): Promise<OAuthUser | null> {
  const secret = authSecret(env);
  const cookie = headers.get("cookie");
  if (!secret || !cookie || !buildAuthConfig(env)) return null;
  const token = await getToken({
    req: { headers: new Headers({ cookie }) },
    secret,
    secureCookie: secureCookie(env),
  });
  if (!token || !tokenStillAllowed(token, env)) return null;
  const { ownerId, displayName } = token;
  return {
    userId: ownerId,
    displayName: typeof displayName === "string" && displayName ? displayName : ownerId,
  };
}

/**
 * A CSRF token from @auth/core's own `csrf` action, run in-process. `setCookies` is empty when
 * the given cookies already carry a valid CSRF cookie, which @auth/core then reuses.
 */
export async function issueCsrfToken(
  config: AuthConfig,
  origin: URL,
  cookie: string | null,
): Promise<{ csrfToken: string; setCookies: string[] }> {
  const request = new Request(new URL(`${AUTH_BASE_PATH}/csrf`, origin), {
    headers: cookie ? { cookie } : {},
  });
  const response = await Auth(request, config);
  const body = response.ok ? await response.json().catch(() => null) : null;
  const csrfToken = body?.csrfToken;
  if (typeof csrfToken !== "string" || !csrfToken) throw new Error("Auth.js issued no CSRF token.");
  return { csrfToken, setCookies: response.headers.getSetCookie() };
}

export function csrfCookieName(origin: URL): string {
  return `${origin.protocol === "https:" ? "__Host-" : ""}authjs.csrf-token`;
}

function cookiePairs(header: string | null): string[] {
  return (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean);
}

function pairName(pair: string): string {
  const index = pair.indexOf("=");
  return (index === -1 ? pair : pair.slice(0, index)).trim();
}

/** Only the incoming CSRF cookie, so @auth/core can reuse it without reading anything else. */
export function csrfCookieOnly(header: string | null, origin: URL): string | null {
  const name = csrfCookieName(origin);
  return cookiePairs(header).find((pair) => pairName(pair) === name) ?? null;
}

/** The incoming cookies with the CSRF cookie swapped for one @auth/core just issued, if any. */
export function withIssuedCsrfCookie(header: string | null, origin: URL, setCookies: string[]) {
  const name = csrfCookieName(origin);
  const issued = setCookies
    .map((value) => value.split(";")[0].trim())
    .find((pair) => pairName(pair) === name);
  const pairs = cookiePairs(header);
  if (!issued) return pairs.join("; ");
  return [...pairs.filter((pair) => pairName(pair) !== name), issued].join("; ");
}
