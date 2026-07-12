CREATE TABLE `connector_schedule_revisions` (
	`revision` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`state` text NOT NULL,
	`cadence_json` text NOT NULL,
	`timezone` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `connector_schedules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_connector_schedule_revisions_schedule` ON `connector_schedule_revisions` (`schedule_id`,`created_at`);