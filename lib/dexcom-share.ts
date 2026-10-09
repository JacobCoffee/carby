import type { CgmReading } from "./care";
import { parseShareValues } from "./dexcom-values";

export type ShareCredentials = {
  username: string;
  password: string;
  region: "us" | "ous" | "jp";
  sessionId?: string;
};
const endpoints = {
  us: "https://share2.dexcom.com/ShareWebServices/Services/",
  ous: "https://shareous1.dexcom.com/ShareWebServices/Services/",
  jp: "https://share.dexcom.jp/ShareWebServices/Services/",
};
const appIds = {
  us: "d89443d2-327c-4a6f-89e5-496bbb0317db",
  ous: "d89443d2-327c-4a6f-89e5-496bbb0317db",
  jp: "d8665ade-9673-4e27-9ff6-92db4ce13d13",
};

function keyBytes() {
  const hex = process.env.DEXCOM_SECRET_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error("Dexcom connection is not configured.");
  return Uint8Array.from(hex.match(/../g)!, (v) => parseInt(v, 16));
}
async function key() {
  return crypto.subtle.importKey("raw", keyBytes(), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}
function b64(bytes: Uint8Array) {
  let data = "";
  for (const byte of bytes) data += String.fromCharCode(byte);
  return btoa(data);
}
function unb64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/** Encrypt a stored sign-in using a server-only key and a fresh nonce, bound to `context`. */
export async function seal(value: unknown, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    await key(),
    data,
  );
  return `${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
export async function unseal<T = ShareCredentials>(value: string, context: string): Promise<T> {
  const [iv, encrypted] = value.split(".");
  if (!iv || !encrypted) throw new Error("Dexcom connection needs to be set up again.");
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(context) },
    await key(),
    unb64(encrypted),
  );
  return JSON.parse(new TextDecoder().decode(data)) as T;
}

/** Dexcom asked Carby to slow down. `retryAfterMs` is Dexcom's own wait, when it sent one. */
export class ShareRateLimited extends Error {
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

/** A Retry-After header, in either its seconds or its HTTP-date form, as milliseconds from `now`. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Request recent values from Dexcom Share, following pydexcom's three calls. `onSession` receives
 * each new session as soon as sign-in opens it, so a read that fails afterwards does not cost
 * another sign-in on the next attempt.
 */
export async function fetchShare(
  credentials: ShareCredentials,
  onSession?: (sessionId: string) => Promise<void>,
): Promise<{ readings: CgmReading[]; sessionId: string; rawCount: number }> {
  const base = endpoints[credentials.region],
    applicationId = appIds[credentials.region];
  async function post(path: string, body?: unknown, params?: URLSearchParams): Promise<unknown> {
    const response = await fetch(base + path + (params ? "?" + params : ""), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(12000),
    });
    const text = await response.text();
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      console.error("dexcom share rate limited", { path, retryAfter });
      throw new ShareRateLimited(
        "Dexcom is limiting requests, so Share sync is paused.",
        retryAfterMs(retryAfter),
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // Gateways in front of Share answer rate limits and outages with HTML. The body is not
      // logged: an error page can echo the URL, which carries the session id.
      console.error("dexcom share non-JSON reply", {
        path,
        status: response.status,
        type: response.headers.get("content-type"),
        length: text.length,
      });
      if (!response.ok) throw new Error("Dexcom Share is unavailable. Try again later.");
      throw new Error("Dexcom Share returned an unreadable response.");
    }
    const code = data && typeof data === "object" && "Code" in data ? String(data.Code) : "";
    if (code === "SessionIdNotFound" || code === "SessionNotValid")
      throw new Error("Dexcom session expired.");
    if (code === "AccountPasswordInvalid" || code === "SSO_InternalError")
      throw new Error("Dexcom rejected the publisher account credentials.");
    if (code === "SSO_AuthenticateMaxAttemptsExceeded")
      throw new ShareRateLimited(
        "Dexcom temporarily blocked sign-in attempts. Wait before trying again.",
        null,
      );
    if (!response.ok) throw new Error("Dexcom Share is unavailable. Try again later.");
    return data;
  }
  async function login() {
    const account = await post("General/AuthenticatePublisherAccount", {
      accountName: credentials.username,
      password: credentials.password,
      applicationId,
    });
    if (typeof account !== "string" || !/^[-\da-f]{36}$/i.test(account))
      throw new Error(
        "Dexcom could not verify this account. Check that Share is enabled with a follower.",
      );
    const session = await post("General/LoginPublisherAccountById", {
      accountId: account,
      password: credentials.password,
      applicationId,
    });
    if (
      typeof session !== "string" ||
      !/^[-\da-f]{36}$/i.test(session) ||
      session === "00000000-0000-0000-0000-000000000000"
    )
      throw new Error("Dexcom Share session could not be opened.");
    await onSession?.(session);
    return session;
  }
  let sessionId = credentials.sessionId ?? (await login());
  let values: unknown;
  try {
    values = await post(
      "Publisher/ReadPublisherLatestGlucoseValues",
      undefined,
      new URLSearchParams({ sessionId, minutes: "1440", maxCount: "288" }),
    );
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "Dexcom session expired.") throw e;
    sessionId = await login();
    values = await post(
      "Publisher/ReadPublisherLatestGlucoseValues",
      undefined,
      new URLSearchParams({ sessionId, minutes: "1440", maxCount: "288" }),
    );
  }
  // Share can return an empty list for a stale cached session without an expiry error.
  if (
    credentials.sessionId &&
    Array.isArray(values) &&
    values.length === 0 &&
    sessionId === credentials.sessionId
  ) {
    sessionId = await login();
    values = await post(
      "Publisher/ReadPublisherLatestGlucoseValues",
      undefined,
      new URLSearchParams({ sessionId, minutes: "1440", maxCount: "288" }),
    );
  }
  if (!Array.isArray(values)) throw new Error("Dexcom returned unexpected glucose data.");
  const readings = parseShareValues(values);
  return { readings, sessionId, rawCount: values.length };
}
