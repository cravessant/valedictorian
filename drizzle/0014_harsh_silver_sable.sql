ALTER TABLE "capture_destination_resolution_work" ADD COLUMN "retry_delay_1_ms" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD COLUMN "retry_delay_2_ms" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD COLUMN "retry_delay_3_ms" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD COLUMN "retry_delay_4_ms" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD COLUMN "retry_delay_5_ms" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD COLUMN "retry_delay_6_ms" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_resolution_command_receipts" ADD COLUMN "request_snapshot_json" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD CONSTRAINT "chk_capture_destination_resolution_work_retry_policy" CHECK ("capture_destination_resolution_work"."max_attempts" between 1 and 7
        and "capture_destination_resolution_work"."retry_delay_1_ms" between 1 and 86400000
        and "capture_destination_resolution_work"."retry_delay_2_ms" between 1 and 86400000
        and "capture_destination_resolution_work"."retry_delay_3_ms" between 1 and 86400000
        and "capture_destination_resolution_work"."retry_delay_4_ms" between 1 and 86400000
        and "capture_destination_resolution_work"."retry_delay_5_ms" between 1 and 86400000
        and "capture_destination_resolution_work"."retry_delay_6_ms" between 1 and 86400000);--> statement-breakpoint
ALTER TABLE "capture_resolution_command_receipts" ADD CONSTRAINT "chk_capture_resolution_command_receipts_request_snapshot" CHECK (length("capture_resolution_command_receipts"."request_snapshot_json") between 2 and 4096
        and "capture_resolution_command_receipts"."request_snapshot_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:');