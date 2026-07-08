PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_connector_checkpoints` (
	`connector_instance_id` text NOT NULL,
	`filter_signature` text DEFAULT 'filters:{}' NOT NULL,
	`checkpoint_json` text NOT NULL,
	`schema_version` text NOT NULL,
	`coverage_started_at` text,
	`coverage_ended_at` text,
	`saved_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	PRIMARY KEY(`connector_instance_id`, `filter_signature`),
	FOREIGN KEY (`connector_instance_id`) REFERENCES `connector_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_connector_checkpoints`("connector_instance_id", "filter_signature", "checkpoint_json", "schema_version", "coverage_started_at", "coverage_ended_at", "saved_at", "created_at", "updated_at", "deleted_at") SELECT "connector_instance_id", 'filters:{}', "checkpoint_json", "schema_version", "coverage_started_at", "coverage_ended_at", "saved_at", "created_at", "updated_at", "deleted_at" FROM `connector_checkpoints`;--> statement-breakpoint
DROP TABLE `connector_checkpoints`;--> statement-breakpoint
ALTER TABLE `__new_connector_checkpoints` RENAME TO `connector_checkpoints`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_connector_checkpoints_instance` ON `connector_checkpoints` (`connector_instance_id`);--> statement-breakpoint
ALTER TABLE `connector_instances` ADD `filters_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `connector_runs` ADD `config_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `connector_runs` ADD `filters_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `connector_runs` ADD `filter_signature` text DEFAULT 'filters:{}' NOT NULL;
