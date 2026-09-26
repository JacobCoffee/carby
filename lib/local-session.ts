/**
 * Signed session for local development sign-in. Only the local launchers (`make serve` and
 * `make start`) enable it, so a deployed build never accepts a local session.
 */

type LocalSessionEnv = {
  CARBY_AUTH_MODE?: string;
  CARBY_LOCAL_SESSION_SECRET?: string;
  CARBY_LOCAL_LAUNCHER?: string;
};
type HeaderReader = Pick<Headers, "get" | "has">;

export type LocalSessionConfig = { secret: string };
export type LocalUser = { userId: string; displayName: string };

export const LOCAL_SESSION_COOKIE = "carby_local_session";
export const SIGN_IN_PATH = "/signin";
export const SIGN_OUT_PATH = "/signout";
// Existing local records belong to this owner id; changing it would orphan them.
export const LOCAL_USER = { userId: "local_dev", displayName: "Local Developer" } as const;

const SESSION_SECONDS = 12 * 60 * 60;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43,}$/;
const TOKEN_PATTERN = /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})$/;
const HOST_PATTERN = /^[A-Za-z0-9.:[\]-]+$/;
const PREFETCH_PATTERN = /(^|[\s,;])prefetch($|[\s,;])/i;
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const FORWARDING_HEADERS = ["forwarded", "x-forwarded-for", "x-real-ip", "true-client-ip"];
const PURPOSE_HEADERS = ["sec-purpose", "purpose", "x-purpose", "x-moz"];
const RETURN_BASE = "http://return.invalid";
const HMAC = { name: "HMAC", hash: "SHA-256" };
const NO_STORE = { "Cache-Control": "no-store" };
const encoder = new TextEncoder();

/**
 * Local sign-in settings, or null unless the launcher enabled local mode with a strong secret.
 * Only the local launcher sets `CARBY_LOCAL_LAUNCHER`, so a leaked auth mode alone does nothing.
 */
export function localSessionConfig(env: LocalSessionEnv): LocalSessionConfig | null {
  const secret = env.CARBY_LOCAL_SESSION_SECRET;
  if (env.CARBY_AUTH_MODE !== "local" || env.CARBY_LOCAL_LAUNCHER !== "1") return null;
  if (!secret || !SECRET_PATTERN.test(secret)) return null;
  return { secret };
}

