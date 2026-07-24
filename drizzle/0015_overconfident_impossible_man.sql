ALTER TABLE "capture_resolution_command_receipts" DROP CONSTRAINT "capture_resolution_command_receipts_pk";
--> statement-breakpoint
ALTER TABLE "capture_resolution_command_receipts" ADD CONSTRAINT "capture_resolution_command_receipts_pk" PRIMARY KEY("workspace_id","operation","idempotency_key");