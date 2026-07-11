PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
DELETE FROM `sourcing_findings`;--> statement-breakpoint
DELETE FROM `normalization_field_outcomes`;--> statement-breakpoint
DELETE FROM `normalization_gates`;--> statement-breakpoint
DELETE FROM `canonical_source_candidates`;--> statement-breakpoint
DELETE FROM `normalization_replay_items`;--> statement-breakpoint
DELETE FROM `normalization_attempts`;--> statement-breakpoint
DELETE FROM `normalization_runs`;--> statement-breakpoint
DELETE FROM `normalization_replay_requests`;--> statement-breakpoint
DELETE FROM `raw_source_occurrences` WHERE `connector_run_id` IS NOT NULL;--> statement-breakpoint
DELETE FROM `connector_observations`;--> statement-breakpoint
DELETE FROM `connector_checkpoints`;--> statement-breakpoint
DELETE FROM `connector_runs`;--> statement-breakpoint
UPDATE `connector_instances`
SET `connector_version` = '0.7.0'
WHERE `connector_id` = 'jobright.resolver';--> statement-breakpoint
CREATE TABLE `retry_work` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`connector_instance_id` text,
	`filter_signature` text,
	`checkpoint_schema_version` text,
	`checkpoint_generation` text,
	`raw_revision_id` text,
	`resolver_id` text,
	`resolver_version` text,
	`input_hash` text,
	`reason` text NOT NULL,
	`attempt` integer NOT NULL,
	`max_attempts` integer NOT NULL,
	`last_attempt_at` text NOT NULL,
	`computed_delay_ms` integer,
	`server_minimum_delay_ms` integer,
	`next_attempt_at` text,
	`horizon_at` text NOT NULL,
	`state` text NOT NULL,
	`owner_version` text NOT NULL,
	`lineage_json` text NOT NULL,
	`acquired_at` text,
	`acquisition_token` text,
	`acquisition_run_id` text,
	`skipped_run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`connector_instance_id`) REFERENCES `connector_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`) REFERENCES `raw_source_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`acquisition_run_id`) REFERENCES `connector_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`skipped_run_id`) REFERENCES `connector_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_retry_work_kind" CHECK("retry_work"."kind" in ('connector_capture','normalization')),
	CONSTRAINT "chk_retry_work_reason" CHECK("retry_work"."reason" in ('rate_limit','server_failure','network_interruption','operation_timeout')),
	CONSTRAINT "chk_retry_work_state" CHECK("retry_work"."state" in ('scheduled','acquired','completed','exhausted','cancelled')),
	CONSTRAINT "chk_retry_work_attempt" CHECK("retry_work"."attempt" >= 1 and "retry_work"."max_attempts" >= "retry_work"."attempt"),
	CONSTRAINT "chk_retry_work_server_minimum" CHECK("retry_work"."server_minimum_delay_ms" is null or "retry_work"."server_minimum_delay_ms" >= 0),
	CONSTRAINT "chk_retry_work_scope" CHECK((
      "retry_work"."kind" = 'connector_capture'
      and "retry_work"."connector_instance_id" is not null
      and "retry_work"."filter_signature" is not null
      and "retry_work"."checkpoint_schema_version" is not null
      and "retry_work"."checkpoint_generation" is not null
      and "retry_work"."raw_revision_id" is null
      and "retry_work"."resolver_id" is null
      and "retry_work"."resolver_version" is null
      and "retry_work"."input_hash" is null
    ) or (
      "retry_work"."kind" = 'normalization'
      and "retry_work"."connector_instance_id" is null
      and "retry_work"."filter_signature" is null
      and "retry_work"."checkpoint_schema_version" is null
      and "retry_work"."checkpoint_generation" is null
      and "retry_work"."raw_revision_id" is not null
      and "retry_work"."resolver_id" is not null
      and "retry_work"."resolver_version" is not null
      and "retry_work"."input_hash" is not null
    )),
	CONSTRAINT "chk_retry_work_timing" CHECK((
      "retry_work"."state" in ('scheduled','acquired')
      and "retry_work"."computed_delay_ms" is not null
      and "retry_work"."computed_delay_ms" >= 0
      and "retry_work"."next_attempt_at" is not null
    ) or (
      "retry_work"."state" in ('completed','exhausted','cancelled')
      and "retry_work"."next_attempt_at" is null
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_retry_work_capture_identity` ON `retry_work` (`connector_instance_id`,`filter_signature`,`checkpoint_schema_version`,`checkpoint_generation`) WHERE "retry_work"."kind" = 'connector_capture' and "retry_work"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_retry_work_normalization_identity` ON `retry_work` (`raw_revision_id`,`resolver_id`,`resolver_version`,`input_hash`) WHERE "retry_work"."kind" = 'normalization' and "retry_work"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `idx_retry_work_due` ON `retry_work` (`state`,`next_attempt_at`);
