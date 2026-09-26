CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`at` text NOT NULL,
	`data` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_appointments_owner_at` ON `appointments` (`owner`,`at`);
