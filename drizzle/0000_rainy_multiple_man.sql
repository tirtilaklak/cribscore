CREATE TABLE `journal_events` (
	`owner_id` text NOT NULL,
	`event_index` integer NOT NULL,
	`event_id` text NOT NULL,
	`event_json` text NOT NULL,
	`received_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `event_index`),
	FOREIGN KEY (`owner_id`) REFERENCES `journal_heads`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_events_index_nonnegative" CHECK("journal_events"."event_index" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_events_owner_event_unique` ON `journal_events` (`owner_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `journal_heads` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`journal_id` text NOT NULL,
	`created_at` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "journal_heads_revision_nonnegative" CHECK("journal_heads"."revision" >= 0)
);
