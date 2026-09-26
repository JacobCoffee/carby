import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  customType,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
// Column order matches the rows the export route streams with SELECT *.
export const entries = pgTable(
  "entries",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    at: text("at").notNull(),
    data: text("data").notNull(),
    plan: text("plan").notNull(),
    updated: text("updated").notNull(),
  },
  (t) => [index("idx_entries_owner_at").on(t.owner, t.at)],
);
export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    data: text("data").notNull(),
    created: text("created").notNull(),
  },
  (t) => [index("idx_plans_owner_created").on(t.owner, t.created)],
);
export const savedFoods = pgTable(
  "saved_foods",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    data: text("data").notNull(),
    updated: text("updated").notNull(),
  },
  (t) => [index("idx_saved_foods_owner").on(t.owner)],
);
export const cgmReadings = pgTable(
  "cgm_readings",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    at: text("at").notNull(),
    value: text("value").notNull(),
    source: text("source").notNull(),
  },
  (t) => [index("idx_cgm_owner_at").on(t.owner, t.at)],
);
export const dexcomEvents = pgTable(
  "dexcom_events",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    at: text("at").notNull(),
    data: text("data").notNull(),
  },
  (t) => [index("idx_dexcom_events_owner_at").on(t.owner, t.at)],
);
export const dexcomConnections = pgTable("dexcom_connections", {
  owner: text("owner").primaryKey(),
  credentials: text("credentials").notNull(),
  lastSync: text("last_sync"),
  updated: text("updated").notNull(),
  latestReadingAt: text("latest_reading_at"),
  lastAttemptAt: text("last_attempt_at"),
  lastError: text("last_error"),
});
export const careAudit = pgTable(
  "care_audit",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    entryId: text("entry_id").notNull(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    before: text("before"),
    after: text("after"),
    at: text("at").notNull(),
  },
  (t) => [index("idx_care_audit_owner_at").on(t.owner, t.at)],
);

export const illnessWindows = pgTable(
  "illness_windows",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    startDate: text("start_date").notNull(),
    data: text("data").notNull(),
    updated: text("updated").notNull(),
  },
  (t) => [index("idx_illness_windows_owner_start").on(t.owner, t.startDate)],
);

export const appointments = pgTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    at: text("at").notNull(),
    data: text("data").notNull(),
    updated: text("updated").notNull(),
  },
  (t) => [index("idx_appointments_owner_at").on(t.owner, t.at)],
);

/** One backup import per row. Staged rows stay out of the care tables until activation. */
export const importSessions = pgTable(
  "import_sessions",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    state: text("state").notNull(),
    tables: text("tables").notNull(),
    exportedAt: text("exported_at").notNull(),
    sourceOwner: text("source_owner"),
    nextChunk: integer("next_chunk").notNull().default(0),
    lastChunk: text("last_chunk"),
    connectionRows: integer("connection_rows").notNull().default(0),
    stagedRows: integer("staged_rows").notNull().default(0),
    stagedBytes: integer("staged_bytes").notNull().default(0),
    summary: text("summary"),
    created: text("created").notNull(),
    updated: text("updated").notNull(),
    replaceExisting: integer("replace_existing").notNull().default(0),
    activationClaim: text("activation_claim"),
  },
  (t) => [index("idx_import_sessions_owner_state").on(t.owner, t.state)],
);
export const importRows = pgTable(
  "import_rows",
  {
    session: text("session").notNull(),
    tbl: text("tbl").notNull(),
    rowId: text("row_id").notNull(),
    payload: jsonb("payload").notNull(),
  },
  (t) => [primaryKey({ columns: [t.session, t.tbl, t.rowId] })],
);

export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    data: text("data").notNull(),
    updated: text("updated").notNull(),
  },
  (t) => [uniqueIndex("idx_profiles_owner").on(t.owner)],
);

/** A Clarity share code, sealed like the Share sign-in. Not part of backups. */
export const clarityConnections = pgTable("clarity_connections", {
  owner: text("owner").primaryKey(),
  credentials: text("credentials").notNull(),
  subjectId: text("subject_id").notNull(),
  subjectName: text("subject_name").notNull(),
  expiresAt: text("expires_at").notNull(),
  autoSync: boolean("auto_sync").notNull(),
  /** JSON array of report kinds archived each month; empty archives none. */
  monthlyReports: text("monthly_reports").notNull(),
  /** Last local date (YYYY-MM-DD) a sync has covered. */
  syncedThrough: text("synced_through"),
  lastSync: text("last_sync"),
  lastAttemptAt: text("last_attempt_at"),
  lastError: text("last_error"),
  updated: text("updated").notNull(),
});
/** Clarity PDF reports, kept after a disconnect. Not part of backups. */
export const clarityReports = pgTable(
  "clarity_reports",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    reports: text("reports").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    scheduled: boolean("scheduled").notNull(),
    created: text("created").notNull(),
    size: integer("size").notNull(),
    pdf: bytea("pdf").notNull(),
  },
  (t) => [index("idx_clarity_reports_owner_created").on(t.owner, t.created)],
);
/**
 * One row per CGM sensor, from the transmitter ID on each Clarity reading. Kept after a
 * disconnect; a later Clarity sync rebuilds it, so it is not part of backups.
 */
export const sensorSessions = pgTable(
  "sensor_sessions",
  {
    owner: text("owner").notNull(),
    sensorId: text("sensor_id").notNull(),
    source: text("source"),
    firstAt: text("first_at").notNull(),
    lastAt: text("last_at").notNull(),
    updated: text("updated").notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.sensorId] })],
);
/** The CGM's device and alert settings as Clarity last reported them. Not part of backups. */
export const cgmDeviceSettings = pgTable("cgm_device_settings", {
  owner: text("owner").primaryKey(),
  /** JSON ClarityDevice. */
  data: text("data").notNull(),
  updated: text("updated").notNull(),
});
