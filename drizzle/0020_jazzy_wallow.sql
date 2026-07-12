CREATE TABLE `connector_schedule_events` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`actor_class` text NOT NULL,
	`action` text NOT NULL,
	`revision` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `connector_schedules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_connector_schedule_events_schedule` ON `connector_schedule_events` (`schedule_id`,`at`);--> statement-breakpoint
CREATE TABLE `connector_schedule_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`schedule_revision` text NOT NULL,
	`nominal_at` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`admitted_mode` text NOT NULL,
	`outcome` text NOT NULL,
	`connector_run_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `connector_schedules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_run_id`) REFERENCES `connector_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_connector_schedule_occurrences_idempotency` ON `connector_schedule_occurrences` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_connector_schedule_occurrences_schedule` ON `connector_schedule_occurrences` (`schedule_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_connector_schedule_occurrences_run` ON `connector_schedule_occurrences` (`connector_run_id`);--> statement-breakpoint
CREATE TABLE `connector_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_instance_id` text NOT NULL,
	`revision` text NOT NULL,
	`state` text NOT NULL,
	`cadence_json` text NOT NULL,
	`timezone` text NOT NULL,
	`next_eligible_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`connector_instance_id`) REFERENCES `connector_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_connector_schedules_instance` ON `connector_schedules` (`connector_instance_id`) WHERE `deleted_at` is null;--> statement-breakpoint
CREATE INDEX `idx_connector_schedules_next_eligible` ON `connector_schedules` (`next_eligible_at`);
