CREATE TABLE `policy_config` (
	`id` text PRIMARY KEY NOT NULL,
	`config_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `policy_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`tag` text NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_policy_evidence_subject` ON `policy_evidence` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_policy_evidence_subject_tag` ON `policy_evidence` (`subject_type`,`subject_id`,`tag`);--> statement-breakpoint
CREATE TABLE `profile_answers` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`question_pattern` text NOT NULL,
	`answer` text NOT NULL,
	`category` text,
	`include_in_agent_context` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `profile_education` (
	`id` text PRIMARY KEY NOT NULL,
	`education_type` text NOT NULL,
	`school` text NOT NULL,
	`degree` text,
	`major` text,
	`graduation_date` text,
	`class_standing` text,
	`sat_score` text,
	`transcript_path` text,
	`notes` text,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `profile_secrets` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`encrypted_value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `profile_sensitive_details` (
	`id` text PRIMARY KEY NOT NULL,
	`birth_day_encrypted` text,
	`birth_month_encrypted` text,
	`birth_year_encrypted` text,
	`date_of_birth_encrypted` text,
	`disability_status_encrypted` text,
	`gender_encrypted` text,
	`hispanic_latino_encrypted` text,
	`race_ethnicity_encrypted` text,
	`ssn_last_4_encrypted` text,
	`veteran_status_encrypted` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `sourcing_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`source_id` text NOT NULL,
	`company_name` text NOT NULL,
	`role_title` text NOT NULL,
	`role_kind` text NOT NULL,
	`term` text,
	`city` text,
	`region` text,
	`country` text NOT NULL,
	`work_mode` text NOT NULL,
	`location_raw` text,
	`official_url` text,
	`source_url` text,
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
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merged_application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sourcing_findings_source_id` ON `sourcing_findings` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_sourcing_findings_source_status_discovered` ON `sourcing_findings` (`source_id`,`merge_status`,`discovered_at`);--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`address_line_1` text,
	`address_line_2` text,
	`city` text,
	`country` text,
	`citizenship` text,
	`class_standing` text,
	`cover_letter_path` text,
	`degree` text,
	`email` text,
	`full_name` text,
	`github_url` text,
	`graduation_date` text,
	`high_school` text,
	`language` text,
	`linkedin_url` text,
	`major` text,
	`phone` text,
	`phone_device_type` text,
	`portfolio_url` text,
	`preferred_name` text,
	`region` text,
	`relocation` text,
	`relocation_notes` text,
	`require_sponsorship` text,
	`require_sponsorship_future` text,
	`sat_score` text,
	`school` text,
	`transcript_path` text,
	`travel` text,
	`travel_notes` text,
	`willing_to_relocate` integer,
	`willing_to_travel` integer,
	`work_authorization` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `workflow_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`payload_json` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_type` text NOT NULL,
	`status` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_name` text,
	`source_id` text,
	`subject_application_id` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`coverage_started_at` text,
	`coverage_ended_at` text,
	`timezone` text,
	`input_json` text NOT NULL,
	`summary` text,
	`outcome` text,
	`blocker` text,
	`metadata_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_source_id` ON `workflow_runs` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_source_type_status_started` ON `workflow_runs` (`source_id`,`run_type`,`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_sources_name` ON `sources` (`name`);