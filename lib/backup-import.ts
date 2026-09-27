import { z } from "zod";
import {
  careContactsSchema,
  cgmSchema,
  emergencyInstructionsSchema,
  dexcomEventSchema,
  entrySchema,
  planSchema,
  savedFoodSchema,
  glucoseRangesSchema,
  patternRuleSchema,
  correctionCallCheckSchema,
  sickDayChecksSchema,
  lowTreatmentSchema,
  overnightCheckSchema,
  correctionQuietHoursSchema,
  meterSchema,
  otherContactsSchema,
  temperatureUnits,
  timeZoneSchema,
} from "./care";
import { illnessSchema, validateIllnessDates } from "./illness";
import { profileSchema } from "./profile";
import { appointmentSchema } from "./appointments";

export const BACKUP_FORMAT = "carby-d1-ndjson";
/**
 * Version 1 exports written before the project was renamed use the earlier project name in place
 * of `carby`. Only the name differs; the header, tables, rows and footer are still checked in full.
 */
const LEGACY_FORMAT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-d1-ndjson$/;
/** Those exports recorded the insulin product; this version records its category. */
const LEGACY_INSULIN: Record<string, "Rapid-acting" | "Long-acting"> = {
  Humalog: "Rapid-acting",
  Semglee: "Long-acting",
};
export const BACKUP_VERSION = 1;
export const BACKUP_TABLES = [
  "plans",
  "saved_foods",
  "entries",
  "cgm_readings",
  "dexcom_events",
  "dexcom_connections",
  "care_audit",
  "illness_windows",
  "profiles",
  "appointments",
] as const;
/** Exports written before appointment tracking had no appointments table. */
export const PRE_APPOINTMENTS_BACKUP_TABLES = [
  "plans",
  "saved_foods",
  "entries",
  "cgm_readings",
  "dexcom_events",
  "dexcom_connections",
  "care_audit",
  "illness_windows",
  "profiles",
] as const;
/** Exports written before profile personalization had no profiles table. */
export const PRE_PROFILE_BACKUP_TABLES = [
  "plans",
  "saved_foods",
  "entries",
  "cgm_readings",
  "dexcom_events",
  "dexcom_connections",
  "care_audit",
  "illness_windows",
] as const;
/** Exports written before illness tracking had no illness_windows table. */
export const LEGACY_BACKUP_TABLES = [
  "plans",
  "saved_foods",
  "entries",
  "cgm_readings",
  "dexcom_events",
  "dexcom_connections",
  "care_audit",
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];
export type ImportTable = Exclude<BackupTable, "dexcom_connections">;
/** Tables restored into the account, in insertion order. */
export const IMPORT_TABLES: readonly ImportTable[] = [
  "plans",
  "saved_foods",
  "entries",
  "cgm_readings",
  "dexcom_events",
  "care_audit",
  "illness_windows",
  "profiles",
  "appointments",
];

/** Activation copies every staged row in one D1 transaction, so the total stays well inside D1's 30 second limit. */
export const IMPORT_LIMITS = {
  maxLineLength: 262144,
  maxRows: 150000,
  maxBytes: 134217728,
  chunkRows: 250,
  chunkBytes: 524288,
  requestBytes: 1048576,
} as const;

export const importColumns: Record<ImportTable, readonly string[]> = {
  plans: ["id", "owner", "data", "created"],
  saved_foods: ["id", "owner", "name", "data", "updated"],
  entries: ["id", "owner", "at", "data", "plan", "updated"],
  cgm_readings: ["id", "owner", "at", "value", "source"],
  dexcom_events: ["id", "owner", "at", "data"],
  care_audit: [
    "id",
    "owner",
    "entry_id",
    "actor_id",
    "actor_name",
    "action",
    "before",
    "after",
    "at",
  ],
  illness_windows: ["id", "owner", "start_date", "data", "updated"],
  profiles: ["id", "owner", "data", "updated"],
  appointments: ["id", "owner", "at", "data", "updated"],
};
const nullableColumns: Partial<Record<ImportTable, readonly string[]>> = {
  care_audit: ["before", "after"],
};
// Migrations 0004 and 0005 added the optional columns; older exports omit them.
const connectionColumns = ["owner", "credentials", "last_sync", "updated"];
const optionalConnectionColumns = ["latest_reading_at", "last_attempt_at", "last_error"];
const nullableConnectionColumns = [
  "last_sync",
  "latest_reading_at",
  "last_attempt_at",
  "last_error",
];

