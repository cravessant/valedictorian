CREATE TABLE `raw_source_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_record_id` text NOT NULL,
	`raw_revision_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`raw_record_id`) REFERENCES `raw_source_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_revision_id`) REFERENCES `raw_source_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_raw_source_occurrences_record_chronology` ON `raw_source_occurrences` (`raw_record_id`,`observed_at`,`received_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_raw_source_occurrences_revision` ON `raw_source_occurrences` (`raw_revision_id`);--> statement-breakpoint
CREATE TABLE `raw_source_records` (
	`id` text PRIMARY KEY NOT NULL,
	`source_entity_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_entity_id`) REFERENCES `source_entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_raw_source_records_source_entity` ON `raw_source_records` (`source_entity_id`);--> statement-breakpoint
CREATE TABLE `raw_source_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_record_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content_hash` text NOT NULL,
	`adapter_id` text NOT NULL,
	`adapter_kind` text NOT NULL,
	`adapter_version` text NOT NULL,
	`reported_origin_kind` text,
	`reported_origin_name` text,
	`reported_origin_provider_id` text,
	`reported_origin_url` text,
	`observed_at` text NOT NULL,
	`provider_record_id` text,
	`provider_schema` text,
	`payload_json` text,
	`evidence_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`raw_record_id`) REFERENCES `raw_source_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_raw_source_revisions_record_revision` ON `raw_source_revisions` (`raw_record_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_raw_source_revisions_record_hash` ON `raw_source_revisions` (`raw_record_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `source_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_kind` text NOT NULL,
	`identity_namespace` text NOT NULL,
	`identity_value` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "chk_source_entities_identity_kind_length" CHECK(length("source_entities"."identity_kind") between 1 and 64),
	CONSTRAINT "chk_source_entities_identity_namespace_length" CHECK(length("source_entities"."identity_namespace") between 1 and 4096),
	CONSTRAINT "chk_source_entities_identity_value_length" CHECK(length("source_entities"."identity_value") between 1 and 2048)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_entities_identity` ON `source_entities` (`identity_kind`,`identity_namespace`,`identity_value`);