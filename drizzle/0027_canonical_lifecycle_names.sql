PRAGMA defer_foreign_keys = ON;

-- The lifecycle rename is deliberately implemented with SQLite's native rename
-- operations.  This preserves row ids, values, and foreign-key relationships;
-- sqlite.ts then recreates the affected index/trigger objects under canonical
-- names without touching their predicates or bodies.
ALTER TABLE `source_entities` RENAME TO `jobs`;
ALTER TABLE `source_entity_identities` RENAME TO `job_identities`;
ALTER TABLE `source_identity_conflicts` RENAME TO `job_identity_conflicts`;
ALTER TABLE `raw_source_records` RENAME TO `capture_lineages`;
ALTER TABLE `raw_source_revisions` RENAME TO `capture_evidence_versions`;
ALTER TABLE `raw_source_occurrences` RENAME TO `captures`;
ALTER TABLE `canonical_source_candidates` RENAME TO `job_fact_versions`;
ALTER TABLE `sourcing_findings` RENAME TO `opportunities`;
--> statement-breakpoint
ALTER TABLE `job_identities` RENAME COLUMN `source_entity_id` TO `job_id`;
ALTER TABLE `job_identities` RENAME COLUMN `raw_revision_id` TO `capture_evidence_version_id`;
ALTER TABLE `job_identity_conflicts` RENAME COLUMN `source_entity_id` TO `job_id`;
ALTER TABLE `job_identity_conflicts` RENAME COLUMN `conflicting_source_entity_id` TO `conflicting_job_id`;
ALTER TABLE `job_identity_conflicts` RENAME COLUMN `raw_revision_id` TO `capture_evidence_version_id`;
ALTER TABLE `capture_lineages` RENAME COLUMN `source_entity_id` TO `job_id`;
ALTER TABLE `capture_evidence_versions` RENAME COLUMN `raw_record_id` TO `capture_lineage_id`;
ALTER TABLE `captures` RENAME COLUMN `raw_record_id` TO `capture_lineage_id`;
ALTER TABLE `captures` RENAME COLUMN `raw_revision_id` TO `capture_evidence_version_id`;
ALTER TABLE `normalization_runs` RENAME COLUMN `raw_record_id` TO `capture_lineage_id`;
ALTER TABLE `normalization_runs` RENAME COLUMN `raw_revision_id` TO `capture_evidence_version_id`;
ALTER TABLE `normalization_runs` RENAME COLUMN `trigger_occurrence_id` TO `trigger_capture_id`;
ALTER TABLE `normalization_replay_items` RENAME COLUMN `raw_record_id` TO `capture_lineage_id`;
ALTER TABLE `normalization_replay_items` RENAME COLUMN `raw_revision_id` TO `capture_evidence_version_id`;
ALTER TABLE `normalization_attempts` RENAME COLUMN `raw_revision_id` TO `capture_evidence_version_id`;
ALTER TABLE `job_fact_versions` RENAME COLUMN `source_entity_id` TO `job_id`;
ALTER TABLE `job_fact_versions` RENAME COLUMN `raw_record_id` TO `capture_lineage_id`;
ALTER TABLE `job_fact_versions` RENAME COLUMN `raw_revision_id` TO `capture_evidence_version_id`;
ALTER TABLE `job_fact_versions` RENAME COLUMN `candidate_json` TO `job_fact_version_json`;
ALTER TABLE `normalization_gates` RENAME COLUMN `candidate_id` TO `job_fact_version_id`;
ALTER TABLE `sourcing_projection_outcomes` RENAME COLUMN `raw_record_id` TO `capture_lineage_id`;
ALTER TABLE `sourcing_projection_outcomes` RENAME COLUMN `raw_revision_id` TO `capture_evidence_version_id`;
ALTER TABLE `sourcing_projection_outcomes` RENAME COLUMN `canonical_candidate_id` TO `job_fact_version_id`;
ALTER TABLE `sourcing_projection_outcomes` RENAME COLUMN `finding_id` TO `opportunity_id`;
ALTER TABLE `opportunities` RENAME COLUMN `source_entity_id` TO `job_id`;
ALTER TABLE `opportunities` RENAME COLUMN `canonical_candidate_id` TO `job_fact_version_id`;
ALTER TABLE `opportunities` RENAME COLUMN `raw_revision_id` TO `capture_evidence_version_id`;
ALTER TABLE `opportunities` RENAME COLUMN `merged_application_id` TO `application_id`;
ALTER TABLE `retry_work` RENAME COLUMN `raw_revision_id` TO `capture_evidence_version_id`;
