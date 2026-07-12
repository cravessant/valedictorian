ALTER TABLE `connector_instances` ADD `earliest_backfill_date` text;--> statement-breakpoint
UPDATE `connector_instances`
SET `earliest_backfill_date` = date(substr(`created_at`, 1, 10), '-7 days')
WHERE `earliest_backfill_date` IS NULL
  AND length(`created_at`) >= 10;--> statement-breakpoint
UPDATE `connector_instances`
SET `connector_version` = '0.8.0'
WHERE `connector_id` = 'jobright.resolver';--> statement-breakpoint
DELETE FROM `retry_work`
WHERE `checkpoint_schema_version` = 'jobright-resolution-checkpoint@4';--> statement-breakpoint
DELETE FROM `connector_checkpoints`
WHERE `schema_version` = 'jobright-resolution-checkpoint@4';
