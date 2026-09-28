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

/**
 * A person whose diabetes Carby tracks. Every care table's `owner` is a person id. An account
 * created before people existed owns one person whose id is the account id, so its rows are
 * unchanged. Not part of backups: a backup holds one person's records.
 */
export const people = pgTable("people", {
  id: text("id").primaryKey(),
  createdBy: text("created_by").notNull(),
  created: text("created").notNull(),
});
/** Which signed-in accounts may reach a person, and what they may do there. */
export const personMembers = pgTable(
  "person_members",
  {
    person: text("person").notNull(),
    account: text("account").notNull(),
    /** The account's display name when it joined, shown to the person's owners. */
    accountName: text("account_name").notNull(),
    /** owner | caregiver | viewer */
    role: text("role").notNull(),
    created: text("created").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.person, t.account] }),
    index("idx_person_members_account").on(t.account),
  ],
);
/** Single-use invite links. Only a SHA-256 of the link's token is stored. */
export const personInvites = pgTable(
  "person_invites",
  {
    id: text("id").primaryKey(),
    person: text("person").notNull(),
    tokenHash: text("token_hash").notNull(),
    role: text("role").notNull(),
    createdBy: text("created_by").notNull(),
    createdByName: text("created_by_name").notNull(),
    created: text("created").notNull(),
    expires: text("expires").notNull(),
    acceptedBy: text("accepted_by"),
    acceptedAt: text("accepted_at"),
  },
  (t) => [
    uniqueIndex("idx_person_invites_token").on(t.tokenHash),
    index("idx_person_invites_person").on(t.person),
  ],
);
/**
 * Tokens that reach one person's data without a browser session, for Nightscout uploaders and
 * readers. A token acts as the account that created it, with that account's current role, and
 * is deleted when the account loses access. Only hashes are stored: SHA-256 of the token as sent,
 * and SHA-1 for the `api-secret` header Nightscout clients send. Not part of backups.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    person: text("person").notNull(),
    account: text("account").notNull(),
    label: text("label").notNull(),
    /** Space-separated: read, upload */
    scopes: text("scopes").notNull(),
    tokenHash: text("token_hash").notNull(),
    secretHash: text("secret_hash").notNull(),
    created: text("created").notNull(),
    lastUsed: text("last_used"),
  },
  (t) => [
    uniqueIndex("idx_api_tokens_token").on(t.tokenHash),
    uniqueIndex("idx_api_tokens_secret").on(t.secretHash),
    index("idx_api_tokens_person_account").on(t.person, t.account),
  ],
);
/**
 * Documents uploaded over the Nightscout API, as the uploader sent them. Each keeps the `_id`
 * and `identifier` the client gave so every read and delete returns them, a key that makes an
 * identical re-upload a no-op, and the Carby records it became (`carby`, a JSON list of
 * `{ table, id }`). A deleted document stays as a tombstone for readers and v3 history. One deleted
 * in Carby stays deleted whatever the uploader sends; one the uploader deleted may come back with
 * the same id, since uploaders update a record by deleting and resending it. Not part of backups;
 * the Carby records it made are.
 */
export const nightscoutRecords = pgTable(
  "nightscout_records",
  {
    owner: text("owner").notNull(),
    /** entries | treatments | devicestatus | profile */
    collection: text("collection").notNull(),
    id: text("id").notNull(),
    identifier: text("identifier"),
    /** The collection's natural key (for example an entry's type and time), hashed. */
    dedupeKey: text("dedupe_key").notNull(),
    at: text("at").notNull(),
    data: text("data").notNull(),
    carby: text("carby").notNull(),
    token: text("token").notNull(),
    created: text("created").notNull(),
    modified: text("modified").notNull(),
    deleted: text("deleted"),
    /** carby | upload: who deleted it, and so whether the uploader can bring it back. */
    deletedBy: text("deleted_by"),
  },
  (t) => [
    primaryKey({ columns: [t.owner, t.collection, t.id] }),
    index("idx_nightscout_records_identifier").on(t.owner, t.collection, t.identifier),
    index("idx_nightscout_records_dedupe").on(t.owner, t.collection, t.dedupeKey),
    index("idx_nightscout_records_at").on(t.owner, t.collection, t.at),
    index("idx_nightscout_records_modified").on(t.owner, t.collection, t.modified),
  ],
);
/**
 * Records changed here that still have to reach another Carby deployment (one-way sync, only
 * when CARBY_SYNC_PUSH_* is set). One row per record; `previous` is the record's revision
 * before the first unsent change, so the receiver can tell whether it was edited there.
 */
export const syncOutbox = pgTable(
  "sync_outbox",
  {
    owner: text("owner").notNull(),
    tbl: text("tbl").notNull(),
    recordId: text("record_id").notNull(),
    previous: text("previous"),
    /** On a conflict, the receiver's revision; "Send mine anyway" sends against it. */
    theirs: text("theirs"),
    queued: text("queued").notNull(),
    /** pending | conflict | rejected */
    state: text("state").notNull(),
    error: text("error"),
  },
  (t) => [primaryKey({ columns: [t.owner, t.tbl, t.recordId] })],
);
