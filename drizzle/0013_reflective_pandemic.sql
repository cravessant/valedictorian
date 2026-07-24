CREATE TABLE "capture_destination_resolution_work" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempt" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"status" text NOT NULL,
	"next_eligible_at" text,
	"failure_reason" text,
	"failure_detail" text,
	"owner_version" text NOT NULL,
	"acquisition_token" text,
	"claimed_at" text,
	"claim_expires_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"capture_id" text NOT NULL,
	"capture_revision" integer NOT NULL,
	"generation_id" text NOT NULL,
	"resolver_id" text NOT NULL,
	"resolver_version" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	CONSTRAINT "chk_capture_destination_resolution_work_revision" CHECK ("capture_destination_resolution_work"."capture_revision" > 0),
	CONSTRAINT "chk_capture_destination_resolution_work_resolver" CHECK (length("capture_destination_resolution_work"."resolver_id") between 1 and 256
        and length("capture_destination_resolution_work"."resolver_version") between 1 and 128
        and length("capture_destination_resolution_work"."input_fingerprint") = 64),
	CONSTRAINT "chk_capture_destination_resolution_work_workspace" CHECK (length("capture_destination_resolution_work"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_capture_destination_resolution_work_idempotency" CHECK (length("capture_destination_resolution_work"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_capture_destination_resolution_work_budget" CHECK ("capture_destination_resolution_work"."attempt" >= 1 and "capture_destination_resolution_work"."max_attempts" >= "capture_destination_resolution_work"."attempt"),
	CONSTRAINT "chk_capture_destination_resolution_work_status" CHECK ("capture_destination_resolution_work"."status" in ('scheduled','claimed','completed','exhausted','cancelled','terminal')),
	CONSTRAINT "chk_capture_destination_resolution_work_reason" CHECK (("capture_destination_resolution_work"."status" = 'terminal' and "capture_destination_resolution_work"."failure_reason" in ('invalid_target','unresolvable','unsupported_provider','security_rejected')) or ("capture_destination_resolution_work"."status" <> 'terminal' and ("capture_destination_resolution_work"."failure_reason" is null or "capture_destination_resolution_work"."failure_reason" in ('rate_limit','server_failure','network_interruption','operation_timeout')))),
	CONSTRAINT "chk_capture_destination_resolution_work_detail" CHECK ("capture_destination_resolution_work"."failure_detail" is null or (length("capture_destination_resolution_work"."failure_detail") between 1 and 2000 and "capture_destination_resolution_work"."failure_detail" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')),
	CONSTRAINT "chk_capture_destination_resolution_work_timing" CHECK (("capture_destination_resolution_work"."status" in ('scheduled','claimed') and "capture_destination_resolution_work"."next_eligible_at" is not null) or ("capture_destination_resolution_work"."status" in ('completed','exhausted','cancelled','terminal') and "capture_destination_resolution_work"."next_eligible_at" is null)),
	CONSTRAINT "chk_capture_destination_resolution_work_claim_pair" CHECK (("capture_destination_resolution_work"."acquisition_token" is null and "capture_destination_resolution_work"."claimed_at" is null) or ("capture_destination_resolution_work"."acquisition_token" is not null and "capture_destination_resolution_work"."claimed_at" is not null)),
	CONSTRAINT "chk_capture_destination_resolution_work_scheduled_unclaimed" CHECK ("capture_destination_resolution_work"."status" <> 'scheduled' or "capture_destination_resolution_work"."acquisition_token" is null)
);
--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD CONSTRAINT "capture_destination_resolution_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD CONSTRAINT "fk_capture_destination_resolution_work_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD CONSTRAINT "fk_capture_destination_resolution_work_generation" FOREIGN KEY ("generation_id") REFERENCES "public"."capture_resolution_generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_destination_resolution_work_idempotency" ON "capture_destination_resolution_work" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_capture_destination_resolution_work_due" ON "capture_destination_resolution_work" USING btree ("status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "idx_capture_destination_resolution_work_generation" ON "capture_destination_resolution_work" USING btree ("generation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_destination_resolution_work_active_generation" ON "capture_destination_resolution_work" USING btree ("generation_id") WHERE "capture_destination_resolution_work"."status" in ('scheduled','claimed');