export const tableLabels: Record<BackupTable, { one: string; many: string }> = {
  plans: { one: "care plan version", many: "care plan versions" },
  saved_foods: { one: "saved food", many: "saved foods" },
  entries: { one: "log entry", many: "log entries" },
  cgm_readings: { one: "glucose reading", many: "glucose readings" },
  dexcom_events: { one: "Dexcom event", many: "Dexcom events" },
  dexcom_connections: { one: "Dexcom Share connection", many: "Dexcom Share connections" },
  care_audit: { one: "change history record", many: "change history records" },
  illness_windows: { one: "illness period", many: "illness periods" },
  profiles: { one: "profile", many: "profiles" },
  appointments: { one: "appointment", many: "appointments" },
};

/** Messages are shown to the user and must never quote backup content. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export type BackupHeader = { tables: BackupTable[]; exportedAt: string };
export type BackupRow = {
  table: BackupTable;
  owner: string;
  row: Record<string, string | null>;
  migrated: boolean;
};
export type BackupSummary = {
  tables: BackupTable[];
  exportedAt: string;
  counts: Record<BackupTable, number>;
  totalRows: number;
  importRows: number;
  connectionRows: number;
  /** `timezone` is the backup plan's own zone, when it has a usable one; review dates use it. */
  latestPlan: { created: string; ready: boolean; timezone: string | null } | null;
  firstAt: string | null;
  lastAt: string | null;
};

const instant = z.string().datetime();
const CLOCK_SKEW = 300000;
/**
 * Older plan versions may lack settings added later, so those fields are optional. Plan history
 * always shows the target, correction factor and carb ratio, so every version must have them.
 * Contacts get today's checks because Carby turns them into phone links, and emergency
 * instructions get today's shape and length checks because Carby shows them in the emergency steps.
 */
const historicalPlanSchema = z
  .object({
    target: z.number().finite(),
    factor: z.number().finite(),
    ratio: z.number().finite(),
    mealRatios: z
      .object({
        breakfast: z.number().finite(),
        lunch: z.number().finite(),
        dinner: z.number().finite(),
        snack: z.number().finite().nullable(),
      })
      .optional(),
    increment: z.number().finite().optional(),
    rounding: z.string().max(20).optional(),
    basal: z.number().finite().optional(),
    basalTime: z.string().max(20).optional(),
    timezone: z.string().max(100).optional(),
    correctionHours: z.number().finite().optional(),
    note: z.string().max(1000).optional(),
    contacts: careContactsSchema.optional(),
    emergencyInstructions: emergencyInstructionsSchema.optional(),
    glucoseRanges: glucoseRangesSchema.optional(),
    lowThreshold: z.number().finite().optional(),
    ketoneCheckAbove: z.number().finite().optional(),
    patternRule: patternRuleSchema.optional(),
    correctionCallCheck: correctionCallCheckSchema.optional(),
    sickDayChecks: sickDayChecksSchema.optional(),
    lowTreatment: lowTreatmentSchema.optional(),
    overnightCheck: overnightCheckSchema.optional(),
    correctionQuietHours: correctionQuietHoursSchema.optional(),
    snackInsulinFromCarbs: z.number().finite().optional(),
    rescueMedication: z.string().max(60).optional(),
    meter: meterSchema.optional(),
    otherContacts: otherContactsSchema.optional(),
    temperatureUnit: z.enum(temperatureUnits).optional(),
  })
  .passthrough();
