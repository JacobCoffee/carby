CREATE TABLE `dexcom_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dexcom_events_owner_at` ON `dexcom_events` (`owner`,`at`);
