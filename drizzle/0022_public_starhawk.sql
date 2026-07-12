PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
DELETE FROM `sourcing_findings`;--> statement-breakpoint
DELETE FROM `normalization_field_outcomes`;--> statement-breakpoint
DELETE FROM `normalization_gates`;--> statement-breakpoint
DELETE FROM `canonical_source_candidates`;--> statement-breakpoint
DELETE FROM `normalization_replay_items`;--> statement-breakpoint
DELETE FROM `normalization_attempts`;--> statement-breakpoint
DELETE FROM `normalization_runs`;--> statement-breakpoint
DELETE FROM `normalization_replay_requests`;--> statement-breakpoint
CREATE TABLE `sourcing_projection_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_record_id` text NOT NULL,
	`raw_revision_id` text NOT NULL,
	`canonical_candidate_id` text NOT NULL,
	`status` text NOT NULL,
	`finding_id` text,
	`failure_code` text,
	`failure_retryable` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`projected_at` text,
	`failed_at` text,
	FOREIGN KEY (`raw_record_id`) REFERENCES `raw_source_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`) REFERENCES `raw_source_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`canonical_candidate_id`) REFERENCES `canonical_source_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finding_id`) REFERENCES `sourcing_findings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`,`raw_record_id`) REFERENCES `raw_source_revisions`(`id`,`raw_record_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`canonical_candidate_id`,`raw_record_id`,`raw_revision_id`) REFERENCES `canonical_source_candidates`(`id`,`raw_record_id`,`raw_revision_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sourcing_projection_outcomes_status" CHECK("sourcing_projection_outcomes"."status" in ('pending','projected','failed')),
	CONSTRAINT "chk_sourcing_projection_outcomes_fields" CHECK(
      ("sourcing_projection_outcomes"."status" = 'pending' and "sourcing_projection_outcomes"."finding_id" is null and "sourcing_projection_outcomes"."failure_code" is null and "sourcing_projection_outcomes"."failure_retryable" is null and "sourcing_projection_outcomes"."projected_at" is null and "sourcing_projection_outcomes"."failed_at" is null)
      or ("sourcing_projection_outcomes"."status" = 'projected' and "sourcing_projection_outcomes"."finding_id" is not null and "sourcing_projection_outcomes"."failure_code" is null and "sourcing_projection_outcomes"."failure_retryable" is null and "sourcing_projection_outcomes"."projected_at" is not null and "sourcing_projection_outcomes"."failed_at" is null)
      or ("sourcing_projection_outcomes"."status" = 'failed' and "sourcing_projection_outcomes"."finding_id" is null and "sourcing_projection_outcomes"."failure_code" in ('projection_failed','persistence_failed','internal_error') and "sourcing_projection_outcomes"."failure_retryable" in (0, 1) and "sourcing_projection_outcomes"."projected_at" is null and "sourcing_projection_outcomes"."failed_at" is not null)
    )
);
--> statement-breakpoint
CREATE INDEX `idx_sourcing_projection_outcomes_revision` ON `sourcing_projection_outcomes` (`raw_revision_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sourcing_projection_outcomes_candidate` ON `sourcing_projection_outcomes` (`canonical_candidate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_canonical_source_candidates_lineage` ON `canonical_source_candidates` (`id`,`raw_record_id`,`raw_revision_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_sourcing_projection_outcomes_pending_insert`
BEFORE INSERT ON `sourcing_projection_outcomes`
WHEN NEW.status <> 'pending'
BEGIN SELECT RAISE(ABORT, 'projection outcome must begin pending'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_sourcing_projection_outcomes_terminal_transition`
BEFORE UPDATE ON `sourcing_projection_outcomes`
WHEN OLD.status <> 'pending' OR NEW.status NOT IN ('projected', 'failed')
BEGIN SELECT RAISE(ABORT, 'projection outcome terminal transition is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_sourcing_projection_outcomes_lineage_immutable`
BEFORE UPDATE ON `sourcing_projection_outcomes`
WHEN NEW.id IS NOT OLD.id
  OR NEW.raw_record_id IS NOT OLD.raw_record_id
  OR NEW.raw_revision_id IS NOT OLD.raw_revision_id
  OR NEW.canonical_candidate_id IS NOT OLD.canonical_candidate_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'projection outcome lineage is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_sourcing_projection_outcomes_no_delete`
BEFORE DELETE ON `sourcing_projection_outcomes`
BEGIN SELECT RAISE(ABORT, 'projection outcomes are append-only'); END;