const rowId = /^[\x21-\x7e]{1,200}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function hasKey(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => hasKey(value, key));
}
function sameList(left: readonly unknown[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function jsonValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
function isInstant(value: unknown): value is string {
  return typeof value === "string" && instant.safeParse(value).success;
}
function isPast(value: unknown): value is string {
  return isInstant(value) && Date.parse(value) <= Date.now() + CLOCK_SKEW;
}
function historicalPlan(text: string) {
  return historicalPlanSchema.safeParse(jsonValue(text)).success;
}
function knownFormat(value: unknown) {
  return (
    value === BACKUP_FORMAT ||
    (typeof value === "string" && value.length <= 64 && LEGACY_FORMAT.test(value))
  );
}
function validIllnessDates(illness: Parameters<typeof validateIllnessDates>[0]) {
  try {
    validateIllnessDates(illness, Date.now());
    return true;
  } catch {
    return false;
  }
}

/** UTF-8 size of a string, used to keep uploads inside the request limit. */
export function utf8Length(text: string) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function parseHeader(value: unknown): BackupHeader {
  if (!isRecord(value) || value.kind !== "header")
    throw new BackupError(
      "This file is not a Carby backup. On your other deployment, open Care tools and choose Download all data.",
    );
  if (!knownFormat(value.format))
    throw new BackupError(
      "This file is not a Carby backup. On your other deployment, open Care tools and choose Download all data.",
    );
  if (value.version !== BACKUP_VERSION)
    throw new BackupError(
      "This backup uses a format version that this version of Carby cannot import. Update both deployments to the same Carby version, then download a new backup.",
    );
  if (
    !exactKeys(value, ["kind", "format", "version", "exportedAt", "tables"]) ||
    !Array.isArray(value.tables) ||
    !isInstant(value.exportedAt)
  )
    throw new BackupError(
      "The backup header is damaged. Download a new backup from your other deployment.",
    );
  const tables = sameList(value.tables, BACKUP_TABLES)
    ? [...BACKUP_TABLES]
    : sameList(value.tables, PRE_APPOINTMENTS_BACKUP_TABLES)
      ? [...PRE_APPOINTMENTS_BACKUP_TABLES]
      : sameList(value.tables, PRE_PROFILE_BACKUP_TABLES)
        ? [...PRE_PROFILE_BACKUP_TABLES]
        : sameList(value.tables, LEGACY_BACKUP_TABLES)
          ? [...LEGACY_BACKUP_TABLES]
          : null;
  if (!tables)
    throw new BackupError(
      "This backup lists data that this version of Carby does not recognize. Update both deployments to the same Carby version, then download a new backup.",
    );
  return { tables, exportedAt: value.exportedAt };
}

export function parseFooter(
  value: unknown,
  tables: readonly BackupTable[],
): Record<BackupTable, number> {
  if (
    !isRecord(value) ||
    value.kind !== "footer" ||
    !exactKeys(value, ["kind", "counts", "completedAt"]) ||
    !isInstant(value.completedAt) ||
    !isRecord(value.counts) ||
    !exactKeys(value.counts, tables)
  )
    throw new BackupError(
      "The end of the backup is damaged. Download a new backup from your other deployment.",
    );
  const counts = Object.fromEntries(BACKUP_TABLES.map((table) => [table, 0])) as Record<
    BackupTable,
    number
  >;
  for (const table of tables) {
    const count = value.counts[table];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
      throw new BackupError(
        "The end of the backup is damaged. Download a new backup from your other deployment.",
      );
    counts[table] = count;
  }
  return counts;
}

function invalid(line: number, table: BackupTable): never {
  throw new BackupError(
    `Line ${line}: this ${tableLabels[table].one} is not in a format this version of Carby can import. The backup may be damaged or from an unsupported version.`,
  );
}

function checkTypes(
  row: Record<string, unknown>,
  nullable: readonly string[],
): row is Record<string, string | null> {
  return Object.entries(row).every(
    ([key, value]) => typeof value === "string" || (value === null && nullable.includes(key)),
  );
}

function validOwner(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 300;
}

/**
 * Check one exported row against the real table shape and the app's own record schemas.
 * `connection: 'stub'` accepts the owner-only form the browser uploads in place of a
 * Dexcom connection, so credentials never leave the device.
 */
export function parseRow(
  value: unknown,
  tables: readonly BackupTable[],
  line: number,
  connection: "full" | "stub" = "full",
): BackupRow {
  if (
    !isRecord(value) ||
    value.kind !== "row" ||
    !exactKeys(value, ["kind", "table", "row"]) ||
    typeof value.table !== "string"
  )
    throw new BackupError(`Line ${line} is not a Carby backup record. The backup may be damaged.`);
  const table = value.table as BackupTable;
  if (!tables.includes(table))
    throw new BackupError(
      `Line ${line} refers to data that the backup header does not list. The backup may be damaged.`,
    );
  const row = value.row;
  if (!isRecord(row)) invalid(line, table);
  if (table === "dexcom_connections") {
    if (connection === "stub") {
      const owner = row.owner;
      if (!exactKeys(row, ["owner"]) || !validOwner(owner)) invalid(line, table);
      return { table, owner, row: { owner }, migrated: false };
    }
    const keys = Object.keys(row),
      owner = row.owner;
    if (
      !connectionColumns.every((key) => hasKey(row, key)) ||
      !keys.every(
        (key) => connectionColumns.includes(key) || optionalConnectionColumns.includes(key),
      )
    )
      invalid(line, table);
    if (!checkTypes(row, nullableConnectionColumns) || !validOwner(owner)) invalid(line, table);
    return { table, owner, row: { owner }, migrated: false };
  }
  if (!exactKeys(row, importColumns[table]) || !checkTypes(row, nullableColumns[table] ?? []))
    invalid(line, table);
  const owner = row.owner,
    id = row.id;
  if (!validOwner(owner) || typeof id !== "string" || !rowId.test(id)) invalid(line, table);
  const migrated = table === "entries" ? migrateEntry(row) : null;
  if (!validPayload(table, migrated ?? row)) invalid(line, table);
  return { table, owner, row: migrated ?? row, migrated: !!migrated };
}

/**
 * Map an insulin product recorded by an older export to its category, changing nothing else in the
 * entry. Any other insulin value is left for the entry schema to refuse. Change history snapshots
 * are imported exactly as recorded, so they keep the original product name.
 */
function migrateEntry(row: Record<string, string | null>): Record<string, string | null> | null {
  const entry = jsonValue(row.data as string);
  if (
    !isRecord(entry) ||
    typeof entry.insulin !== "string" ||
    !hasKey(LEGACY_INSULIN, entry.insulin)
  )
    return null;
  return { ...row, data: JSON.stringify({ ...entry, insulin: LEGACY_INSULIN[entry.insulin] }) };
}

function validPayload(table: ImportTable, row: Record<string, string | null>): boolean {
  const id = row.id as string;
  switch (table) {
    case "plans": {
      // A future timestamp would outrank every plan saved after the import.
      return isPast(row.created) && historicalPlan(row.data as string);
    }
    case "saved_foods": {
      const food = savedFoodSchema.safeParse(jsonValue(row.data as string));
      return (
        food.success && food.data.id === id && food.data.name === row.name && isInstant(row.updated)
      );
    }
    case "entries": {
      const entry = entrySchema.safeParse(jsonValue(row.data as string));
      if (
        !entry.success ||
        entry.data.id !== id ||
        entry.data.at !== row.at ||
        !historicalPlan(row.plan as string) ||
        !isInstant(row.updated)
      )
        return false;
      const links = entry.data.calculation?.foodEntryIds ?? [];
      return new Set(links).size === links.length;
    }
    case "cgm_readings": {
      const value = row.value as string,
        status = value === "High" || value === "Low" ? value : null;
      if (!status && !/^\d{1,4}$/.test(value)) return false;
      return (
        isPast(row.at) &&
        cgmSchema.safeParse({
          at: row.at,
          value: status ? null : Number(value),
          status,
          source: row.source,
        }).success
      );
    }
    case "dexcom_events": {
      const event = dexcomEventSchema.safeParse(jsonValue(row.data as string));
      return event.success && event.data.at === row.at && isPast(row.at);
    }
    case "care_audit": {
      const text = (value: string | null, max: number) =>
        typeof value === "string" && value.length <= max;
      const json = (value: string | null) =>
        value === null || (value !== "" && jsonValue(value) !== undefined);
      return (
        text(row.entry_id, 200) &&
        !!row.entry_id &&
        text(row.actor_id, 300) &&
        text(row.actor_name, 500) &&
        text(row.action, 100) &&
        !!row.action &&
        json(row.before) &&
        json(row.after) &&
        isPast(row.at)
      );
    }
    case "illness_windows": {
      const illness = illnessSchema.safeParse(jsonValue(row.data as string));
      return (
        illness.success &&
        illness.data.id === id &&
        illness.data.startDate === row.start_date &&
        isInstant(row.updated) &&
        validIllnessDates(illness.data)
      );
    }
    case "profiles": {
      const profile = profileSchema.safeParse(jsonValue(row.data as string));
      return profile.success && profile.data.id === id && isInstant(row.updated);
    }
    case "appointments": {
      // Future appointments are allowed, so no isPast check here.
      const appointment = appointmentSchema.safeParse(jsonValue(row.data as string));
      return (
        appointment.success &&
        appointment.data.id === id &&
        appointment.data.at === row.at &&
        isInstant(row.updated)
      );
    }
  }
}

/** Plans load in created order; only a plan that passes today's schema opens the dashboard. */
export function planIsReady(data: string): boolean {
  return planSchema.safeParse(jsonValue(data)).success;
}
/** The saved plan's zone when it is usable, so review dates read as they were recorded. */
function planTimeZone(data: string): string | null {
  const plan = jsonValue(data);
  if (!isRecord(plan)) return null;
  const zone = timeZoneSchema.safeParse(plan.timezone);
  return zone.success ? zone.data : null;
}

export type ParsedLine =
  | { type: "header"; header: BackupHeader; value: unknown }
  | {
      type: "row";
      line: number;
      table: BackupTable;
      upload: { kind: "row"; table: BackupTable; row: Record<string, string | null> };
      length: number;
    }
  | { type: "footer"; value: unknown }
  | { type: "blank" };

/** Validates a backup one line at a time so large files never need to be held in memory. */
export class BackupParser {
  line = 0;
  private header: BackupHeader | null = null;
  private footer: Record<BackupTable, number> | null = null;
  private counts = Object.fromEntries(BACKUP_TABLES.map((table) => [table, 0])) as Record<
    BackupTable,
    number
  >;
  private owner: string | null = null;
  private latestPlan: { created: string; data: string } | null = null;
  private firstAt: string | null = null;
  private lastAt: string | null = null;
  private total = 0;

  push(text: string): ParsedLine {
    this.line += 1;
    const line = this.line;
    if (this.footer) {
      if (text.trim() === "") return { type: "blank" };
      throw new BackupError(
        `Line ${line} comes after the end of the backup. The file may have been edited or joined with another file.`,
      );
    }
    if (text.trim() === "")
      throw new BackupError(
        line === 1 ? "This file is empty." : `Line ${line} is empty. The backup may be damaged.`,
      );
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new BackupError(
        line === 1
          ? "This file is not a Carby backup. On your other deployment, open Care tools and choose Download all data."
          : `Line ${line} is not readable. The backup may be damaged or incomplete.`,
      );
    }
    if (!this.header) {
      if (line !== 1 || !isRecord(value) || value.kind !== "header")
        throw new BackupError(
          "This file is not a Carby backup. On your other deployment, open Care tools and choose Download all data.",
        );
      this.header = parseHeader(value);
      return { type: "header", header: this.header, value };
    }
    if (isRecord(value) && value.kind === "footer") {
      const counts = parseFooter(value, this.header.tables);
      for (const table of this.header.tables) {
        if (counts[table] !== this.counts[table])
          throw new BackupError(
            `The backup is incomplete: it should have ${counts[table].toLocaleString("en-US")} ${tableLabels[table].many} but has ${this.counts[table].toLocaleString("en-US")}. Download it again from your other deployment.`,
          );
      }
      this.footer = counts;
      return { type: "footer", value };
    }
    const parsed = parseRow(value, this.header.tables, line);
    if (this.owner === null) this.owner = parsed.owner;
    else if (parsed.owner !== this.owner)
      throw new BackupError(
        `Line ${line} belongs to a different account than earlier lines. Carby imports a backup from one account at a time.`,
      );
    this.counts[parsed.table] += 1;
    this.total += 1;
    if (this.total > IMPORT_LIMITS.maxRows)
      throw new BackupError(
        `This backup has more than ${IMPORT_LIMITS.maxRows.toLocaleString("en-US")} records, which is more than Carby can import at once.`,
      );
    if (parsed.table === "dexcom_connections" && this.counts.dexcom_connections > 1)
      throw new BackupError(
        `Line ${line} is a second Dexcom Share connection. A backup has at most one.`,
      );
    if (parsed.table === "profiles" && this.counts.profiles > 1)
      throw new BackupError(`Line ${line} is a second profile. A backup has at most one.`);
    if (parsed.table === "plans") {
      const created = parsed.row.created as string;
      if (!this.latestPlan || created > this.latestPlan.created)
        this.latestPlan = { created, data: parsed.row.data as string };
    }
    const at =
      parsed.table === "entries" ||
      parsed.table === "cgm_readings" ||
      parsed.table === "dexcom_events"
        ? (parsed.row.at as string)
        : null;
    if (at) {
      if (!this.firstAt || at < this.firstAt) this.firstAt = at;
      if (!this.lastAt || at > this.lastAt) this.lastAt = at;
    }
    const upload = {
      kind: "row" as const,
      table: parsed.table,
      row: parsed.table === "dexcom_connections" ? { owner: parsed.owner } : parsed.row,
    };
    // A migrated row is sent as rewritten, which can be longer than the line in the file.
    return {
      type: "row",
      line,
      table: parsed.table,
      upload,
      length: parsed.migrated
        ? Math.max(utf8Length(text), utf8Length(JSON.stringify(upload)))
        : utf8Length(text),
    };
  }

  summary(): BackupSummary {
    if (!this.header) throw new BackupError("This file is empty.");
    if (!this.footer)
      throw new BackupError(
        "The backup is incomplete. It has no end marker, so the download stopped early or your other deployment could not finish writing the file. Download it again from your other deployment. Carby does not import a partial backup, because records would be missing.",
      );
    const importRows = this.total - this.counts.dexcom_connections;
    if (importRows === 0) throw new BackupError("This backup has no records to import.");
    return {
      tables: this.header.tables,
      exportedAt: this.header.exportedAt,
      counts: { ...this.counts },
      totalRows: this.total,
      importRows,
      connectionRows: this.counts.dexcom_connections,
      latestPlan: this.latestPlan
        ? {
            created: this.latestPlan.created,
            ready: planIsReady(this.latestPlan.data),
            timezone: planTimeZone(this.latestPlan.data),
          }
        : null,
      firstAt: this.firstAt,
      lastAt: this.lastAt,
    };
  }
}

/** Split a byte stream into lines without buffering the whole file. */
export async function* backupLines(
  stream: ReadableStream<Uint8Array>,
  onBytes?: (bytes: number) => void,
): AsyncGenerator<string> {
  let read = 0;
  // A fatal decoder errors the stream on invalid UTF-8, including a sequence cut off at the end.
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const decode = new TransformStream<Uint8Array, string>({
    transform(chunk, controller) {
      read += chunk.byteLength;
      onBytes?.(read);
      const text = decoder.decode(chunk, { stream: true });
      if (text) controller.enqueue(text);
    },
    flush(controller) {
      const text = decoder.decode();
      if (text) controller.enqueue(text);
    },
  });
  const reader = stream.pipeThrough(decode).getReader();
  let buffer = "";
  try {
    for (;;) {
      let result: ReadableStreamReadResult<string>;
      try {
        result = await reader.read();
      } catch {
        throw new BackupError("This file is not a text file. Choose the .ndjson backup file.");
      }
      if (result.done) break;
      buffer += result.value;
      let start = 0,
        index: number;
      while ((index = buffer.indexOf("\n", start)) >= 0) {
        const end = index > start && buffer.charCodeAt(index - 1) === 13 ? index - 1 : index;
        if (end - start > IMPORT_LIMITS.maxLineLength)
          throw new BackupError("A line in this file is too long for a Carby backup.");
        yield buffer.slice(start, end);
        start = index + 1;
      }
      buffer = buffer.slice(start);
      if (buffer.length > IMPORT_LIMITS.maxLineLength)
        throw new BackupError("A line in this file is too long for a Carby backup.");
    }
    if (buffer.length) yield buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
