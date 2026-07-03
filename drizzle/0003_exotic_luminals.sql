ALTER TABLE `applications` ADD `timing_mode` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `terms_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `applications` ADD `end_date` text;--> statement-breakpoint
ALTER TABLE `sourcing_findings` ADD `timing_mode` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `sourcing_findings` ADD `terms_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `sourcing_findings` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `sourcing_findings` ADD `end_date` text;