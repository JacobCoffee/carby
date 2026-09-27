CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"created" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"person" text NOT NULL,
	"token_hash" text NOT NULL,
	"role" text NOT NULL,
	"created_by" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created" text NOT NULL,
	"expires" text NOT NULL,
	"accepted_by" text,
	"accepted_at" text
);
--> statement-breakpoint
CREATE TABLE "person_members" (
	"person" text NOT NULL,
	"account" text NOT NULL,
	"account_name" text NOT NULL,
	"role" text NOT NULL,
	"created" text NOT NULL,
	CONSTRAINT "person_members_person_account_pk" PRIMARY KEY("person","account")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_person_invites_token" ON "person_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_person_invites_person" ON "person_invites" USING btree ("person");--> statement-breakpoint
CREATE INDEX "idx_person_members_account" ON "person_members" USING btree ("account");
--> statement-breakpoint
-- Every account that already has records becomes one person with the same id, owned by that
-- account, so no care row changes owner. account_name is refreshed on the account's next visit.
INSERT INTO "people" ("id", "created_by", "created")
SELECT "owner", "owner", to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM (
	SELECT "owner" FROM "plans"
	UNION SELECT "owner" FROM "profiles"
	UNION SELECT "owner" FROM "entries"
	UNION SELECT "owner" FROM "saved_foods"
	UNION SELECT "owner" FROM "cgm_readings"
	UNION SELECT "owner" FROM "dexcom_events"
	UNION SELECT "owner" FROM "dexcom_connections"
	UNION SELECT "owner" FROM "care_audit"
	UNION SELECT "owner" FROM "illness_windows"
	UNION SELECT "owner" FROM "appointments"
	UNION SELECT "owner" FROM "import_sessions"
	UNION SELECT "owner" FROM "clarity_connections"
	UNION SELECT "owner" FROM "clarity_reports"
	UNION SELECT "owner" FROM "sensor_sessions"
	UNION SELECT "owner" FROM "cgm_device_settings"
) AS "owners"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "person_members" ("person", "account", "account_name", "role", "created")
SELECT "id", "id", "id", 'owner', "created" FROM "people"
ON CONFLICT DO NOTHING;