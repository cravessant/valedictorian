PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE `connector_projection_keys`;--> statement-breakpoint
CREATE TABLE `__new_connector_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_instance_id` text NOT NULL,
	`connector_run_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`connector_version` text NOT NULL,
	`parser_version` text,
	`observation_schema_version` text,
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
INSERT INTO `__new_connector_observations`("id", "connector_instance_id", "connector_run_id", "connector_id", "connector_version", "parser_version", "observation_schema_version", "source_record_key", "observed_at", "company_name", "role_title", "location_raw", "description_text", "pay_json", "links_json", "resolution_json", "dedupe_keys_json", "source_metadata_json", "evidence_json", "raw_json", "created_at", "updated_at", "deleted_at") SELECT "id", "connector_instance_id", "connector_run_id", "connector_id", "connector_version", "parser_version", "observation_schema_version", "source_record_key", "observed_at", "company_name", "role_title", "location_raw", "description_text", "pay_json", "links_json", "resolution_json", "dedupe_keys_json", "source_metadata_json", "evidence_json", "raw_json", "created_at", "updated_at", "deleted_at" FROM `connector_observations`;--> statement-breakpoint
DROP TABLE `connector_observations`;--> statement-breakpoint
ALTER TABLE `__new_connector_observations` RENAME TO `connector_observations`;--> statement-breakpoint
CREATE INDEX `idx_connector_observations_instance` ON `connector_observations` (`connector_instance_id`);--> statement-breakpoint
CREATE INDEX `idx_connector_observations_run` ON `connector_observations` (`connector_run_id`);--> statement-breakpoint
CREATE INDEX `idx_connector_observations_source_record` ON `connector_observations` (`connector_instance_id`,`source_record_key`);--> statement-breakpoint
CREATE TABLE `__new_sourcing_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`projection_identity_key` text,
	`source_entity_id` text,
	`canonical_candidate_id` text,
	`raw_revision_id` text,
	`adapter_id` text,
	`adapter_kind` text,
	`adapter_version` text,
	`workflow_run_id` text NOT NULL,
	`source_id` text NOT NULL,
	`company_name` text NOT NULL,
	`role_title` text NOT NULL,
	`role_kind` text NOT NULL,
	`term` text,
	`timing_mode` text DEFAULT 'unknown' NOT NULL,
	`terms_json` text DEFAULT '[]' NOT NULL,
	`start_date` text,
	`end_date` text,
	`city` text,
	`region` text,
	`country` text,
	`work_mode` text NOT NULL,
	`location_raw` text,
	`employment_type` text,
	`seniority` text,
	`location_json` text,
	`compensation_json` text,
	`posted_at_json` text,
	`official_url` text,
	`source_url` text,
	`destination_class` text,
	`destination_url` text,
	`intermediary_url` text,
	`usability` text,
	`posted_age` text,
	`priority_score` integer,
	`priority_band` text,
	`fit_notes` text,
	`duplicate_notes` text,
	`blocker` text,
	`policy_blocker` text,
	`disposition_reason` text,
	`merge_status` text NOT NULL,
	`merged_application_id` text,
	`merge_notes` text,
	`discovered_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`source_entity_id`) REFERENCES `source_entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`canonical_candidate_id`) REFERENCES `canonical_source_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`) REFERENCES `raw_source_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merged_application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TABLE `sourcing_findings`;--> statement-breakpoint
ALTER TABLE `__new_sourcing_findings` RENAME TO `sourcing_findings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sourcing_findings_projection_identity` ON `sourcing_findings` (`projection_identity_key`);--> statement-breakpoint
CREATE INDEX `idx_sourcing_findings_source_entity` ON `sourcing_findings` (`source_entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sourcing_findings_canonical_candidate` ON `sourcing_findings` (`canonical_candidate_id`);--> statement-breakpoint
CREATE INDEX `idx_sourcing_findings_source_id` ON `sourcing_findings` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_sourcing_findings_source_status_discovered` ON `sourcing_findings` (`source_id`,`merge_status`,`discovered_at`);
