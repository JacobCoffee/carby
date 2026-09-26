CREATE TABLE `illness_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`start_date` text NOT NULL,
	`data` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_illness_windows_owner_start` ON `illness_windows` (`owner`,`start_date`);
