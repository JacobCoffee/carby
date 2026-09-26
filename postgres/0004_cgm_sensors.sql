CREATE TABLE "cgm_device_settings" (
	"owner" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"updated" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensor_sessions" (
	"owner" text NOT NULL,
	"sensor_id" text NOT NULL,
	"source" text,
	"first_at" text NOT NULL,
	"last_at" text NOT NULL,
	"updated" text NOT NULL,
	CONSTRAINT "sensor_sessions_owner_sensor_id_pk" PRIMARY KEY("owner","sensor_id")
);
