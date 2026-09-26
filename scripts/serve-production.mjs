#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(`[serve-production] ${message}`);
  process.exit(1);
}

function requiredEnv(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) fail(`${name} is required in production and must not be blank.`);
  return value;
}

function optionalEnv(name) {
  const value = (process.env[name] ?? "").trim();
  return value === "" ? undefined : value;
}

// This launcher is the only supported production entrypoint; it always runs as production,
// regardless of what NODE_ENV happened to be set to in the inherited environment.
process.env.NODE_ENV = "production";

// Local-only sign-in must never activate in production, even if a leaked/copied .env sets these.
if (process.env.CARBY_LOCAL_LAUNCHER || process.env.CARBY_AUTH_MODE === "local") {
  fail(
    "CARBY_LOCAL_LAUNCHER / CARBY_AUTH_MODE=local must never be set in production. " +
      "Local sign-in is enabled only by scripts/local-runtime.mjs on loopback for local development.",
  );
}

const appUrl = requiredEnv("APP_URL");
let parsedAppUrl;
try {
  parsedAppUrl = new URL(appUrl);
} catch {
  fail("APP_URL must be an absolute URL.");
}
const appUrlIsCanonicalOrigin =
  parsedAppUrl.protocol === "https:" &&
  parsedAppUrl.username === "" &&
  parsedAppUrl.password === "" &&
  (parsedAppUrl.pathname === "/" || parsedAppUrl.pathname === "") &&
  parsedAppUrl.search === "" &&
  parsedAppUrl.hash === "";
if (!appUrlIsCanonicalOrigin) {
  fail(
    'APP_URL must be a canonical HTTPS origin only: no username/password, no path beyond "/", ' +
      "no query string, and no fragment.",
  );
}

const authSecret = requiredEnv("AUTH_SECRET");
if (!/^[A-Za-z0-9_-]{43,}$/.test(authSecret)) {
  fail(
    "AUTH_SECRET must be at least 43 base64url characters (32+ random bytes), the same shape " +
      "produced by `npx auth secret` or this repo's own local-dev secret generation.",
  );
}

const databaseUrl = requiredEnv("DATABASE_URL");
if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
  fail("DATABASE_URL must be a postgres:// or postgresql:// connection string.");
}

// Dexcom integration is optional until configured, but an invalid provided key fails closed
// rather than silently disabling Dexcom sync.
const dexcomSecretKey = optionalEnv("DEXCOM_SECRET_KEY");
if (dexcomSecretKey !== undefined && !/^[0-9a-f]{64}$/i.test(dexcomSecretKey)) {
  fail("DEXCOM_SECRET_KEY, if set, must be exactly 64 hex characters (32 bytes).");
}

const rawPort = optionalEnv("PORT") ?? "3000";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail(`PORT must be an integer from 1-65535, got "${rawPort}".`);
}
// Loopback by default: this process must never itself bind a public interface. In the Cabotage
// deployment, a socat bridge (scripts/start-web) forwards the Unix socket Cabotage expects to
// this loopback port. An operator deploying elsewhere may explicitly opt into a different HOST.
const host = optionalEnv("HOST") ?? "127.0.0.1";

// Only a local proxy (Cabotage via socat) can reach a loopback bind, so trust its
// X-Forwarded-Proto; otherwise HTTPS requests look like http:// and fail origin checks.
// vinext reads this once at module load, so vinext is imported only after it is set.
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
if (loopbackHosts.has(host) && optionalEnv("VINEXT_TRUST_PROXY") === undefined) {
  process.env.VINEXT_TRUST_PROXY = "1";
}

// The daily Clarity sync runs inside the app, reached over loopback with a token only this
// process knows. Accounts are claimed in the database, so every replica may run it.
const clarityScheduleEnv = optionalEnv("CARBY_CLARITY_SCHEDULE") ?? "on";
if (clarityScheduleEnv !== "on" && clarityScheduleEnv !== "off") {
  fail(`CARBY_CLARITY_SCHEDULE must be "on" or "off", got "${clarityScheduleEnv}".`);
}
const schedulerToken = randomBytes(32).toString("base64url");
if (clarityScheduleEnv === "on") process.env.CARBY_SCHEDULER_TOKEN = schedulerToken;
else delete process.env.CARBY_SCHEDULER_TOKEN;
const { startProdServer } = await import("vinext/server/prod-server");

// Resolve the build next to this script, so the working directory does not matter.
const outDir = fileURLToPath(new URL("../dist", import.meta.url));

const { server, port: actualPort } = await startProdServer({ port, host, outDir });

// vinext redirects /_health/ to /_health (308) before proxy.ts runs, so answer Cabotage's
// probe here, ahead of vinext's request pipeline. proxy.ts still covers dev and local start.
const [handleRequest] = server.listeners("request");
server.removeAllListeners("request");
server.on("request", (req, res) => {
  const pathname = (req.url ?? "").split("?", 1)[0];
  if (pathname === "/_health" || pathname === "/_health/") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end("ok");
    return;
  }
  handleRequest.call(server, req, res);
});
console.log(`[serve-production] listening on ${host}:${actualPort}`);

if (clarityScheduleEnv === "on") {
  const schedulerHost =
    host === "0.0.0.0"
      ? "127.0.0.1"
      : host.includes(":")
        ? `[${host === "::" ? "::1" : host}]`
        : host;
  const target = `http://${schedulerHost}:${actualPort}/api/clarity/scheduled`;
  let running = false;
  const runSchedule = async () => {
    if (running) return;
    running = true;
    try {
      const response = await fetch(target, {
        method: "POST",
        headers: { Authorization: `Bearer ${schedulerToken}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { synced, backfilled, failed } = await response.json();
      if (synced || backfilled || failed)
        console.log(
          `[clarity] scheduled sync: ${synced} synced, ${backfilled} gaps backfilled, ${failed} failed`,
        );
    } catch (error) {
      console.warn(
        `[clarity] scheduled sync did not run: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      running = false;
    }
  };
  setTimeout(runSchedule, 60_000).unref();
  setInterval(runSchedule, 3_600_000).unref();
}
