import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// Converts a legacy Cloudflare D1 / Miniflare SQLite file (from `.wrangler/state/`) into a
// `carby-d1-ndjson` backup that Care tools > Import a backup accepts. It opens the source
// read-only, reads only the given owner's rows, and never overwrites an existing output file.
// Bun only: it reads SQLite through `bun:sqlite` and imports the importer's own TypeScript
// constants, so the tables and columns always match what the importer validates.

const USAGE = `Usage: bun scripts/export-legacy-local.mjs --input <legacy.sqlite> --output <backup.ndjson> [--owner <id>]

  --input   Legacy D1 SQLite database file, e.g. one under .wrangler/state/v3/d1/. Opened read-only.
  --output  New backup file to write. An existing file is never overwritten.
  --owner   Owner id whose records to export. Defaults to the local sign-in owner.

Then sign in to Carby and use Care tools > Import a backup with the output file.`;

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}
const usage = (message) => fail(`${message}\n\n${USAGE}`, 64);

if (!process.versions.bun) fail("Run this script with Bun: bun scripts/export-legacy-local.mjs");

const { Database } = await import("bun:sqlite");
const {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BACKUP_TABLES,
  PRE_APPOINTMENTS_BACKUP_TABLES,
  PRE_PROFILE_BACKUP_TABLES,
  LEGACY_BACKUP_TABLES,
  IMPORT_LIMITS,
  BackupError,
  BackupParser,
  backupLines,
  importColumns,
} = await import("../lib/backup-import.ts");
const { LOCAL_USER } = await import("../lib/local-session.ts");

// Mirrors the private connection column lists in lib/backup-import.ts; keep them in sync.
const CONNECTION_COLUMNS = ["owner", "credentials", "last_sync", "updated"];
const OPTIONAL_CONNECTION_COLUMNS = ["latest_reading_at", "last_attempt_at", "last_error"];

let options;
try {
  ({ values: options } = parseArgs({
    options: {
      input: { type: "string" },
      output: { type: "string" },
      owner: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  }));
} catch (error) {
  usage(error.message);
}
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!options.input) usage("--input is required.");
if (!options.output) usage("--output is required.");
const owner = options.owner ?? LOCAL_USER.userId;
if (!owner || owner.length > 300) usage("--owner needs an id of 1 to 300 characters.");

