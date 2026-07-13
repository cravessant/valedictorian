CREATE TEMP TABLE `_doomed_raw_records` AS
SELECT record.`id`, record.`source_entity_id`
FROM `raw_source_records` record
JOIN `raw_source_revisions` latest ON latest.`raw_record_id` = record.`id`
WHERE latest.`revision` = (
  SELECT MAX(candidate.`revision`)
  FROM `raw_source_revisions` candidate
  WHERE candidate.`raw_record_id` = record.`id`
)
AND EXISTS (
  SELECT 1
  FROM `raw_source_occurrences` occurrence
  WHERE occurrence.`raw_record_id` = record.`id`
    AND (
      (
        latest.`adapter_kind` = 'connector'
        AND (
          occurrence.`connector_instance_id` IS NULL
          OR occurrence.`connector_run_id` IS NULL
          OR occurrence.`execution_scope_id` IS NULL
        )
      )
      OR (
        latest.`adapter_kind` <> 'connector'
        AND (
          occurrence.`connector_instance_id` IS NOT NULL
          OR occurrence.`connector_run_id` IS NOT NULL
          OR occurrence.`execution_scope_id` IS NOT NULL
        )
      )
    )
);
--> statement-breakpoint
CREATE TEMP TABLE `_doomed_raw_revisions` AS
SELECT revision.`id`
FROM `raw_source_revisions` revision
WHERE revision.`raw_record_id` IN (SELECT `id` FROM `_doomed_raw_records`);
--> statement-breakpoint
CREATE TEMP TABLE `_doomed_normalization_runs` AS
SELECT run.`id`
FROM `normalization_runs` run
WHERE run.`raw_record_id` IN (SELECT `id` FROM `_doomed_raw_records`)
   OR run.`raw_revision_id` IN (SELECT `id` FROM `_doomed_raw_revisions`);
--> statement-breakpoint
CREATE TEMP TABLE `_doomed_candidates` AS
SELECT candidate.`id`
FROM `canonical_source_candidates` candidate
WHERE candidate.`raw_record_id` IN (SELECT `id` FROM `_doomed_raw_records`)
   OR candidate.`raw_revision_id` IN (SELECT `id` FROM `_doomed_raw_revisions`)
   OR candidate.`run_id` IN (SELECT `id` FROM `_doomed_normalization_runs`);
--> statement-breakpoint
DROP TRIGGER `trg_source_entity_identities_no_delete`;
--> statement-breakpoint
DROP TRIGGER `trg_source_identity_conflicts_no_delete`;
--> statement-breakpoint
DROP TRIGGER `trg_sourcing_projection_outcomes_no_delete`;
--> statement-breakpoint
DELETE FROM `sourcing_projection_outcomes`
WHERE `raw_record_id` IN (SELECT `id` FROM `_doomed_raw_records`)
   OR `raw_revision_id` IN (SELECT `id` FROM `_doomed_raw_revisions`)
   OR `canonical_candidate_id` IN (SELECT `id` FROM `_doomed_candidates`);
--> statement-breakpoint
DELETE FROM `sourcing_findings`
WHERE `canonical_candidate_id` IN (SELECT `id` FROM `_doomed_candidates`)
   OR `raw_revision_id` IN (SELECT `id` FROM `_doomed_raw_revisions`);
--> statement-breakpoint
DELETE FROM `normalization_replay_items`
WHERE `raw_record_id` IN (SELECT `id` FROM `_doomed_raw_records`)
   OR `raw_revision_id` IN (SELECT `id` FROM `_doomed_raw_revisions`)
   OR `normalization_run_id` IN (SELECT `id` FROM `_doomed_normalization_runs`);
--> statement-breakpoint
DELETE FROM `normalization_gates`
WHERE `run_id` IN (SELECT `id` FROM `_doomed_normalization_runs`)
   OR `candidate_id` IN (SELECT `id` FROM `_doomed_candidates`);
