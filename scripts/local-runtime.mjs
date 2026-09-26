import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotenv } from "vinext/internal/config/dotenv";

// Runs Carby on this machine through vinext's own CLI. `dev` and `start` enable local sign-in,
// listen on loopback only, and start a local Postgres via Docker Compose when DATABASE_URL is
// unset. `build` never receives the sign-in settings or touches a database.
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const localDirectory = path.join(projectRoot, ".carby-local");
const sessionFile = path.join(localDirectory, "session.env");
const secretLine = /^CARBY_LOCAL_SESSION_SECRET=([A-Za-z0-9_-]{43,})$/m;
const LOCAL_DATABASE_URL = "postgres://carby:carby@127.0.0.1:55432/carby";
// Pin the Compose project and file so inherited COMPOSE_* variables can't redirect them.
const LOCAL_COMPOSE_PROJECT = "carby-local";
const localComposeFile = path.join(projectRoot, "compose.yaml");

function fail(message) {
  console.error(message);
  process.exit(64);
}

const port = {
  hint: "a port from 1 to 65535",
  valid: (value) => /^[1-9]\d{0,4}$/.test(value) && Number(value) <= 65535,
};

/**
 * Ensure a database is reachable for local dev/start. If the developer has set DATABASE_URL
 * themselves (even pointing at a remote/shared database), this never touches it or runs
 * migrations against it — only `make migrate`, run explicitly, does that. Only when
 * DATABASE_URL is unset/blank does this provision our own sandboxed local Postgres via Docker
 * Compose (loopback-only, fixed local-only credentials) and report that migrations should run
 * automatically against it.
 *
 * `mode` must match the mode vinext's CLI loads .env files with, so a DATABASE_URL set in .env
 * counts as set by the developer. vinext's later load is then a no-op for these keys.
 */
function ensureLocalDatabase(mode) {
  loadDotenv({ root: projectRoot, mode });
  if ((process.env.DATABASE_URL ?? "").trim()) return { autoMigrate: false };
  console.log(
    "DATABASE_URL is not set; starting a local Postgres via Docker Compose (loopback-only)...",
  );
  const compose = spawnSync(
    "docker",
    [
      "compose",
      "--project-name",
      LOCAL_COMPOSE_PROJECT,
      "--file",
      localComposeFile,
      "up",
      "-d",
      "--wait",
      "postgres",
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );
  if (compose.status !== 0) {
    fail(
      "Could not start the local Postgres container. Docker must be installed and running to " +
        "self-provision a local database, or set DATABASE_URL yourself to use an existing Postgres instance.",
    );
  }
  process.env.DATABASE_URL = LOCAL_DATABASE_URL;
  return { autoMigrate: true };
}

/** Run scripts/migrate.mjs as a child process, inheriting the resolved DATABASE_URL. */
function runMigrations() {
  const migrate = spawnSync(process.execPath, [path.join(projectRoot, "scripts/migrate.mjs")], {
    stdio: "inherit",
    env: process.env,
  });
  if (migrate.status !== 0) fail("Database migration failed.");
}

/**
 * Pass through only the listed value-taking options, and only checked values, so no option can
 * leave loopback. A value that looks like a flag (`--port --ip=0.0.0.0`) fails its check.
 */
function allowedArgs(args, options) {
  const flags = Object.keys(options);
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag] = arg.split("=", 1);
    if (!Object.hasOwn(options, flag)) {
      fail(`Unsupported option ${arg}. Allowed options: ${flags.join(", ")}.`);
    }
    let value;
    if (arg.includes("=")) {
      if (!arg.startsWith("--")) fail(`Use ${arg.replace("=", " ")} instead of ${arg}.`);
      value = arg.slice(flag.length + 1);
    } else {
      index += 1;
      value = args[index];
      if (value === undefined) fail(`${arg} needs a value.`);
    }
    if (!options[flag].valid(value)) fail(`${flag} needs ${options[flag].hint}, not ${value}.`);
    result.push(flag, value);
  }
  return result;
}

/** Create the sign-in secret once, readable only by this user. The secret is never printed. */
function localSessionSecret() {
  mkdirSync(localDirectory, { recursive: true, mode: 0o700 });
  chmodSync(localDirectory, 0o700);
  try {
    const contents = `CARBY_LOCAL_SESSION_SECRET=${randomBytes(32).toString("base64url")}\n`;
    writeFileSync(sessionFile, contents, { flag: "wx", mode: 0o600 });
    console.log("Created a local sign-in secret in .carby-local/session.env.");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  chmodSync(sessionFile, 0o600);
  const match = secretLine.exec(readFileSync(sessionFile, "utf8"));
  if (!match) {
    fail("No valid secret in .carby-local/session.env. Delete the file to create a new one.");
  }
  return match[1];
}

// Import the CLI in this process so the server keeps the launcher's PID and signals.
async function runInProcess(entry, args) {
  const cli = new URL(entry, import.meta.url);
  process.argv = [process.execPath, fileURLToPath(cli), ...args];
  await import(cli.href);
}

function requireBuild() {
  const entries = ["dist/server/index.js", "dist/server/entry.js"];
  if (!entries.some((entry) => existsSync(path.join(projectRoot, entry)))) {
    fail("No build found. Run make build first.");
  }
}

async function startLocalPreview(previewArgs) {
  await runInProcess("../node_modules/vinext/dist/cli.js", [
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "8787",
    ...previewArgs,
  ]);
}

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build", "start"].includes(command)) {
  fail("usage: node scripts/local-runtime.mjs <dev|build|start> [options]");
}

process.chdir(projectRoot);
delete process.env.CARBY_AUTH_MODE;
delete process.env.CARBY_LOCAL_SESSION_SECRET;
delete process.env.CARBY_LOCAL_LAUNCHER;

if (command === "build") {
  await runInProcess("../node_modules/vinext/dist/cli.js", ["build", ...args]);
} else if (command === "dev") {
  const devArgs = allowedArgs(args, { "--port": port, "-p": port });
  process.env.CARBY_AUTH_MODE = "local";
  process.env.CARBY_LOCAL_LAUNCHER = "1";
  process.env.CARBY_LOCAL_SESSION_SECRET = localSessionSecret();
  const { autoMigrate } = ensureLocalDatabase("development");
  if (autoMigrate) runMigrations();
  await runInProcess("../node_modules/vinext/dist/cli.js", ["dev", "--port", "5173", ...devArgs]);
} else {
  // Check options and the build before starting Docker, so a mistake fails fast.
  const previewArgs = allowedArgs(args, { "--port": port, "-p": port });
  requireBuild();
  process.env.CARBY_AUTH_MODE = "local";
  process.env.CARBY_LOCAL_LAUNCHER = "1";
  process.env.CARBY_LOCAL_SESSION_SECRET = localSessionSecret();
  const { autoMigrate } = ensureLocalDatabase("production");
  if (autoMigrate) runMigrations();
  await startLocalPreview(previewArgs);
}