function hostname(host: string | null): string | null {
  if (!host || !HOST_PATTERN.test(host)) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

/** True only for a direct request to a loopback host that no proxy or tunnel forwarded. */
export function isLoopbackRequest(headers: HeaderReader, url?: URL): boolean {
  const host = hostname(headers.get("host"));
  if (!host || !LOOPBACK_HOSTNAMES.has(host) || (url && url.hostname !== host)) return false;
  const forwardedHost = headers.get("x-forwarded-host");
  if (forwardedHost !== null && hostname(forwardedHost) !== host) return false;
  const client = headers.get("cf-connecting-ip");
  if (client !== null && !LOOPBACK_ADDRESSES.has(client.trim().toLowerCase())) return false;
  return !FORWARDING_HEADERS.some((name) => headers.has(name));
}

/** Keep a redirect on this origin, and never send it back to a sign-in route. */
export function safeReturnPath(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  let url: URL;
  try {
    url = new URL(value, RETURN_BASE);
  } catch {
    return "/";
  }
  if (url.origin !== RETURN_BASE || url.pathname.startsWith("//")) return "/";
  if (url.pathname === SIGN_IN_PATH || url.pathname === SIGN_OUT_PATH) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function localSignInPath(returnTo: string): string {
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function signingKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", encoder.encode(secret), HMAC, false, [usage]);
}

function sessionPayload(expires: number) {
  return encoder.encode(`carby-local-session:v1:${LOCAL_USER.userId}:${expires}`);
}

export async function createLocalSessionToken(secret: string, now = Date.now()) {
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  const key = await signingKey(secret, "sign");
  const signature = await crypto.subtle.sign("HMAC", key, sessionPayload(expires));
  return `v1.${expires}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Check the signature and expiry. A lifetime longer than one session is also refused. */
export async function verifyLocalSessionToken(token: string, secret: string, now = Date.now()) {
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + SESSION_SECONDS) return false;
  const key = await signingKey(secret, "verify");
  return crypto.subtle.verify("HMAC", key, fromBase64Url(match[2]), sessionPayload(expires));
}

function sessionCookies(header: string | null): string[] {
  const prefix = `${LOCAL_SESSION_COOKIE}=`;
  return (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix))
    .map((part) => part.slice(prefix.length));
}

/** The local user for a valid session cookie. Identity headers are never read. */
export async function localSessionUser(
  headers: HeaderReader,
  config: LocalSessionConfig | null,
  now = Date.now(),
): Promise<LocalUser | null> {
  if (!config || !isLoopbackRequest(headers)) return null;
  const tokens = sessionCookies(headers.get("cookie"));
  if (tokens.length !== 1) return null;
  const valid = await verifyLocalSessionToken(tokens[0], config.secret, now);
  return valid ? { ...LOCAL_USER } : null;
}

export function canStartLocalSignIn(headers: HeaderReader, config: LocalSessionConfig | null) {
  return config !== null && isLoopbackRequest(headers);
}

export function isSameOriginNavigation(headers: HeaderReader, origin: string): boolean {
  const requestOrigin = headers.get("origin");
  if (requestOrigin !== null && requestOrigin !== origin) return false;
  const site = headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

export function isPrefetch(headers: HeaderReader): boolean {
  if (headers.has("next-router-prefetch")) return true;
  return PURPOSE_HEADERS.some((name) => PREFETCH_PATTERN.test(headers.get(name) ?? ""));
}

export function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function refuseUntrusted(request: Request, url: URL): Response | null {
  if (!isLoopbackRequest(request.headers, url)) {
    return textResponse(403, "Local sign-in works only when you open Carby on localhost.");
  }
  if (!isSameOriginNavigation(request.headers, url.origin)) {
    return textResponse(403, "Open Carby directly to sign in. Cross-site sign-in is refused.");
  }
  if (isPrefetch(request.headers)) return new Response(null, { status: 204, headers: NO_STORE });
  return null;
}

function sessionCookie(value: string, maxAge: number, secure: boolean): string {
  const attributes = [`Max-Age=${maxAge}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) attributes.push("Secure");
  return [`${LOCAL_SESSION_COOKIE}=${value}`, ...attributes].join("; ");
}

function redirectWithCookie(location: string, cookie: string): Response {
  return new Response(null, {
    status: 302,
    headers: { ...NO_STORE, Location: location, "Set-Cookie": cookie },
  });
}

// A page, not a redirect: redirecting to a protected page would sign the user straight back in.
function signedOutPage(signInPath: string, cookie: string): Response {
  const body = [
    '<!doctype html><meta charset="utf-8"><title>Signed out · Carby</title>',
    `<p>You are signed out of Carby. <a href="${signInPath}">Sign in again</a></p>`,
  ].join("");
  return new Response(body, {
    headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "Set-Cookie": cookie },
  });
}

export async function handleLocalSignIn(
  request: Request,
  config: LocalSessionConfig | null,
  now = Date.now(),
): Promise<Response> {
  if (!config) return textResponse(404, "Not found.");
  const url = new URL(request.url);
  const refused = refuseUntrusted(request, url);
  if (refused) return refused;
  const token = await createLocalSessionToken(config.secret, now);
  const cookie = sessionCookie(token, SESSION_SECONDS, url.protocol === "https:");
  return redirectWithCookie(safeReturnPath(url.searchParams.get("return_to")), cookie);
}

export function handleLocalSignOut(request: Request, config: LocalSessionConfig | null) {
  if (!config) return textResponse(404, "Not found.");
  const url = new URL(request.url);
  const refused = refuseUntrusted(request, url);
  if (refused) return refused;
  const cookie = sessionCookie("", 0, url.protocol === "https:");
  return signedOutPage(localSignInPath(url.searchParams.get("return_to") ?? "/"), cookie);
}
