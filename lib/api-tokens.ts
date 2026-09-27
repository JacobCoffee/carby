import { z } from "zod";
import { can, type Need, type PersonRole } from "./people";

/**
 * API tokens reach one person's data without a browser session, for Nightscout uploaders and
 * readers. `read` covers glucose and log entries; `upload` writes them. Neither reaches the care
 * plan, sharing or backups.
 */
export const apiScopes = ["read", "upload"] as const;
export type ApiScope = (typeof apiScopes)[number];
/** How a token list names what a token does. */
export function scopeSummary(scopes: readonly ApiScope[]): string {
  if (scopes.includes("read") && scopes.includes("upload")) return "Reads and uploads";
  return scopes.includes("upload") ? "Uploads only" : "Reads only";
}
/** The access the token's account must still have for each scope to work. */
export const scopeNeed: Record<ApiScope, Need> = { read: "read", upload: "log" };
export const MAX_TOKENS_PER_ACCOUNT = 20;
export const TOKEN_LABEL_MAX = 60;

/** The scopes an account with `role` may give its tokens: viewers read only. */
export function allowedScopes(role: PersonRole): ApiScope[] {
  return apiScopes.filter((scope) => can(role, scopeNeed[scope]));
}

export const tokenScopesSchema = z
  .array(z.enum(apiScopes))
  .min(1)
  .transform((scopes) => apiScopes.filter((scope) => scopes.includes(scope)));

/** Token actions, posted to /api/people beside the sharing actions. */
export const tokenActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("createToken"),
    label: z.string().trim().min(1).max(TOKEN_LABEL_MAX),
    scopes: tokenScopesSchema,
  }),
  z.object({ action: z.literal("revokeToken"), id: z.string().uuid() }),
]);

/** Stored as space-separated names; anything unknown is ignored. */
export function parseScopes(stored: string): ApiScope[] {
  const names = stored.split(" ");
  return apiScopes.filter((scope) => names.includes(scope));
}

export const API_TOKEN_PATTERN = /^carby-[0-9a-f]{32}$/;
/**
 * A new token: 128 random bits in lowercase hex. It is safe in a URL's user part, where some
 * uploaders take it (`https://TOKEN@host`), and survives clients that change letter case.
 */
export function newApiToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `carby-${hex(bytes)}`;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function digest(algorithm: "SHA-1" | "SHA-256", text: string) {
  return hex(new Uint8Array(await crypto.subtle.digest(algorithm, new TextEncoder().encode(text))));
}
/** How a token sent as-is is found. */
export const tokenHash = (token: string) => digest("SHA-256", token);
/** How a token is found from the `api-secret` header, which Nightscout clients send as SHA-1. */
export const tokenSecret = (token: string) => digest("SHA-1", token);

/** A token as a request carries it. */
export type Credential =
  | { kind: "token"; token: string }
  | { kind: "secret"; sha1: string }
  | { kind: "jwt"; jwt: string };

const SHA1_HEX = /^[0-9a-f]{40}$/i;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function basicUser(value: string): string | null {
  try {
    const decoded = atob(value);
    const colon = decoded.indexOf(":");
    const user = colon === -1 ? decoded : decoded.slice(0, colon);
    const password = colon === -1 ? "" : decoded.slice(colon + 1);
    return decodeURIComponent(user || password) || null;
  } catch {
    return null;
  }
}

/**
 * The token a Nightscout client sent, in any of the forms they use: the `api-secret` header (the
 * token's SHA-1, or the token itself), `Authorization: Bearer` with a JWT from
 * /api/v2/authorization/request or the token itself, `Authorization: Basic` from a
 * `https://TOKEN@host` URL, or `?token=`.
 */
export function requestCredential(request: Request): Credential | null {
  const secret = request.headers.get("api-secret")?.trim();
  if (secret)
    return SHA1_HEX.test(secret)
      ? { kind: "secret", sha1: secret.toLowerCase() }
      : { kind: "token", token: secret };
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const [scheme = "", value = ""] = authorization.split(/\s+/, 2);
  if (scheme.toLowerCase() === "bearer" && value)
    return JWT_SHAPE.test(value) ? { kind: "jwt", jwt: value } : { kind: "token", token: value };
  if (scheme.toLowerCase() === "basic" && value) {
    const token = basicUser(value);
    if (token) return { kind: "token", token };
  }
  const token = new URL(request.url).searchParams.get("token")?.trim();
  return token ? { kind: "token", token } : null;
}

/** Nightscout lets a JWT from /api/v2/authorization/request live 8 hours. */
export const JWT_SECONDS = 8 * 3600;
const encoder = new TextEncoder();
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function fromBase64url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );
}
/**
 * Each JWT is signed with a key only the token's stored hash gives, so no server-wide secret is
 * needed, a JWT can't outlive its token, and revoking the token stops it at once.
 */
function jwtKey(storedHash: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`carby-api-jwt:${storedHash}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}
const JWT_HEADER = base64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
const jwtPayloadSchema = z.object({ tid: z.string().uuid(), iat: z.number(), exp: z.number() });

export async function signJwt(
  tokenId: string,
  storedHash: string,
  label: string,
  nowSeconds: number,
) {
  const iat = Math.floor(nowSeconds);
  const exp = iat + JWT_SECONDS;
  const body = `${JWT_HEADER}.${base64url(encoder.encode(JSON.stringify({ tid: tokenId, sub: label, iat, exp })))}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await jwtKey(storedHash, "sign"),
    encoder.encode(body),
  );
  return { jwt: `${body}.${base64url(new Uint8Array(signature))}`, iat, exp };
}

/** The token id a JWT names, before its signature is checked. */
export function jwtTokenId(jwt: string): string | null {
  const [header, payload] = jwt.split(".");
  if (header !== JWT_HEADER || !payload) return null;
  try {
    const parsed = jwtPayloadSchema.safeParse(
      JSON.parse(new TextDecoder().decode(fromBase64url(payload))),
    );
    return parsed.success ? parsed.data.tid : null;
  } catch {
    return null;
  }
}

/** Whether the JWT was signed for this token and has not expired. */
export async function verifyJwt(jwt: string, storedHash: string, nowSeconds: number) {
  const [header, payload, signature] = jwt.split(".");
  if (header !== JWT_HEADER || !payload || !signature) return false;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await jwtKey(storedHash, "verify"),
      fromBase64url(signature),
      encoder.encode(`${header}.${payload}`),
    );
    if (!valid) return false;
    const parsed = jwtPayloadSchema.safeParse(
      JSON.parse(new TextDecoder().decode(fromBase64url(payload))),
    );
    return parsed.success && parsed.data.exp > nowSeconds;
  } catch {
    return false;
  }
}

/** Nightscout permission strings for a token's scopes, as /api/v2/authorization reports them. */
export function nightscoutPermissions(scopes: readonly ApiScope[]): string[] {
  return [
    ...(scopes.includes("read") ? ["api:*:read"] : []),
    ...(scopes.includes("upload") ? ["api:*:create", "api:*:update", "api:*:delete"] : []),
  ];
}
