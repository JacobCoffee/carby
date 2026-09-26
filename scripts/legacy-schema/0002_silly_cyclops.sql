CREATE TABLE `dexcom_connections` (
	`owner` text PRIMARY KEY NOT NULL,
	`credentials` text NOT NULL,
	`last_sync` text,
	`updated` text NOT NULL
);
