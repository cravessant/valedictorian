CREATE TABLE `source_execution_scopes` (
  `id` text PRIMARY KEY NOT NULL,
  `status` text DEFAULT 'available' NOT NULL,
  `blocked_until` text,
  `backoff_attempt` integer DEFAULT 0 NOT NULL,
  `auth_generation` integer DEFAULT 0 NOT NULL,
  `refresh_lease_token` text,
  `refresh_lease_expires_at` text,
  `action_reason` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `deleted_at` text,
  CONSTRAINT `chk_source_execution_scopes_status` CHECK (`status` in ('available','cooldown','refreshing','action_required')),
  CONSTRAINT `chk_source_execution_scopes_backoff` CHECK (`backoff_attempt` >= 0),
  CONSTRAINT `chk_source_execution_scopes_generation` CHECK (`auth_generation` >= 0),
  CONSTRAINT `chk_source_execution_scopes_id` CHECK (length(`id`) between 8 and 256 and `id` not glob '*[^A-Za-z0-9._~-]*'),
  CONSTRAINT `chk_source_execution_scopes_action_reason` CHECK (`action_reason` is null or (`action_reason` not glob '*[^a-z0-9_]*' and length(`action_reason`) between 1 and 64))
);
--> statement-breakpoint
CREATE INDEX `idx_source_execution_scopes_availability` ON `source_execution_scopes` (`status`,`blocked_until`);
--> statement-breakpoint
CREATE TABLE `connector_run_synchronizations` (
  `connector_run_id` text PRIMARY KEY NOT NULL REFERENCES `connector_runs`(`id`),
  `snapshot_json` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `chk_connector_run_synchronizations_length` CHECK (length(`snapshot_json`) between 2 and 8192)
);
--> statement-breakpoint
CREATE TABLE `source_execution_sessions` (
  `execution_scope_id` text PRIMARY KEY NOT NULL REFERENCES `source_execution_scopes`(`id`),
  `encrypted_session` text NOT NULL,
  `auth_generation` integer NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `chk_source_execution_sessions_length` CHECK (length(`encrypted_session`) between 1 and 1048576),
  CONSTRAINT `chk_source_execution_sessions_generation` CHECK (`auth_generation` >= 1)
);
--> statement-breakpoint
ALTER TABLE `connector_instances` ADD `execution_scope_id` text;
--> statement-breakpoint
ALTER TABLE `connector_runs` ADD `execution_scope_id` text;
--> statement-breakpoint
INSERT INTO `source_execution_scopes` (`id`,`created_at`,`updated_at`)
SELECT 'scope_' || lower(hex(`id`)), `created_at`, `updated_at` FROM `connector_instances`;
--> statement-breakpoint
UPDATE `connector_instances` SET `execution_scope_id` = 'scope_' || lower(hex(`id`));
--> statement-breakpoint
UPDATE `connector_runs` SET `execution_scope_id` = (
  SELECT `execution_scope_id` FROM `connector_instances` WHERE `connector_instances`.`id` = `connector_runs`.`connector_instance_id`
);
--> statement-breakpoint
UPDATE `raw_source_occurrences` SET `connector_instance_id` = NULL, `connector_run_id` = NULL
WHERE `connector_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `execution_scope_id` IS NULL);
--> statement-breakpoint
DELETE FROM `connector_observations` WHERE `connector_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `execution_scope_id` IS NULL);
--> statement-breakpoint
DELETE FROM `connector_schedule_occurrences` WHERE `connector_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `execution_scope_id` IS NULL);
--> statement-breakpoint
DELETE FROM `connector_run_synchronizations` WHERE `connector_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `execution_scope_id` IS NULL);
--> statement-breakpoint
DELETE FROM `retry_work` WHERE `acquisition_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `execution_scope_id` IS NULL)
  OR `skipped_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `execution_scope_id` IS NULL);
