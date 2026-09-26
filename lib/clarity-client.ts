import { setTimeout as sleep } from "node:timers/promises";

/**
 * Dexcom Clarity, reached with a share code from the Clarity mobile app (Profile > Authorize
 * Sharing). This is the same unofficial interface clarity.dexcom.com uses for a shared view;
 * Dexcom may change it at any time.
 */

export type ClarityRegion = "us" | "ous";
export const CLARITY_REPORTS = [
  "overview",
  "patterns",
  "daily",
  "compare",
  "overlay",
  "hourlyStatistics",
  "dailyStatistics",
  "agp",
] as const;
export type ClarityReport = (typeof CLARITY_REPORTS)[number];

const hosts: Record<ClarityRegion, string> = {
  us: "https://clarity.dexcom.com",
  ous: "https://clarity.dexcom.eu",
};
// Finished reports are served from signed Google Cloud Storage URLs.
const REPORT_FILE_HOST = "storage.googleapis.com";
const MAX_REPORT_BYTES = 25_000_000;

/**
 * A failure whose message is safe to show. `code`: the share code no longer opens this account,
 * so retrying will not help. `setup`: Carby needs something fixed before it can sync.
 */
export class ClarityError extends Error {
  constructor(
    message: string,
    readonly kind: "code" | "unavailable" | "setup",
  ) {
    super(message);
  }
}
const rejected = () =>
  new ClarityError(
    "Clarity did not accept this share code. It may have expired or been revoked. Generate a new one in the Clarity app.",
    "code",
  );
const unavailable = () =>
  new ClarityError("Dexcom Clarity is unavailable. Try again later.", "unavailable");
const changed = () =>
  new ClarityError(
    "Dexcom Clarity returned an unexpected response. Its interface may have changed.",
    "unavailable",
  );

/** Twelve letters and digits, ignoring the dashes and spaces the app shows. */
export function normalizeShareCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{12}$/.test(code) ? code : null;
}

/** The date `days` after a YYYY-MM-DD date. */
export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
/** Clarity reads `start/end` as half-open, so an inclusive range ends the day after. */
function clarityRange(start: string, end: string) {
  return `${start}/${addDays(end, 1)}`;
}

export type ClaritySession = {
  region: ClarityRegion;
  accessToken: string;
  subjectId: string;
  /** When the share code stops working, from the redeemed token. */
  expiresAt: string;
  cookie: string;
  subject: { firstName: string; lastName: string; locale: string; country: string };
};

async function call(url: string, init: RequestInit = {}, timeout = 20000) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw unavailable();
  }
}
async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && !Array.isArray(data))
      return data as Record<string, unknown>;
  } catch {
    /* Fall through to the shared error. */
  }
  throw changed();
}
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Redeem the code, open the shared-view session, and read whose data it shows. */
export async function openClarity(code: string, region: ClarityRegion): Promise<ClaritySession> {
  const host = hosts[region];
  const redeemed = await call(`${host}/api/access_code/redeem?accesscode=${code}`);
  if (redeemed.status === 400 || redeemed.status === 401 || redeemed.status === 404)
    throw rejected();
  if (!redeemed.ok) throw unavailable();
  const accessToken = text((await json(redeemed)).accessToken);
  let claims: Record<string, unknown>;
  try {
    // The payload is ASCII JSON; atob accepts base64url once its two symbols are swapped back.
    claims = JSON.parse(atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    throw changed();
  }
  const subjectId = text(claims.subjectId);
  if (!subjectId || typeof claims.exp !== "number") throw changed();

  // The shared view keeps its session in a cookie. Clarity answers 302 either way; a code it
  // rejects is sent to the clinic sign-in instead of the shared view.
  const shared = await call(`${host}/user/sharing`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: host },
    body: new URLSearchParams({ sharing_code: code.match(/.{4}/g)!.join("-"), commit: "" }),
  });
  if (shared.status !== 302) throw unavailable();
  if (new URL(shared.headers.get("location") ?? "/clinic", host).pathname.startsWith("/clinic"))
    throw rejected();
  const cookie = shared.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith("_rogue_material_session="));
  if (!cookie) throw changed();

  const info = await call(`${host}/subject_info`, {
    headers: { "Access-Token": accessToken, Cookie: cookie },
  });
  if (info.status === 401) throw rejected();
  if (!info.ok) throw unavailable();
  const subject = await json(info);
  const firstName = text(subject.first_name),
    lastName = text(subject.last_name);
  if (!firstName && !lastName) throw changed();
  return {
    region,
    accessToken,
    subjectId,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    cookie,
    subject: {
      firstName,
      lastName,
      locale: text(subject.locale) || "en-US",
      country: text(subject.country) || "US",
    },
  };
}

