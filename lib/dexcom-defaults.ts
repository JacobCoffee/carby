/**
 * Server-side Dexcom Share defaults from the environment.
 *
 * The environment can name a publisher account so the connect form opens prefilled instead of
 * blank. Only the username and region ever reach the browser: `publicDexcomDefaults` omits the
 * password, and `resolveDexcomCredentials` reads it on the server for one narrow case.
 *
 * Nothing here connects an account on its own. A configured password applies only when the
 * request asks for it, the signed-in owner is the one the defaults are scoped to, and the
 * submitted username and region still match the configured pair.
 */

export type DexcomRegion = "us" | "ous" | "jp";

export type DexcomEnvironment = {
  DEXCOM_USERNAME?: string;
  DEXCOM_PASSWORD?: string;
  DEXCOM_REGION?: string;
  DEXCOM_DEFAULT_OWNER?: string;
  CARBY_AUTH_MODE?: string;
  CARBY_LOCAL_LAUNCHER?: string;
};

/** What the browser may see. The password is never a field here. */
export type PublicDexcomDefaults = {
  username: string;
  region: DexcomRegion;
  hasPassword: boolean;
};

/** What the connect API submits to Dexcom Share. */
export type ResolvedDexcomCredentials = {
  username: string;
  password: string;
  region: string;
};

// Local records belong to this owner id; lib/local-session.ts pins the same value.
const LOCAL_OWNER = "local_dev";
const REGIONS: DexcomRegion[] = ["us", "ous", "jp"];
const DEFAULT_REGION: DexcomRegion = "us";

function currentEnvironment(): DexcomEnvironment {
  return typeof process === "undefined" || !process.env ? {} : (process.env as DexcomEnvironment);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The owner the configured account belongs to.
 *
 * A named owner is the whole rule. Without one, the defaults follow the same contract that
 * admits the local user in the first place — `localSessionConfig` in lib/local-session.ts — so
 * the fallback reaches exactly the sessions local sign-in can create, and nothing else.
 *
 * Both launcher variables are required, and only scripts/local-runtime.mjs sets them, so a
 * copied `CARBY_AUTH_MODE` alone opens nothing. NODE_ENV is deliberately not consulted: `make
 * start` builds and serves a local preview as production, and a Worker may carry no NODE_ENV at
 * all, so the build mode names neither the operator's intent nor the signed-in owner.
 * scripts/serve-production.mjs refuses to boot while either variable is set, which is what keeps
 * these defaults away from an OAuth user on a deployed build.
 */
function ownsDefaults(owner: string, environment: DexcomEnvironment): boolean {
  // A padded or otherwise inexact value matches nobody, which closes the defaults instead of
  // widening them to an owner the operator did not write down.
  if (text(environment.DEXCOM_DEFAULT_OWNER)) return owner === environment.DEXCOM_DEFAULT_OWNER;
  return (
    environment.CARBY_AUTH_MODE === "local" &&
    environment.CARBY_LOCAL_LAUNCHER === "1" &&
    owner === LOCAL_OWNER
  );
}

type ScopedDefaults = PublicDexcomDefaults & { password: string };

/**
 * The configured account for this owner, or null. A region the app cannot call makes the whole
 * entry unusable rather than silently sending the account to the wrong Dexcom endpoint.
 */
function scopedDefaults(owner: string, environment: DexcomEnvironment): ScopedDefaults | null {
  if (!owner || !ownsDefaults(owner, environment)) return null;
  const username = text(environment.DEXCOM_USERNAME);
  if (!username) return null;
  const configuredRegion = text(environment.DEXCOM_REGION).toLowerCase();
  const region = (configuredRegion || DEFAULT_REGION) as DexcomRegion;
  if (!REGIONS.includes(region)) return null;
  const password =
    typeof environment.DEXCOM_PASSWORD === "string" ? environment.DEXCOM_PASSWORD : "";
  return { username, region, hasPassword: password.length > 0, password };
}

/** The defaults the connect form may prefill. Returns null when this owner has none. */
export function publicDexcomDefaults(
  owner: string,
  environment: DexcomEnvironment = currentEnvironment(),
): PublicDexcomDefaults | null {
  const defaults = scopedDefaults(owner, environment);
  if (!defaults) return null;
  return {
    username: defaults.username,
    region: defaults.region,
    hasPassword: defaults.hasPassword,
  };
}

/**
 * The credentials a connect request should use.
 *
 * A password typed into the form always wins. The configured password applies only when the
 * request asks for it by name and the submitted account still matches the configured one, so
 * editing either field drops back to a typed password. An empty password is a valid answer here:
 * the caller's own validation rejects it and reports the missing field.
 */
export function resolveDexcomCredentials(
  owner: string,
  body: Record<string, unknown>,
  environment: DexcomEnvironment = currentEnvironment(),
): ResolvedDexcomCredentials {
  const defaults = scopedDefaults(owner, environment);
  const submittedUsername = text(body.username);
  const submittedRegion = text(body.region).toLowerCase();
  const username = submittedUsername || defaults?.username || "";
  const region = submittedRegion || defaults?.region || "";
  const typedPassword = typeof body.password === "string" ? body.password : "";
  if (typedPassword.length > 0) return { username, password: typedPassword, region };
  // The request has to name the account itself. A blank field falls back for the connect call,
  // but it never counts as a match, so an empty request cannot reach the configured password.
  const mayReuse =
    body.useConfiguredPassword === true &&
    !!defaults?.hasPassword &&
    submittedUsername === defaults.username &&
    submittedRegion === defaults.region;
  return { username, password: mayReuse ? defaults.password : "", region };
}
