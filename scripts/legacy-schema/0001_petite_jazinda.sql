CREATE TABLE `cgm_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`at` text NOT NULL,
	`value` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cgm_owner_at` ON `cgm_readings` (`owner`,`at`);--> statement-breakpoint
CREATE TABLE `saved_foods` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_saved_foods_owner` ON `saved_foods` (`owner`);
