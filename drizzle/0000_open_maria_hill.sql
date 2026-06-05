CREATE TABLE `application_links` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`external_id` text,
	`is_primary` integer NOT NULL,
	`discovered_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `application_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`score` integer NOT NULL,
	`band` text NOT NULL,
	`role_relevance` integer NOT NULL,
	`career_signal` integer NOT NULL,
	`city_work_mode` integer NOT NULL,
	`compensation_logistics` integer NOT NULL,
	`penalties_json` text NOT NULL,
	`rationale` text NOT NULL,
	`rubric_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`source_id` text NOT NULL,
	`role_title` text NOT NULL,
	`role_kind` text NOT NULL,
	`term` text,
	`city` text,
	`region` text,
	`country` text NOT NULL,
	`work_mode` text NOT NULL,
	`location_raw` text,
	`status` text NOT NULL,
	`has_applied` integer NOT NULL,
	`current_priority_score` integer,
	`current_priority_band` text,
	`current_resume_variant` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`website_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`account_hint` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