--> statement-breakpoint
DELETE FROM `connector_runs` WHERE `execution_scope_id` IS NULL;
--> statement-breakpoint
DROP TRIGGER `trg_sourcing_projection_outcomes_no_delete`;
--> statement-breakpoint
DELETE FROM `sourcing_projection_outcomes` WHERE `canonical_candidate_id` IN (
  SELECT c.`id` FROM `canonical_source_candidates` c JOIN `normalization_runs` n ON n.`id` = c.`run_id`
  JOIN `connector_runs` r ON r.`id` = n.`trigger_connector_run_id` WHERE r.`status` = 'partial_success'
);
--> statement-breakpoint
DELETE FROM `normalization_replay_items` WHERE `normalization_run_id` IN (
  SELECT n.`id` FROM `normalization_runs` n JOIN `connector_runs` r ON r.`id` = n.`trigger_connector_run_id` WHERE r.`status` = 'partial_success'
);
--> statement-breakpoint
DELETE FROM `normalization_gates` WHERE `run_id` IN (
  SELECT n.`id` FROM `normalization_runs` n JOIN `connector_runs` r ON r.`id` = n.`trigger_connector_run_id` WHERE r.`status` = 'partial_success'
);
--> statement-breakpoint
DELETE FROM `canonical_source_candidates` WHERE `run_id` IN (
  SELECT n.`id` FROM `normalization_runs` n JOIN `connector_runs` r ON r.`id` = n.`trigger_connector_run_id` WHERE r.`status` = 'partial_success'
);
--> statement-breakpoint
DELETE FROM `normalization_field_outcomes` WHERE `run_id` IN (
  SELECT n.`id` FROM `normalization_runs` n JOIN `connector_runs` r ON r.`id` = n.`trigger_connector_run_id` WHERE r.`status` = 'partial_success'
);
--> statement-breakpoint
DELETE FROM `normalization_attempts` WHERE `run_id` IN (
  SELECT n.`id` FROM `normalization_runs` n JOIN `connector_runs` r ON r.`id` = n.`trigger_connector_run_id` WHERE r.`status` = 'partial_success'
);
--> statement-breakpoint
DELETE FROM `normalization_runs` WHERE `trigger_connector_run_id` IN (
  SELECT `id` FROM `connector_runs` WHERE `status` = 'partial_success'
);
--> statement-breakpoint
CREATE TRIGGER `trg_sourcing_projection_outcomes_no_delete`
BEFORE DELETE ON `sourcing_projection_outcomes`
BEGIN SELECT RAISE(ABORT, 'projection outcomes are append-only'); END;
--> statement-breakpoint
UPDATE `raw_source_occurrences` SET `connector_instance_id` = NULL, `connector_run_id` = NULL
WHERE `connector_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `status` = 'partial_success');
--> statement-breakpoint
DELETE FROM `connector_observations` WHERE `connector_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `status` = 'partial_success');
--> statement-breakpoint
DELETE FROM `connector_schedule_occurrences` WHERE `connector_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `status` = 'partial_success');
--> statement-breakpoint
DELETE FROM `connector_run_synchronizations` WHERE `connector_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `status` = 'partial_success');
--> statement-breakpoint
DELETE FROM `retry_work` WHERE `acquisition_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `status` = 'partial_success')
  OR `skipped_run_id` IN (SELECT `id` FROM `connector_runs` WHERE `status` = 'partial_success');
--> statement-breakpoint
DELETE FROM `connector_runs` WHERE `status` = 'partial_success';
--> statement-breakpoint
ALTER TABLE `raw_source_occurrences` ADD `execution_scope_id` text REFERENCES `source_execution_scopes`(`id`);
--> statement-breakpoint
UPDATE `raw_source_occurrences` SET `execution_scope_id` = (
  SELECT `execution_scope_id` FROM `connector_instances` WHERE `connector_instances`.`id` = `raw_source_occurrences`.`connector_instance_id`
) WHERE `connector_instance_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `retry_work` ADD `execution_scope_id` text REFERENCES `source_execution_scopes`(`id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `source_execution_scopes` (`id`,`created_at`,`updated_at`)
SELECT 'scope_' || lower(hex(coalesce(json_extract(`lineage_json`, '$.connectorInstanceId'), `raw_revision_id`))), `created_at`, `updated_at`
FROM `retry_work` WHERE `kind` = 'normalization';
--> statement-breakpoint
UPDATE `retry_work` SET `execution_scope_id` = CASE
  WHEN `connector_instance_id` IS NOT NULL THEN (SELECT `execution_scope_id` FROM `connector_instances` WHERE `connector_instances`.`id` = `retry_work`.`connector_instance_id`)
  ELSE coalesce(
    (SELECT `execution_scope_id` FROM `connector_instances` WHERE `connector_instances`.`id` = json_extract(`retry_work`.`lineage_json`, '$.connectorInstanceId')),
    'scope_' || lower(hex(`raw_revision_id`))
  )
END;
--> statement-breakpoint
DELETE FROM `retry_work` WHERE `execution_scope_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_raw_source_revisions_provider_current` ON `raw_source_revisions` (`provider_record_id`,`id`,`raw_record_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `idx_retry_work_capture_pending` ON `retry_work` (`kind`,`connector_instance_id`,`filter_signature`,`state`,`next_attempt_at`,`updated_at`) WHERE `deleted_at` is null;
--> statement-breakpoint
CREATE INDEX `idx_retry_work_normalization_pending` ON `retry_work` (`kind`,`execution_scope_id`,`state`,`next_attempt_at`,`created_at`,`raw_revision_id`) WHERE `deleted_at` is null;
--> statement-breakpoint
CREATE TRIGGER `connector_instances_scope_required_insert` BEFORE INSERT ON `connector_instances`
WHEN NEW.`execution_scope_id` IS NULL OR NOT EXISTS (SELECT 1 FROM `source_execution_scopes` WHERE `id` = NEW.`execution_scope_id`)
BEGIN SELECT RAISE(ABORT, 'connector execution scope required'); END;
--> statement-breakpoint
CREATE TRIGGER `connector_instances_scope_required_update` BEFORE UPDATE OF `execution_scope_id` ON `connector_instances`
WHEN NEW.`execution_scope_id` IS NULL OR NOT EXISTS (SELECT 1 FROM `source_execution_scopes` WHERE `id` = NEW.`execution_scope_id`)
BEGIN SELECT RAISE(ABORT, 'connector execution scope required'); END;
--> statement-breakpoint
CREATE TRIGGER `connector_instances_scope_immutable` BEFORE UPDATE OF `execution_scope_id` ON `connector_instances`
WHEN NEW.`execution_scope_id` != OLD.`execution_scope_id`
BEGIN SELECT RAISE(ABORT, 'connector instance scope identity immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `connector_runs_scope_required_insert` BEFORE INSERT ON `connector_runs`
WHEN NEW.`execution_scope_id` IS NULL OR NOT EXISTS (SELECT 1 FROM `source_execution_scopes` WHERE `id` = NEW.`execution_scope_id`)
BEGIN SELECT RAISE(ABORT, 'connector run execution scope required'); END;
--> statement-breakpoint
CREATE TRIGGER `connector_runs_scope_required_update` BEFORE UPDATE OF `execution_scope_id` ON `connector_runs`
WHEN NEW.`execution_scope_id` IS NULL OR NOT EXISTS (SELECT 1 FROM `source_execution_scopes` WHERE `id` = NEW.`execution_scope_id`)
BEGIN SELECT RAISE(ABORT, 'connector run execution scope required'); END;
--> statement-breakpoint
CREATE TRIGGER `retry_work_scope_required_insert` BEFORE INSERT ON `retry_work`
WHEN NEW.`execution_scope_id` IS NULL OR NOT EXISTS (SELECT 1 FROM `source_execution_scopes` WHERE `id` = NEW.`execution_scope_id`)
BEGIN SELECT RAISE(ABORT, 'retry execution scope required'); END;
--> statement-breakpoint
CREATE TRIGGER `retry_work_scope_required_update` BEFORE UPDATE OF `execution_scope_id` ON `retry_work`
WHEN NEW.`execution_scope_id` IS NULL OR NOT EXISTS (SELECT 1 FROM `source_execution_scopes` WHERE `id` = NEW.`execution_scope_id`)
BEGIN SELECT RAISE(ABORT, 'retry execution scope required'); END;
--> statement-breakpoint
CREATE TRIGGER `connector_runs_scope_owner_insert` BEFORE INSERT ON `connector_runs`
WHEN NOT EXISTS (SELECT 1 FROM `connector_instances` WHERE `id` = NEW.`connector_instance_id` AND `execution_scope_id` = NEW.`execution_scope_id`)
BEGIN SELECT RAISE(ABORT, 'connector run scope owner mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `connector_runs_scope_owner_update` BEFORE UPDATE OF `execution_scope_id`,`connector_instance_id` ON `connector_runs`
WHEN NOT EXISTS (SELECT 1 FROM `connector_instances` WHERE `id` = NEW.`connector_instance_id` AND `execution_scope_id` = NEW.`execution_scope_id`)
BEGIN SELECT RAISE(ABORT, 'connector run scope owner mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `raw_source_occurrences_scope_owner_insert` BEFORE INSERT ON `raw_source_occurrences`
WHEN (NEW.`connector_instance_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_instances` WHERE `id` = NEW.`connector_instance_id` AND `execution_scope_id` = NEW.`execution_scope_id`))
 OR (NEW.`connector_run_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_runs` WHERE `id` = NEW.`connector_run_id` AND `execution_scope_id` = NEW.`execution_scope_id` AND `connector_instance_id` = NEW.`connector_instance_id`))
BEGIN SELECT RAISE(ABORT, 'raw source occurrence scope owner mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `raw_source_occurrences_scope_owner_update` BEFORE UPDATE OF `execution_scope_id`,`connector_instance_id`,`connector_run_id` ON `raw_source_occurrences`
WHEN (NEW.`connector_instance_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_instances` WHERE `id` = NEW.`connector_instance_id` AND `execution_scope_id` = NEW.`execution_scope_id`))
 OR (NEW.`connector_run_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_runs` WHERE `id` = NEW.`connector_run_id` AND `execution_scope_id` = NEW.`execution_scope_id` AND `connector_instance_id` = NEW.`connector_instance_id`))
BEGIN SELECT RAISE(ABORT, 'raw source occurrence scope owner mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `retry_work_scope_owner_insert` BEFORE INSERT ON `retry_work`
WHEN (NEW.`kind` = 'connector_capture' AND NOT EXISTS (SELECT 1 FROM `connector_instances` WHERE `id` = NEW.`connector_instance_id` AND `execution_scope_id` = NEW.`execution_scope_id`))
 OR (NEW.`kind` = 'normalization' AND json_extract(NEW.`lineage_json`, '$.connectorInstanceId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_instances` WHERE `id` = json_extract(NEW.`lineage_json`, '$.connectorInstanceId') AND `execution_scope_id` = NEW.`execution_scope_id`))
 OR (NEW.`kind` = 'normalization' AND json_extract(NEW.`lineage_json`, '$.connectorRunId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_runs` WHERE `id` = json_extract(NEW.`lineage_json`, '$.connectorRunId') AND `execution_scope_id` = NEW.`execution_scope_id` AND `connector_instance_id` = json_extract(NEW.`lineage_json`, '$.connectorInstanceId')))
 OR (NEW.`acquisition_run_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_runs` WHERE `id` = NEW.`acquisition_run_id` AND `execution_scope_id` = NEW.`execution_scope_id`))
 OR (NEW.`skipped_run_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_runs` WHERE `id` = NEW.`skipped_run_id` AND `execution_scope_id` = NEW.`execution_scope_id`))
BEGIN SELECT RAISE(ABORT, 'retry work scope owner mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `retry_work_scope_owner_update` BEFORE UPDATE OF `execution_scope_id`,`connector_instance_id`,`lineage_json`,`acquisition_run_id`,`skipped_run_id` ON `retry_work`
WHEN (NEW.`kind` = 'connector_capture' AND NOT EXISTS (SELECT 1 FROM `connector_instances` WHERE `id` = NEW.`connector_instance_id` AND `execution_scope_id` = NEW.`execution_scope_id`))
 OR (NEW.`kind` = 'normalization' AND json_extract(NEW.`lineage_json`, '$.connectorInstanceId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_instances` WHERE `id` = json_extract(NEW.`lineage_json`, '$.connectorInstanceId') AND `execution_scope_id` = NEW.`execution_scope_id`))
 OR (NEW.`kind` = 'normalization' AND json_extract(NEW.`lineage_json`, '$.connectorRunId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_runs` WHERE `id` = json_extract(NEW.`lineage_json`, '$.connectorRunId') AND `execution_scope_id` = NEW.`execution_scope_id` AND `connector_instance_id` = json_extract(NEW.`lineage_json`, '$.connectorInstanceId')))
 OR (NEW.`acquisition_run_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_runs` WHERE `id` = NEW.`acquisition_run_id` AND `execution_scope_id` = NEW.`execution_scope_id`))
 OR (NEW.`skipped_run_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `connector_runs` WHERE `id` = NEW.`skipped_run_id` AND `execution_scope_id` = NEW.`execution_scope_id`))
BEGIN SELECT RAISE(ABORT, 'retry work scope owner mismatch'); END;
