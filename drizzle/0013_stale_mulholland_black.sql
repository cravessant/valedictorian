CREATE TABLE `source_entity_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`source_entity_id` text NOT NULL,
	`identity_kind` text NOT NULL,
	`identity_namespace` text NOT NULL,
	`identity_value` text NOT NULL,
	`provenance_kind` text NOT NULL,
	`provenance_version` text NOT NULL,
	`evidence_json` text NOT NULL,
	`raw_revision_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_entity_id`) REFERENCES `source_entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`) REFERENCES `raw_source_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_source_entity_identities_kind" CHECK("source_entity_identities"."identity_kind" in ('provider_job','canonical_destination','intermediary_alias','destination_alias')),
	CONSTRAINT "chk_source_entity_identities_namespace_length" CHECK(length("source_entity_identities"."identity_namespace") between 1 and 512),
	CONSTRAINT "chk_source_entity_identities_value_length" CHECK(length("source_entity_identities"."identity_value") between 1 and 2048),
	CONSTRAINT "chk_source_entity_identities_provenance_kind" CHECK("source_entity_identities"."provenance_kind" in ('primary_backfill','capture','normalization')),
	CONSTRAINT "chk_source_entity_identities_provenance_version_length" CHECK(length("source_entity_identities"."provenance_version") between 1 and 128),
	CONSTRAINT "chk_source_entity_identities_evidence_length" CHECK(length("source_entity_identities"."evidence_json") between 2 and 16384)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_entity_identities_identity` ON `source_entity_identities` (`identity_kind`,`identity_namespace`,`identity_value`);--> statement-breakpoint
CREATE INDEX `idx_source_entity_identities_entity_chronology` ON `source_entity_identities` (`source_entity_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `source_identity_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_entity_id` text NOT NULL,
	`conflicting_source_entity_id` text,
	`raw_revision_id` text NOT NULL,
	`identity_kind` text NOT NULL,
	`identity_namespace` text NOT NULL,
	`identity_value` text NOT NULL,
	`reason` text NOT NULL,
	`provenance_version` text NOT NULL,
	`evidence_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_entity_id`) REFERENCES `source_entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conflicting_source_entity_id`) REFERENCES `source_entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`) REFERENCES `raw_source_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_source_identity_conflicts_kind" CHECK("source_identity_conflicts"."identity_kind" in ('provider_job','canonical_destination','intermediary_alias','destination_alias')),
	CONSTRAINT "chk_source_identity_conflicts_namespace_length" CHECK(length("source_identity_conflicts"."identity_namespace") between 1 and 512),
	CONSTRAINT "chk_source_identity_conflicts_value_length" CHECK(length("source_identity_conflicts"."identity_value") between 1 and 2048),
	CONSTRAINT "chk_source_identity_conflicts_reason_length" CHECK(length("source_identity_conflicts"."reason") between 1 and 512),
	CONSTRAINT "chk_source_identity_conflicts_provenance_version_length" CHECK(length("source_identity_conflicts"."provenance_version") between 1 and 128),
	CONSTRAINT "chk_source_identity_conflicts_evidence_length" CHECK(length("source_identity_conflicts"."evidence_json") between 2 and 16384)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_identity_conflicts_occurrence` ON `source_identity_conflicts` (`source_entity_id`,`raw_revision_id`,`identity_kind`,`identity_namespace`,`identity_value`,`reason`);--> statement-breakpoint
CREATE INDEX `idx_source_identity_conflicts_chronology` ON `source_identity_conflicts` (`created_at`,`id`);