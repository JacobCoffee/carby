import { safeReturnPath } from "./local-session";

export const AUTH_BASE_PATH = "/api/auth";

/** The deployment's public origin from `APP_URL`, or null unless it is an absolute http(s) URL. */
export function canonicalOrigin(env: { APP_URL?: string }): URL | null {
  const value = env.APP_URL?.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password || !parsed.hostname) return null;
  return new URL(`${parsed.origin}/`);
}

/**
 * Copy the request onto the canonical origin, keeping path, query, method, headers, and body.
 * This rewrite is the only reason `trustHost: true` is safe: @auth/core builds every callback
 * and redirect URL from `request.url`, so it must never see a client-chosen Host.
 */
export function withCanonicalOrigin(request: Request, origin: URL): Request {
  const source = new URL(request.url);
  const url = new URL(`${source.pathname}${source.search}${source.hash}`, origin);
  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? request.body : undefined,
    redirect: request.redirect,
    signal: request.signal,
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

function isAuthRoute(path: string): boolean {
  const pathname = new URL(path, "http://return.invalid").pathname.toLowerCase();
  const base = AUTH_BASE_PATH.toLowerCase();
  return pathname === base || pathname.startsWith(`${base}/`) || pathname.startsWith(`${base}%2f`);
}

/** Like `safeReturnPath`, and also never back into the OAuth routes. */
export function safeAuthRedirectPath(value: string | null | undefined): string {
  const path = safeReturnPath(value ?? null);
  return isAuthRoute(path) ? "/" : path;
}
