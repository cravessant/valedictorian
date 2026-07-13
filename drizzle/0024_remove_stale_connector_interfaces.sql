CREATE TRIGGER `connector_runs_status_insert` BEFORE INSERT ON `connector_runs`
WHEN NEW.`status` NOT IN ('queued','running','completed','failed','cancelled','skipped')
BEGIN SELECT RAISE(ABORT, 'invalid connector run status'); END;
--> statement-breakpoint
CREATE TRIGGER `connector_runs_status_update` BEFORE UPDATE OF `status` ON `connector_runs`
WHEN NEW.`status` NOT IN ('queued','running','completed','failed','cancelled','skipped')
BEGIN SELECT RAISE(ABORT, 'invalid connector run status'); END;
--> statement-breakpoint
UPDATE `normalization_runs`
SET `trigger_occurrence_id` = NULL,
  `trigger_connector_instance_id` = NULL,
  `trigger_connector_run_id` = NULL
WHERE `trigger_connector_run_id` IN (
  SELECT `id` FROM `connector_runs` WHERE `status` = 'partial_success'
)
AND EXISTS (
  SELECT 1 FROM `canonical_source_candidates` c
  JOIN `sourcing_findings` f ON f.`canonical_candidate_id` = c.`id`
  WHERE c.`run_id` = `normalization_runs`.`id`
);
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
UPDATE `connector_runs`
SET
  `config_json` = coalesce((
    SELECT json_group_object(`key`, `value`)
    FROM json_each(`connector_runs`.`config_json`)
    WHERE `key` IN ('discoveryCount', 'maxRetryAttemptsPerSource', 'maxRunElapsedMs')
  ), '{}'),
  `filters_json` = '{}',
  `stats_json` = json_remove(
    `stats_json`, '$.maxLinks', '$.maxRequestsPerRun', '$.remainingTarget',
    '$.requestedJobCount', '$.usefulTarget'
  )
WHERE `connector_instance_id` IN (
  SELECT `id` FROM `connector_instances`
  WHERE `connector_id` = 'jobright.resolver'
    AND `connector_version` IN ('0.8.0', '0.9.0', '0.10.0')
);
--> statement-breakpoint
DELETE FROM `retry_work`
WHERE `kind` = 'connector_capture'
  AND `connector_instance_id` IN (
    SELECT `id` FROM `connector_instances`
    WHERE `connector_id` = 'jobright.resolver'
      AND `connector_version` IN ('0.8.0', '0.9.0', '0.10.0')
  );
--> statement-breakpoint
UPDATE `connector_instances`
SET
  `connector_version` = '0.11.0',
  `config_json` = coalesce((
    SELECT json_group_object(`key`, `value`)
    FROM json_each(`connector_instances`.`config_json`)
    WHERE `key` IN ('discoveryCount', 'maxRetryAttemptsPerSource', 'maxRunElapsedMs')
  ), '{}'),
  `filters_json` = '{}',
  `auth_json` = coalesce((
    SELECT json_group_array(json(`value`))
    FROM json_each(`connector_instances`.`auth_json`)
    WHERE json_extract(`value`, '$.mode') != 'browser_session'
  ), '[]')
WHERE `connector_id` = 'jobright.resolver'
  AND `connector_version` IN ('0.8.0', '0.9.0', '0.10.0');