/** The Clarity CSV export for inclusive local dates, always in mg/dL. */
export async function exportClarityCsv(session: ClaritySession, start: string, end: string) {
  const response = await call(
    `${hosts[session.region]}/api/subject/${session.subjectId}/export`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        dateInterval: clarityRange(start, end),
        accessToken: session.accessToken,
        firstName: session.subject.firstName,
        lastName: session.subject.lastName,
        locale: session.subject.locale,
        units: "mgdl",
      }),
    },
    90000,
  );
  if (response.status === 401 || response.status === 403) throw rejected();
  if (!response.ok) throw unavailable();
  if (!response.headers.get("content-type")?.includes("text/csv")) throw changed();
  return response.text();
}

/** Generate the chosen reports as one PDF for inclusive local dates and download it. */
export async function generateClarityReport(
  session: ClaritySession,
  reports: readonly ClarityReport[],
  start: string,
  end: string,
  timeZone: string,
): Promise<Uint8Array> {
  const host = hosts[session.region];
  const auth = { "Access-Token": session.accessToken, Cookie: session.cookie };
  const analysis = await call(`${host}/api/subject/${session.subjectId}/analysis_session`, {
    method: "POST",
    headers: auth,
  });
  if (analysis.status === 401) throw rejected();
  if (!analysis.ok) throw unavailable();
  const analysisSessionId = text((await json(analysis)).analysisSessionId);
  if (!analysisSessionId) throw changed();

  const callback = new URLSearchParams({
    reports: JSON.stringify(reports),
    analysisSessionId,
    dates: clarityRange(start, end),
    useGrayscale: "false",
  });
  const query = new URLSearchParams({
    locale: session.subject.locale,
    country: session.subject.country,
    units: "mgdl",
  });
  const generated = await call(`${host}/reports/generate?${query}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ callback_path: `/reports/combined?${callback}`, time_zone: timeZone }),
  });
  if (generated.status === 401) throw rejected();
  if (!generated.ok) throw unavailable();
  let progress = await json(generated);
  const statusUrl = text(progress.url);
  if (!statusUrl || new URL(statusUrl).origin !== host) throw changed();

  const deadline = Date.now() + 120000;
  for (let wait = 1000; progress.status !== "complete"; wait = Math.min(wait * 1.5, 5000)) {
    if (progress.status !== "generating" && progress.status !== "queued") throw unavailable();
    if (Date.now() + wait > deadline)
      throw new ClarityError(
        "Clarity took too long to build the report. Try again.",
        "unavailable",
      );
    await sleep(wait);
    const polled = await call(statusUrl);
    if (!polled.ok) throw unavailable();
    progress = await json(polled);
  }

  const urls = progress.urls && typeof progress.urls === "object" ? progress.urls : {};
  const fileUrl = text((urls as Record<string, unknown>).attachment) || text(progress.url);
  const file = new URL(fileUrl);
  if (file.protocol !== "https:" || file.host !== REPORT_FILE_HOST) throw changed();
  const pdf = await call(file.href, {}, 60000);
  if (!pdf.ok) throw unavailable();
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  if (bytes.length > MAX_REPORT_BYTES) throw changed();
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw changed();
  return bytes;
}