--> statement-breakpoint
DELETE FROM `canonical_source_candidates`
WHERE `id` IN (SELECT `id` FROM `_doomed_candidates`);
--> statement-breakpoint
DELETE FROM `normalization_field_outcomes`
WHERE `run_id` IN (SELECT `id` FROM `_doomed_normalization_runs`);
--> statement-breakpoint
DELETE FROM `normalization_attempts`
WHERE `run_id` IN (SELECT `id` FROM `_doomed_normalization_runs`)
   OR `raw_revision_id` IN (SELECT `id` FROM `_doomed_raw_revisions`);
--> statement-breakpoint
DELETE FROM `normalization_runs`
WHERE `id` IN (SELECT `id` FROM `_doomed_normalization_runs`);
--> statement-breakpoint
DELETE FROM `retry_work`
WHERE `raw_revision_id` IN (SELECT `id` FROM `_doomed_raw_revisions`);
--> statement-breakpoint
DELETE FROM `source_identity_conflicts`
WHERE `raw_revision_id` IN (SELECT `id` FROM `_doomed_raw_revisions`);
--> statement-breakpoint
DELETE FROM `source_entity_identities`
WHERE `raw_revision_id` IN (SELECT `id` FROM `_doomed_raw_revisions`);
--> statement-breakpoint
DELETE FROM `raw_source_occurrences`
WHERE `raw_record_id` IN (SELECT `id` FROM `_doomed_raw_records`)
   OR `raw_revision_id` IN (SELECT `id` FROM `_doomed_raw_revisions`);
--> statement-breakpoint
DELETE FROM `raw_source_revisions`
WHERE `id` IN (SELECT `id` FROM `_doomed_raw_revisions`);
--> statement-breakpoint
DELETE FROM `raw_source_records`
WHERE `id` IN (SELECT `id` FROM `_doomed_raw_records`);
--> statement-breakpoint
DELETE FROM `source_entities`
WHERE `id` IN (
  SELECT `source_entity_id` FROM `_doomed_raw_records`
  WHERE `source_entity_id` IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM `raw_source_records` record
  WHERE record.`source_entity_id` = `source_entities`.`id`
)
AND NOT EXISTS (
  SELECT 1 FROM `source_entity_identities` identity
  WHERE identity.`source_entity_id` = `source_entities`.`id`
)
AND NOT EXISTS (
  SELECT 1 FROM `source_identity_conflicts` conflict
  WHERE conflict.`source_entity_id` = `source_entities`.`id`
     OR conflict.`conflicting_source_entity_id` = `source_entities`.`id`
)
AND NOT EXISTS (
  SELECT 1 FROM `canonical_source_candidates` candidate
  WHERE candidate.`source_entity_id` = `source_entities`.`id`
)
AND NOT EXISTS (
  SELECT 1 FROM `sourcing_findings` finding
  WHERE finding.`source_entity_id` = `source_entities`.`id`
);
--> statement-breakpoint
CREATE TRIGGER `trg_source_entity_identities_no_delete`
BEFORE DELETE ON `source_entity_identities`
BEGIN
  SELECT RAISE(ABORT, 'source entity identities are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_source_identity_conflicts_no_delete`
BEFORE DELETE ON `source_identity_conflicts`
BEGIN
  SELECT RAISE(ABORT, 'source identity conflicts are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_sourcing_projection_outcomes_no_delete`
BEFORE DELETE ON `sourcing_projection_outcomes`
BEGIN SELECT RAISE(ABORT, 'projection outcomes are append-only'); END;
--> statement-breakpoint
DROP TABLE `_doomed_candidates`;
--> statement-breakpoint
DROP TABLE `_doomed_normalization_runs`;
--> statement-breakpoint
DROP TABLE `_doomed_raw_revisions`;
--> statement-breakpoint
DROP TABLE `_doomed_raw_records`;
