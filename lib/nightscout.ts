import { cgmSchema, entrySchema, type CgmReading, type Entry } from "./care";

/**
 * The Nightscout collections Carby accepts uploads to. Glucose and log records become Carby
 * records; everything is also kept as sent, so nothing an uploader writes is dropped.
 */
export const nightscoutCollections = ["entries", "treatments", "devicestatus", "profile"] as const;
export type NightscoutCollection = (typeof nightscoutCollections)[number];
export function isCollection(value: string): value is NightscoutCollection {
  return (nightscoutCollections as readonly string[]).includes(value);
}
/** Nightscout 15.0.8 caps a write at 10,000 documents. Carby saves each request in one transaction, so it takes fewer. */
export const MAX_UPLOAD_DOCS = 1000;
/** A document dated further ahead of the server clock than this is refused, as Carby refuses log entries. */
export const FUTURE_SLACK_MS = 60000;
export const MMOL_TO_MGDL = 18.0182;

export type Doc = Record<string, unknown>;
export function isDoc(value: unknown): value is Doc {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Client ids Carby keeps: Mongo ObjectIds, UUIDs and similar. Anything else is refused. */
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;
export function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function millis(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return millis(Number(value));
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** When the document happened: an entry's `date`, or a treatment's `created_at`, with the other fields clients use as fallbacks. */
export function docTime(collection: NightscoutCollection, doc: Doc): number | null {
  const fields =
    collection === "entries"
      ? [doc.date, doc.dateString, doc.sysTime, doc.mills]
      : collection === "profile"
        ? [doc.startDate, doc.created_at, doc.mills, doc.date]
        : [doc.created_at, doc.mills, doc.date, doc.timestamp];
  for (const field of fields) {
    const time = millis(field);
    if (time !== null) return Math.round(time);
  }
  return null;
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * The fields that make two documents the same record when neither carries an id. Nightscout
 * matches entries by type and time and treatments by event type and time.
 */
export function dedupeKey(collection: NightscoutCollection, doc: Doc, time: number): string {
  if (collection === "entries") return `${text(doc.type, 40) || "sgv"}|${time}`;
  if (collection === "treatments") return `${text(doc.eventType, 80) || "<none>"}|${time}`;
  if (collection === "devicestatus") return `${text(doc.device, 200)}|${time}`;
  return String(time);
}

/** Every key sorted, so a re-upload of the same document compares equal whatever its key order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isDoc(value))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Events that are a rapid-acting dose by definition. Loop sends every bolus, meal ones too, as "Correction Bolus", so none of them says what the dose was for. */
const BOLUS_EVENTS = new Set([
  "Meal Bolus",
  "Snack Bolus",
  "Correction Bolus",
  "Combo Bolus",
  "Bolus",
  "SMB",
  // Trio's pen or syringe dose, which it counts as rapid-acting.
  "External Insulin",
]);
/** Juggluco states each dose's type in `notes`. */
const STATED_TYPES = new Map<string, "Rapid-acting" | "Long-acting">([
  ["Rapid-Acting", "Rapid-acting"],
  ["Long-Acting", "Long-acting"],
]);
/** Sources Carby's own Dexcom sync writes; an upload never takes their name. */
const RESERVED_SOURCES = new Set(["Dexcom Share", "Dexcom Clarity"]);

function number(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** A Carby log entry an upload becomes, before it has an id. */
export type EntryPart = { part: string; entry: Omit<Entry, "id" | "revision"> };
export type Projection = { cgm: CgmReading | null; entries: EntryPart[] };

const blank = (at: string, note: string) => ({
  at,
  glucose: null,
  source: null,
  ketones: null,
  carbs: null,
  units: null,
  insulin: null,
  meal: null,
  note,
});

/** A sensor reading in mg/dL: a number from 40 to 400, or Low/High beyond them. Codes below 13 are Dexcom errors, not readings. */
function sensorReading(sgv: number, at: string, source: string): CgmReading | null {
  const value = Math.round(sgv);
  if (value < 13) return null;
  const reading =
    value < 40
      ? { at, value: null, status: "Low" as const, source }
      : value > 400
        ? { at, value: null, status: "High" as const, source }
        : { at, value, status: null, source };
  return cgmSchema.safeParse(reading).success ? reading : null;
}

/**
 * The insulin type a treatment states, or null when it states none. AAPS flags basal insulin,
 * Juggluco names the type in `notes`, and a bolus event is rapid-acting. Carby never guesses:
 * xDrip+'s unlabelled doses, for one, say nothing about their type.
 */
function statedInsulin(doc: Doc, eventType: string) {
  if (doc.isBasalInsulin === true) return "Long-acting" as const;
  const stated = STATED_TYPES.get(text(doc.notes, 20));
  if (stated) return stated;
  return BOLUS_EVENTS.has(eventType) ? ("Rapid-acting" as const) : null;
}

/**
 * What an uploaded document becomes in Carby. Entries of type `sgv` become CGM readings and `mbg`
 * a finger-stick. A treatment's carbs become a food entry, a finger or manual glucose a glucose
 * entry, and insulin a dose only when the treatment states its type (see `statedInsulin`).
 * Priming is not a dose. Anything else (notes, temp basals, overrides, profiles, device status)
 * is kept only as sent.
 */
export function project(
  collection: NightscoutCollection,
  doc: Doc,
  time: number,
  fallbackSource: string,
): Projection {
  const at = new Date(time).toISOString();
  const none: Projection = { cgm: null, entries: [] };
  if (collection === "entries") {
    const type = text(doc.type, 40) || "sgv";
    if (type === "sgv") {
      const sgv = number(doc.sgv);
      let source = text(doc.device, 80) || fallbackSource.slice(0, 80);
      if (RESERVED_SOURCES.has(source)) source = `${source} upload`.slice(0, 80);
      return { cgm: sgv === null ? null : sensorReading(sgv, at, source), entries: [] };
    }
    const mbg = number(doc.mbg);
    if (type !== "mbg" || mbg === null) return none;
    return keep([
      {
        part: "glucose",
        entry: {
          ...blank(at, ""),
          kind: "glucose",
          glucose: Math.round(mbg),
          source: "Finger-stick",
          ketones: "Not checked",
        },
      },
    ]);
  }
  if (collection !== "treatments") return none;

  const eventType = text(doc.eventType, 80);
  const insulinType = statedInsulin(doc, eventType);
  // Juggluco's type marker isn't a note of the person's.
  const ownNotes = STATED_TYPES.has(text(doc.notes, 20)) ? "" : text(doc.notes, 1000);
  const notes = [text(doc.foodType, 200), ownNotes].filter(Boolean).join(" · ");
  const parts: EntryPart[] = [];
  const carbs = number(doc.carbs);
  if (carbs !== null && carbs > 0)
    parts.push({
      part: "food",
      entry: {
        ...blank(at, ""),
        kind: "food",
        carbs: Math.round(carbs * 10) / 10,
        meal: eventType === "Snack Bolus" ? "Snack" : "Meal",
      },
    });
  const insulin = number(doc.insulin);
  if (insulin !== null && insulin > 0 && insulinType && text(doc.type, 20) !== "PRIMING")
    parts.push({
      part: "insulin",
      entry: {
        ...blank(at, ""),
        kind: "insulin",
        units: Math.round(insulin * 100) / 100,
        insulin: insulinType,
        purpose: "Other / unknown",
      },
    });
  const glucose = number(doc.glucose);
  const glucoseType = text(doc.glucoseType, 20);
  if (
    glucose !== null &&
    glucose > 0 &&
    (glucoseType === "Finger" ||
      glucoseType === "Manual" ||
      (!glucoseType && eventType === "BG Check"))
  ) {
    const mmol = /mmol/i.test(text(doc.units, 20));
    parts.push({
      part: "glucose",
      entry: {
        ...blank(at, ""),
        kind: "glucose",
        glucose: Math.round(mmol ? glucose * MMOL_TO_MGDL : glucose),
        source: "Finger-stick",
        ketones: "Not checked",
      },
    });
  }
  // The uploader's notes go on the first record, so they show once.
  if (parts[0] && notes) parts[0].entry.note = notes;
  return keep(parts);
}

/** Only parts that are valid Carby entries; the rest stay in the kept document. */
function keep(parts: EntryPart[]): Projection {
  const id = "00000000-0000-4000-8000-000000000000";
  return {
    cgm: null,
    entries: parts.filter((p) => entrySchema.safeParse({ ...p.entry, id }).success),
  };
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function sha256(value: string) {
  return hex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  );
}
/** A stable 24-character id, shaped like the Mongo ObjectIds clients expect, for a document sent without one. */
export async function stableObjectId(key: string) {
  return (await sha256(key)).slice(0, 24);
}
/** A stable UUID for one Carby entry an uploaded document became. */
export async function entryId(key: string) {
  const h = await sha256(key);
  const variant = ((parseInt(h[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Fields clients match a document by: xDrip+'s `uuid`, Trio's `id`, Loop's `syncIdentifier`. */
export const MATCH_FIELDS = ["uuid", "id", "syncIdentifier"] as const;
type MatchField = (typeof MATCH_FIELDS)[number];
const TIME_FIELDS = ["date", "created_at", "dateString", "mills", "sysTime", "startDate"];
/** One condition: a matching field's value, an `_id` or `identifier`, or an exact time. */
export type Condition =
  | { field: MatchField; value: string }
  | { field: "_id"; value: string }
  | { field: "at"; value: string };

/** Which uploaded documents a GET or DELETE reaches. */
export type NightscoutQuery = {
  count: number;
  from: { at: string; inclusive: boolean } | null;
  to: { at: string; inclusive: boolean } | null;
  type: string | null;
  /** Every one must hold. `_id` also matches an `identifier`. */
  all: Condition[];
  /** At least one must hold, from `find[$or][n]...`. */
  any: Condition[];
};
const DEFAULT_COUNT: Record<NightscoutCollection, number> = {
  entries: 10,
  treatments: 100,
  devicestatus: 10,
  profile: 10,
};
export const MAX_QUERY_COUNT = 1000;

function condition(field: string, value: string): Condition | null {
  if ((field === "_id" || field === "identifier") && validId(value)) return { field: "_id", value };
  if ((MATCH_FIELDS as readonly string[]).includes(field) && value.length <= 100)
    return { field: field as MatchField, value };
  if (!TIME_FIELDS.includes(field)) return null;
  const time = millis(value);
  return time === null ? null : { field: "at", value: new Date(time).toISOString() };
}

/**
 * The `count` and `find[...]` parameters Nightscout clients send: ranges over time, a type or
 * event type, and exact matches on ids, including Trio's `find[$or][n][field][$eq]`.
 */
export function parseQuery(
  collection: NightscoutCollection,
  params: URLSearchParams,
  path: { type: string | null; id: string | null },
): NightscoutQuery {
  const requested = Number(params.get("count"));
  const query: NightscoutQuery = {
    count:
      Number.isInteger(requested) && requested > 0
        ? Math.min(requested, MAX_QUERY_COUNT)
        : DEFAULT_COUNT[collection],
    from: null,
    to: null,
    type: path.type,
    all: path.id ? [{ field: "_id", value: path.id }] : [],
    any: [],
  };
  const typeField = collection === "treatments" ? "eventType" : "type";
  for (const [key, value] of params) {
    const or = /^find\[\$or\]\[\d+\]\[([A-Za-z_]+)\](?:\[\$eq\])?$/.exec(key);
    if (or) {
      const found = condition(or[1] ?? "", value);
      if (found) query.any.push(found);
      continue;
    }
    const match = /^find\[([A-Za-z_]+)\](?:\[\$(gte|gt|lte|lt|eq)\])?$/.exec(key);
    if (!match) continue;
    const [, field = "", op = "eq"] = match;
    if (field === typeField && op === "eq") {
      query.type = value;
      continue;
    }
    if (op === "eq") {
      const found = condition(field, value);
      if (found?.field === "at") query.from = query.to = { at: found.value, inclusive: true };
      else if (found) query.all.push(found);
      continue;
    }
    if (!TIME_FIELDS.includes(field)) continue;
    const time = millis(value);
    if (time === null) continue;
    const at = new Date(time).toISOString();
    if (op === "gte" || op === "gt") query.from = { at, inclusive: op === "gte" };
    else query.to = { at, inclusive: op === "lte" };
  }
  return query;
}

/** A delete must name what it removes: an id, a matching field, or an exact time. */
export function namesDocuments(query: NightscoutQuery) {
  return (
    query.all.length > 0 ||
    query.any.length > 0 ||
    (query.from !== null && query.from.at === query.to?.at)
  );
}

/** A simple per-key request limit over fixed windows, kept in memory. */
export function rateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string, now: number) => {
    const current = windows.get(key);
    if (!current || now - current.start >= windowMs) {
      if (windows.size > 10000) windows.clear();
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}

/** The Nightscout version Carby's API matches, as status.json reports it. */
export const NIGHTSCOUT_VERSION = "15.0.8";
const ENTRY_TYPES = new Set(["sgv", "mbg", "cal"]);

/** What an /api/v1 path asks for. Nightscout lets any path end in `.json`. */
export type NightscoutRoute =
  | { kind: "status" }
  | { kind: "verifyauth" }
  | { kind: "test" }
  | {
      kind: "collection";
      collection: NightscoutCollection;
      type: string | null;
      id: string | null;
    };
export function nightscoutRoute(pathname: string): NightscoutRoute | null {
  let parts: string[];
  try {
    parts = pathname
      .replace(/^\/api\/v1\/?/, "")
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part).replace(/\.json$/, ""));
  } catch {
    return null;
  }
  const [name = "", rest] = parts;
  if (parts.length === 1 && name === "status") return { kind: "status" };
  if (parts.length === 1 && name === "verifyauth") return { kind: "verifyauth" };
  if (parts.length === 2 && name === "experiments" && rest === "test") return { kind: "test" };
  if (!isCollection(name) || parts.length > 2) return null;
  if (rest === undefined) return { kind: "collection", collection: name, type: null, id: null };
  // /entries/sgv filters by type; anything else names one document.
  if (name === "entries" && ENTRY_TYPES.has(rest))
    return { kind: "collection", collection: name, type: rest, id: null };
  return validId(rest) ? { kind: "collection", collection: name, type: null, id: rest } : null;
}
