import { fromLocal, type CgmReading, type DexcomEvent } from "./care";

/** Parse quoted CSV rows, including commas and newlines inside fields. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("The CSV has an unfinished quoted field.");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

export type ClarityIdentity = {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
};

/** One alert as set in the Dexcom app. Clarity fills only the fields that alert uses. */
export type ClarityAlert = {
  kind: string;
  /** mg/dL threshold. */
  glucose: number | null;
  /** mg/dL per minute. */
  rate: number | null;
  minutes: number | null;
};
/** The device and alert settings in Clarity's undated rows, as Clarity reports them. */
export type ClarityDevice = {
  model: string | null;
  sensor: string | null;
  alerts: ClarityAlert[];
};
/** Readings grouped by the transmitter that sent them. On a G7 the transmitter is the sensor. */
export type ClaritySensor = {
  id: string;
  source: string | null;
  firstAt: string;
  lastAt: string;
  readings: number;
};

/** Read EGV glucose values and dated events from a Dexcom Clarity export in local time. */
export function parseClarity(
  text: string,
  timezone: string,
): {
  readings: CgmReading[];
  events: DexcomEvent[];
  skipped: number;
  identity: ClarityIdentity;
  device: ClarityDevice | null;
  sensors: ClaritySensor[];
} {
  const rows = csvRows(text.replace(/^\uFEFF/, ""));
  const headerIndex = rows.findIndex(
    (row) =>
      row.some((v) => v.trim().toLowerCase().startsWith("timestamp (")) &&
      row.some((v) => v.trim().toLowerCase() === "event type"),
  );
  if (headerIndex < 0) throw new Error("This does not look like a Dexcom Clarity CSV export.");
  const header = rows[headerIndex].map((v) => v.trim().toLowerCase());
  const stamp = header.findIndex((v) => v.startsWith("timestamp (")),
    event = header.indexOf("event type"),
    glucose = header.findIndex((v) => v === "glucose value (mg/dl)");
  if (glucose < 0) throw new Error("The export is missing its glucose value column.");
  const readings: CgmReading[] = [],
    events: DexcomEvent[] = [],
    seen = new Set<string>();
  let skipped = 0;
  const patientInfo = header.indexOf("patient info");
  const identity: ClarityIdentity = { firstName: null, lastName: null, dateOfBirth: null };
  if (patientInfo >= 0) {
    for (const row of rows.slice(headerIndex + 1)) {
      const kind = (row[event]?.trim() ?? "").toLowerCase(),
        value = row[patientInfo]?.trim().slice(0, 100) ?? "";
      const field =
        kind === "firstname"
          ? "firstName"
          : kind === "lastname"
            ? "lastName"
            : kind === "dateofbirth"
              ? "dateOfBirth"
              : null;
      if (!field || !value) continue;
      if (identity[field] && identity[field] !== value)
        throw new Error(
          "This CSV contains conflicting patient identity information. Nothing was imported.",
        );
      identity[field] = value;
    }
  }
  const column = (...names: string[]) => header.findIndex((v) => names.includes(v));
  const meter = header.findIndex((v) => /calibration|meter bg|blood glucose/.test(v));
  const subtype = column("event subtype", "event sub-type"),
    eventValue = column("event value", "value"),
    notes = column("event description", "description", "notes", "event notes");
  const insulin = column("insulin value (u)", "insulin value (units)"),
    carbs = column("carb value (grams)", "carbohydrate value (grams)"),
    duration = column("duration (hh:mm:ss)");
  const deviceInfo = column("device info"),
    sourceDevice = column("source device id"),
    rate = column("glucose rate of change (mg/dl/min)"),
    transmitter = column("transmitter id");
  const cell = (row: string[], index: number, max: number) =>
    index >= 0 ? row[index]?.trim().slice(0, max) || null : null;
  const device: ClarityDevice = { model: null, sensor: null, alerts: [] };
  let hasDevice = false;
  /** Undated Device, Sensor and Alert rows describe the current settings, not events. */
  const readSetting = (kind: string, row: string[]) => {
    const lower = kind.toLowerCase();
    if (lower === "device" || lower === "sensor") {
      device[lower === "device" ? "model" : "sensor"] = cell(row, deviceInfo, 60);
      hasDevice = true;
    } else if (lower === "alert") {
      const name = cell(row, subtype, 60);
      if (!name) return;
      const threshold = Number(cell(row, glucose, 10) ?? NaN),
        change = Number(cell(row, rate, 10) ?? NaN),
        wait = /^(\d{1,2}):(\d\d):(\d\d)$/.exec(cell(row, duration, 10) ?? "");
      device.alerts.push({
        kind: name,
        glucose:
          Number.isInteger(threshold) && threshold >= 20 && threshold <= 1000 ? threshold : null,
        rate: Number.isFinite(change) && change > 0 && change <= 20 ? change : null,
        minutes: wait ? Number(wait[1]) * 60 + Number(wait[2]) : null,
      });
      hasDevice = true;
    }
  };
  const sensors = new Map<string, ClaritySensor>();
  const readTime = (raw: string) => {
    if (/(?:Z|[+-]\d\d:\d\d)$/i.test(raw)) {
      const parsed = new Date(raw);
      if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid timestamp");
      return parsed.toISOString();
    }
    const local = raw.replace(" ", "T"),
      match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?$/.exec(local);
    if (!match) throw new Error("Invalid timestamp");
    const second = Number(match[2] ?? "0"),
      millisecond = Number((match[3] ?? "").padEnd(3, "0"));
    if (second > 59) throw new Error("Invalid timestamp");
    return new Date(
      Date.parse(fromLocal(match[1], timezone)) + second * 1000 + millisecond,
    ).toISOString();
  };
  for (const row of rows.slice(headerIndex + 1)) {
    const kind = row[event]?.trim() ?? "";
    if (!kind || kind.toUpperCase() === "EGV") continue;
    const raw = row[stamp]?.trim();
    if (!raw) {
      readSetting(kind, row);
      continue;
    }
    let at: string;
    try {
      at = readTime(raw);
    } catch {
      skipped++;
      continue;
    }
    const extra = [subtype, eventValue, notes]
      .filter((i) => i >= 0)
      .map((i) => row[i]?.trim())
      .filter((v): v is string => !!v);
    const calibration = /calib/i.test(kind + " " + extra.join(" "));
    const valueText =
      (meter >= 0 ? row[meter]?.trim() : "") ||
      (glucose >= 0 ? row[glucose]?.trim() : "") ||
      extra.find((v) => /^\d{2,3}(?:\s*mg\/dL)?$/i.test(v)) ||
      "";
    const match = /^(\d{2,3})(?:\s*mg\/dL)?$/i.exec(valueText);
    const value =
      calibration && match && Number(match[1]) >= 20 && Number(match[1]) <= 1000
        ? Number(match[1])
        : null;
    const details = [
      ...extra.filter((v) => v !== String(value)),
      ...(insulin >= 0 && row[insulin]?.trim() ? [`${row[insulin].trim()} units insulin`] : []),
      ...(carbs >= 0 && row[carbs]?.trim() ? [`${row[carbs].trim()} g carbohydrate`] : []),
      ...(duration >= 0 && row[duration]?.trim() ? [`duration ${row[duration].trim()}`] : []),
    ]
      .join(" · ")
      .slice(0, 500);
    const type = calibration ? "Calibration" : kind.slice(0, 100);
    const key = [at, type, details, value].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ at, type, details, value, source: "Dexcom Clarity" });
  }
  for (const row of rows.slice(headerIndex + 1)) {
    if (row[event]?.trim().toUpperCase() !== "EGV") continue;
    const raw = row[stamp]?.trim(),
      glucoseText = row[glucose]?.trim() ?? "",
      value = Number(glucoseText),
      status =
        glucoseText.toLowerCase() === "high"
          ? "High"
          : glucoseText.toLowerCase() === "low"
            ? "Low"
            : null;
    if (
      !raw ||
      (!status && (!glucoseText || !Number.isInteger(value) || value < 40 || value > 400))
    ) {
      skipped++;
      continue;
    }
    let at: string;
    try {
      at = readTime(raw);
    } catch {
      skipped++;
      continue;
    }
    if (seen.has(at)) continue;
    seen.add(at);
    readings.push({ at, value: status ? null : value, status, source: "Dexcom Clarity" });
    const id = cell(row, transmitter, 40);
    if (!id) continue;
    const sensor = sensors.get(id);
    if (!sensor)
      sensors.set(id, {
        id,
        source: cell(row, sourceDevice, 60),
        firstAt: at,
        lastAt: at,
        readings: 1,
      });
    else {
      if (at < sensor.firstAt) sensor.firstAt = at;
      if (at > sensor.lastAt) sensor.lastAt = at;
      sensor.readings++;
    }
  }
  return {
    readings,
    events,
    skipped,
    identity,
    device: hasDevice ? device : null,
    sensors: [...sensors.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt)),
  };
}
