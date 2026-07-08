CREATE TABLE `connector_checkpoints` (
	`connector_instance_id` text PRIMARY KEY NOT NULL,
	`checkpoint_json` text NOT NULL,
	`schema_version` text NOT NULL,
	`coverage_started_at` text,
	`coverage_ended_at` text,
	`saved_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`connector_instance_id`) REFERENCES `connector_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `connector_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`connector_version` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer NOT NULL,
	`config_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_connector_instances_connector` ON `connector_instances` (`connector_id`);--> statement-breakpoint
CREATE INDEX `idx_connector_instances_enabled` ON `connector_instances` (`enabled`);--> statement-breakpoint
CREATE TABLE `connector_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_instance_id` text NOT NULL,
	`connector_run_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`connector_version` text NOT NULL,
	`source_record_key` text NOT NULL,
	`observed_at` text NOT NULL,
	`company_name` text NOT NULL,
	`role_title` text NOT NULL,
	`location_raw` text,
	`description_text` text,
	`pay_json` text NOT NULL,
	`links_json` text NOT NULL,
	`resolution_json` text NOT NULL,
	`dedupe_keys_json` text NOT NULL,
	`source_metadata_json` text NOT NULL,
	`evidence_json` text NOT NULL,
	`raw_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`connector_instance_id`) REFERENCES `connector_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_run_id`) REFERENCES `connector_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_connector_observations_instance` ON `connector_observations` (`connector_instance_id`);--> statement-breakpoint
CREATE INDEX `idx_connector_observations_run` ON `connector_observations` (`connector_run_id`);--> statement-breakpoint
CREATE INDEX `idx_connector_observations_source_record` ON `connector_observations` (`connector_instance_id`,`source_record_key`);--> statement-breakpoint
CREATE TABLE `connector_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_instance_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`coverage_started_at` text,
	`coverage_ended_at` text,
	`observation_count` integer NOT NULL,
	`warning_count` integer NOT NULL,
	`stats_json` text NOT NULL,
	`warnings_json` text NOT NULL,
	`retry_hints_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`connector_instance_id`) REFERENCES `connector_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_connector_runs_instance` ON `connector_runs` (`connector_instance_id`);--> statement-breakpoint
CREATE INDEX `idx_connector_runs_instance_status_started` ON `connector_runs` (`connector_instance_id`,`status`,`started_at`);