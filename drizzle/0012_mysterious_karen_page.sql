CREATE TABLE `normalization_replay_items` (
	`id` text PRIMARY KEY NOT NULL,
	`replay_id` text NOT NULL,
	`raw_record_id` text NOT NULL,
	`raw_revision_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`sequence` integer NOT NULL,
	`status` text NOT NULL,
	`normalization_run_id` text,
	`failure_json` text,
	`completed_at` text,
	FOREIGN KEY (`replay_id`) REFERENCES `normalization_replay_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_record_id`) REFERENCES `raw_source_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`) REFERENCES `raw_source_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`normalization_run_id`) REFERENCES `normalization_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_normalization_replay_items_status" CHECK("normalization_replay_items"."status" in ('pending','completed','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_normalization_replay_items_sequence` ON `normalization_replay_items` (`replay_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_normalization_replay_items_revision` ON `normalization_replay_items` (`replay_id`,`raw_revision_id`);--> statement-breakpoint
CREATE TABLE `normalization_replay_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`selector_json` text NOT NULL,
	`invalidation_json` text NOT NULL,
	`target_versions_json` text,
	`field_directives_json` text NOT NULL,
	`status` text NOT NULL,
	`accepted_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT "chk_normalization_replay_requests_status" CHECK("normalization_replay_requests"."status" in ('accepted','in_progress','completed','completed_with_failures'))
);
--> statement-breakpoint
CREATE INDEX `idx_normalization_replay_requests_chronology` ON `normalization_replay_requests` (`accepted_at`,`id`);--> statement-breakpoint
DROP INDEX `idx_normalization_runs_cache`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_normalization_runs_cache` ON `normalization_runs` (`raw_revision_id`,`input_hash`,`resolver_set_hash`,`canonical_schema_version`,`gate_policy_version`) WHERE "normalization_runs"."trigger_id" is null;