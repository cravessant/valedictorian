CREATE TABLE `connector_projection_keys` (
	`dedupe_key` text PRIMARY KEY NOT NULL,
	`sourcing_finding_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`sourcing_finding_id`) REFERENCES `sourcing_findings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_connector_projection_keys_sourcing_finding` ON `connector_projection_keys` (`sourcing_finding_id`);--> statement-breakpoint
ALTER TABLE `connector_observations` ADD `sourcing_finding_id` text REFERENCES sourcing_findings(id);--> statement-breakpoint
CREATE INDEX `idx_connector_observations_sourcing_finding` ON `connector_observations` (`sourcing_finding_id`);