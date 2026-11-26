CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`all_day` integer NOT NULL,
	`status` text NOT NULL,
	`meet_link` text,
	`html_link` text
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_events_start` ON `calendar_events` (`start_at`);--> statement-breakpoint
CREATE TABLE `calendar_sync` (
	`calendar_id` text PRIMARY KEY NOT NULL,
	`last_success_at` integer,
	`last_error` text,
	`last_error_at` integer
);
