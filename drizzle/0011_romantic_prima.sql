CREATE TABLE `canonical_source_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`source_entity_id` text NOT NULL,
	`raw_record_id` text NOT NULL,
	`raw_revision_id` text NOT NULL,
	`schema_version` text NOT NULL,
	`candidate_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `normalization_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_entity_id`) REFERENCES `source_entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_record_id`) REFERENCES `raw_source_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`) REFERENCES `raw_source_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_canonical_source_candidates_run` ON `canonical_source_candidates` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_canonical_source_candidates_revision_schema` ON `canonical_source_candidates` (`raw_revision_id`,`schema_version`);--> statement-breakpoint
CREATE TABLE `normalization_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`raw_revision_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`resolver_id` text NOT NULL,
	`resolver_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`declaration_json` text NOT NULL,
	`applicability_json` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `normalization_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`) REFERENCES `raw_source_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_normalization_attempts_run_sequence` ON `normalization_attempts` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_normalization_attempts_resolver` ON `normalization_attempts` (`resolver_id`,`resolver_version`,`input_hash`);--> statement-breakpoint
CREATE TABLE `normalization_field_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`attempt_sequence` integer NOT NULL,
	`outcome_index` integer NOT NULL,
	`field` text NOT NULL,
	`status` text NOT NULL,
	`resolver_id` text NOT NULL,
	`resolver_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`outcome_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `normalization_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attempt_id`) REFERENCES `normalization_attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_normalization_field_outcomes_run_sequence` ON `normalization_field_outcomes` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_normalization_field_outcomes_selector` ON `normalization_field_outcomes` (`run_id`,`field`,`attempt_sequence`,`outcome_index`);--> statement-breakpoint
CREATE INDEX `idx_normalization_field_outcomes_resolver` ON `normalization_field_outcomes` (`resolver_id`,`resolver_version`,`input_hash`);--> statement-breakpoint
CREATE TABLE `normalization_gates` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`policy_version` text NOT NULL,
	`status` text NOT NULL,
	`candidate_id` text,
	`gate_json` text NOT NULL,
	`evaluated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `normalization_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `canonical_source_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_normalization_gates_status" CHECK("normalization_gates"."status" in ('passed','needs_enrichment','rejected','failed')),
	CONSTRAINT "chk_normalization_gates_candidate" CHECK(("normalization_gates"."status" = 'passed' and "normalization_gates"."candidate_id" is not null) or ("normalization_gates"."status" <> 'passed' and "normalization_gates"."candidate_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_normalization_gates_run` ON `normalization_gates` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_normalization_gates_policy` ON `normalization_gates` (`policy_version`,`status`);--> statement-breakpoint
CREATE TABLE `normalization_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_record_id` text NOT NULL,
	`raw_revision_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`resolver_set_hash` text NOT NULL,
	`canonical_schema_version` text NOT NULL,
	`gate_policy_version` text NOT NULL,
	`trigger_kind` text DEFAULT 'intake' NOT NULL,
	`trigger_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`raw_record_id`) REFERENCES `raw_source_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`) REFERENCES `raw_source_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_normalization_runs_status" CHECK("normalization_runs"."status" in ('pending','in_progress','completed','blocked','failed')),
	CONSTRAINT "chk_normalization_runs_trigger_kind" CHECK("normalization_runs"."trigger_kind" in ('intake'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_normalization_runs_cache` ON `normalization_runs` (`raw_revision_id`,`input_hash`,`resolver_set_hash`,`canonical_schema_version`,`gate_policy_version`);--> statement-breakpoint
CREATE INDEX `idx_normalization_runs_raw_record` ON `normalization_runs` (`raw_record_id`,`created_at`);