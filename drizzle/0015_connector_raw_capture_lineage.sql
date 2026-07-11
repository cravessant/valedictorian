PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
DROP TRIGGER `trg_source_entity_identities_no_delete`;--> statement-breakpoint
DROP TRIGGER `trg_source_identity_conflicts_no_delete`;--> statement-breakpoint
DELETE FROM `connector_projection_keys`;--> statement-breakpoint
DELETE FROM `connector_observations`;--> statement-breakpoint
DELETE FROM `normalization_field_outcomes`;--> statement-breakpoint
DELETE FROM `normalization_gates`;--> statement-breakpoint
DELETE FROM `canonical_source_candidates`;--> statement-breakpoint
DELETE FROM `normalization_replay_items`;--> statement-breakpoint
DELETE FROM `normalization_attempts`;--> statement-breakpoint
DELETE FROM `normalization_runs`;--> statement-breakpoint
DELETE FROM `normalization_replay_requests`;--> statement-breakpoint
DELETE FROM `source_identity_conflicts`;--> statement-breakpoint
DELETE FROM `source_entity_identities`;--> statement-breakpoint
DELETE FROM `raw_source_occurrences`;--> statement-breakpoint
DELETE FROM `raw_source_revisions`;--> statement-breakpoint
DELETE FROM `raw_source_records`;--> statement-breakpoint
DELETE FROM `source_entities`;--> statement-breakpoint
DELETE FROM `connector_checkpoints`;--> statement-breakpoint
DELETE FROM `connector_runs`;--> statement-breakpoint
DELETE FROM `sourcing_findings`;--> statement-breakpoint
UPDATE `connector_instances`
SET `connector_version` = '0.6.0'
WHERE `connector_id` = 'jobright.resolver';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_connector_runs_id_instance` ON `connector_runs` (`id`,`connector_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_raw_source_revisions_id_record` ON `raw_source_revisions` (`id`,`raw_record_id`);--> statement-breakpoint
CREATE TABLE `__new_raw_source_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_record_id` text NOT NULL,
	`raw_revision_id` text NOT NULL,
	`connector_instance_id` text,
	`connector_run_id` text,
	`observed_at` text NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`raw_record_id`) REFERENCES `raw_source_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`) REFERENCES `raw_source_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_instance_id`) REFERENCES `connector_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_run_id`) REFERENCES `connector_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`,`raw_record_id`) REFERENCES `raw_source_revisions`(`id`,`raw_record_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_run_id`,`connector_instance_id`) REFERENCES `connector_runs`(`id`,`connector_instance_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_raw_source_occurrences_connector_capture" CHECK((`connector_instance_id` is null and `connector_run_id` is null) or (`connector_instance_id` is not null and `connector_run_id` is not null))
);--> statement-breakpoint
DROP TABLE `raw_source_occurrences`;--> statement-breakpoint
ALTER TABLE `__new_raw_source_occurrences` RENAME TO `raw_source_occurrences`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_raw_source_occurrences_lineage` ON `raw_source_occurrences` (`id`,`raw_revision_id`,`raw_record_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_raw_source_occurrences_connector_lineage` ON `raw_source_occurrences` (`id`,`raw_revision_id`,`raw_record_id`,`connector_instance_id`,`connector_run_id`);--> statement-breakpoint
CREATE INDEX `idx_raw_source_occurrences_record_chronology` ON `raw_source_occurrences` (`raw_record_id`,`observed_at`,`received_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_raw_source_occurrences_revision` ON `raw_source_occurrences` (`raw_revision_id`);--> statement-breakpoint
CREATE INDEX `idx_raw_source_occurrences_connector_run` ON `raw_source_occurrences` (`connector_run_id`);--> statement-breakpoint
ALTER TABLE `normalization_runs` ADD `trigger_occurrence_id` text;--> statement-breakpoint
ALTER TABLE `normalization_runs` ADD `trigger_connector_instance_id` text;--> statement-breakpoint
ALTER TABLE `normalization_runs` ADD `trigger_connector_run_id` text;--> statement-breakpoint
CREATE TRIGGER `trg_normalization_runs_trigger_lineage_insert`
BEFORE INSERT ON `normalization_runs`
WHEN NOT (
	(NEW.trigger_occurrence_id IS NULL AND NEW.trigger_connector_instance_id IS NULL AND NEW.trigger_connector_run_id IS NULL)
	OR (
		NEW.trigger_occurrence_id IS NOT NULL AND NEW.trigger_connector_instance_id IS NOT NULL AND NEW.trigger_connector_run_id IS NOT NULL
		AND EXISTS (
			SELECT 1 FROM raw_source_occurrences occurrence
			WHERE occurrence.id = NEW.trigger_occurrence_id
				AND occurrence.raw_revision_id = NEW.raw_revision_id
				AND occurrence.raw_record_id = NEW.raw_record_id
				AND occurrence.connector_instance_id = NEW.trigger_connector_instance_id
				AND occurrence.connector_run_id = NEW.trigger_connector_run_id
		)
	)
)
BEGIN SELECT RAISE(ABORT, 'normalization trigger lineage mismatch'); END;--> statement-breakpoint
CREATE TRIGGER `trg_normalization_runs_trigger_lineage_update`
BEFORE UPDATE OF trigger_occurrence_id, trigger_connector_instance_id, trigger_connector_run_id, raw_revision_id, raw_record_id ON `normalization_runs`
WHEN NOT (
	(NEW.trigger_occurrence_id IS NULL AND NEW.trigger_connector_instance_id IS NULL AND NEW.trigger_connector_run_id IS NULL)
	OR (
		NEW.trigger_occurrence_id IS NOT NULL AND NEW.trigger_connector_instance_id IS NOT NULL AND NEW.trigger_connector_run_id IS NOT NULL
		AND EXISTS (
			SELECT 1 FROM raw_source_occurrences occurrence
			WHERE occurrence.id = NEW.trigger_occurrence_id
				AND occurrence.raw_revision_id = NEW.raw_revision_id
				AND occurrence.raw_record_id = NEW.raw_record_id
				AND occurrence.connector_instance_id = NEW.trigger_connector_instance_id
				AND occurrence.connector_run_id = NEW.trigger_connector_run_id
		)
	)
)
BEGIN SELECT RAISE(ABORT, 'normalization trigger lineage mismatch'); END;--> statement-breakpoint
CREATE TRIGGER `trg_raw_source_occurrences_normalization_lineage_update`
BEFORE UPDATE OF id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id ON `raw_source_occurrences`
WHEN (
	NEW.id IS NOT OLD.id
	OR NEW.raw_record_id IS NOT OLD.raw_record_id
	OR NEW.raw_revision_id IS NOT OLD.raw_revision_id
	OR NEW.connector_instance_id IS NOT OLD.connector_instance_id
	OR NEW.connector_run_id IS NOT OLD.connector_run_id
)
AND EXISTS (
	SELECT 1 FROM normalization_runs run WHERE run.trigger_occurrence_id = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'normalization trigger occurrence is immutable'); END;--> statement-breakpoint
CREATE TRIGGER `trg_raw_source_occurrences_normalization_lineage_delete`
BEFORE DELETE ON `raw_source_occurrences`
WHEN EXISTS (
	SELECT 1 FROM normalization_runs run WHERE run.trigger_occurrence_id = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'normalization trigger occurrence is immutable'); END;--> statement-breakpoint
CREATE TRIGGER `trg_source_entity_identities_no_delete`
BEFORE DELETE ON `source_entity_identities`
BEGIN SELECT RAISE(ABORT, 'source entity identities are append-only'); END;--> statement-breakpoint
CREATE TRIGGER `trg_source_identity_conflicts_no_delete`
BEFORE DELETE ON `source_identity_conflicts`
BEGIN SELECT RAISE(ABORT, 'source identity conflicts are append-only'); END;