/** Also true for a dangling symlink, which existsSync reports as absent. */
function exists(file) {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

const input = path.resolve(options.input);
const output = path.resolve(options.output);
if (!existsSync(input) || !statSync(input).isFile()) fail(`No database file at ${input}.`);
if (exists(output))
  fail(`${output} already exists. Remove or rename it first; this script never overwrites a file.`);
if (!existsSync(path.dirname(output))) fail(`The folder ${path.dirname(output)} does not exist.`);

let db;
try {
  db = new Database(input, { readonly: true });
} catch (error) {
  fail(`Could not open ${input} as a SQLite database: ${error.message}`);
}

function columnsOf(table) {
  return db
    .query("SELECT name FROM pragma_table_info(?)")
    .all(table)
    .map((column) => column.name);
}

/** Check every table the backup lists against the importer's expected columns before writing. */
function backupTables() {
  const hasIllness = columnsOf("illness_windows").length > 0;
  const hasProfiles = columnsOf("profiles").length > 0;
  const hasAppointments = columnsOf("appointments").length > 0;
  // This legacy SQLite database predates profile personalization or appointment tracking, so it
  // may lack those tables; the backup format falls back to the newest table list it can populate.
  const tables = hasAppointments
    ? BACKUP_TABLES
    : hasProfiles
      ? PRE_APPOINTMENTS_BACKUP_TABLES
      : hasIllness
        ? PRE_PROFILE_BACKUP_TABLES
        : LEGACY_BACKUP_TABLES;
  for (const table of tables) {
    const columns = columnsOf(table);
    if (!columns.length) fail(`${input} has no ${table} table, so it is not a Carby database.`);
    const expected =
      table === "dexcom_connections"
        ? CONNECTION_COLUMNS.every((column) => columns.includes(column)) &&
          columns.every(
            (column) =>
              CONNECTION_COLUMNS.includes(column) || OPTIONAL_CONNECTION_COLUMNS.includes(column),
          )
        : columns.length === importColumns[table].length &&
          importColumns[table].every((column) => columns.includes(column));
    if (!expected)
      fail(
        `The ${table} table has columns [${columns.join(", ")}], which this version of Carby cannot import.`,
      );
  }
  return tables;
}

const temp = `${output}.tmp-${randomBytes(6).toString("hex")}`;
let fd = null;
let published = false;
const counts = {};
try {
  // One read transaction gives a consistent snapshot even if something else has the file open.
  db.exec("BEGIN");
  const tables = backupTables();
  for (const table of tables) counts[table] = 0;

  fd = openSync(temp, "wx", 0o600);
  fchmodSync(fd, 0o600);
  let buffer = "";
  const write = (value) => {
    buffer += JSON.stringify(value) + "\n";
    if (buffer.length >= 1 << 20) {
      writeFileSync(fd, buffer);
      buffer = "";
    }
  };

  write({
    kind: "header",
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  });
  for (const table of tables) {
    // Table names come from the importer's fixed list, never from input.
    const order = table === "dexcom_connections" ? "" : " ORDER BY id";
    let index = 0;
    for (const row of db.query(`SELECT * FROM ${table} WHERE owner = ?${order}`).iterate(owner)) {
      index += 1;
      for (const [column, value] of Object.entries(row)) {
        if (value !== null && typeof value !== "string")
          throw new Error(
            `${table} row ${index} has a non-text value in ${column}; the importer only accepts text.`,
          );
      }
      write({ kind: "row", table, row });
      counts[table] += 1;
    }
  }
  const importRows = Object.entries(counts).reduce(
    (sum, [table, count]) => (table === "dexcom_connections" ? sum : sum + count),
    0,
  );
  if (importRows === 0) {
    const owners = db
      .query(
        tables
          .filter((table) => table !== "dexcom_connections")
          .map((table) => `SELECT owner FROM ${table}`)
          .join(" UNION ") + " ORDER BY owner",
      )
      .all()
      .map((row) => row.owner);
    throw new Error(
      `No records for owner ${JSON.stringify(owner)}, so there is nothing to import.` +
        (owners.length
          ? ` Owners in this database: ${owners.map((id) => JSON.stringify(id)).join(", ")}. Pass one with --owner.`
          : " The database has no records."),
    );
  }
  write({ kind: "footer", counts, completedAt: new Date().toISOString() });
  writeFileSync(fd, buffer);
  fsyncSync(fd);
  closeSync(fd);
  fd = null;

  // The importer refuses a whole file on its first bad line, so check with the same parser first.
  if (statSync(temp).size > IMPORT_LIMITS.maxBytes)
    throw new Error(
      `The backup is larger than Carby can import at once (${Math.round(IMPORT_LIMITS.maxBytes / 1048576)} MB).`,
    );
  const parser = new BackupParser();
  try {
    for await (const line of backupLines(Bun.file(temp).stream())) parser.push(line);
    parser.summary();
  } catch (error) {
    if (!(error instanceof BackupError)) throw error;
    throw new Error(`Carby would refuse to import these records: ${error.message}`);
  }

  // A hard link fails if the output exists, so publishing never replaces a file.
  try {
    linkSync(temp, output);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(`${output} appeared while exporting; not replacing it.`);
    throw new Error(
      `Could not create ${output} (${error.code}). Choose an output folder on a disk that supports hard links, such as your home folder.`,
    );
  }
  published = true;
  db.exec("COMMIT");
} catch (error) {
  process.exitCode = 1;
  console.error(`Export failed: ${error.message}`);
} finally {
  try {
    if (fd !== null) closeSync(fd);
  } catch {}
  if (exists(temp)) {
    try {
      unlinkSync(temp);
    } catch {
      console.error(`Could not remove the temporary file ${temp}; delete it yourself.`);
    }
  }
  db.close();
}

if (published) {
  console.log(`Wrote ${output} (mode 0600) for owner ${JSON.stringify(owner)}.`);
  for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count}`);
  if (counts.dexcom_connections)
    console.log(
      "The Dexcom Share connection is included still encrypted. Carby does not restore it on import; reconnect Dexcom Share after importing.",
    );
}
