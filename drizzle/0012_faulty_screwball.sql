CREATE TABLE "capture_effective_revision_inputs" (
	"workspace_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"capture_revision" integer NOT NULL,
	"effective_input_json" text NOT NULL,
	"evidence_origins_json" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"materialized_at" text NOT NULL,
	"finalized_at" text,
	CONSTRAINT "capture_effective_revision_inputs_pk" PRIMARY KEY("capture_id","capture_revision"),
	CONSTRAINT "chk_capture_effective_revision_inputs_revision" CHECK ("capture_effective_revision_inputs"."capture_revision" > 0),
	CONSTRAINT "chk_capture_effective_revision_inputs_bound" CHECK (length("capture_effective_revision_inputs"."effective_input_json") between 2 and 262144),
	CONSTRAINT "chk_capture_effective_revision_inputs_evidence_origins_bound" CHECK (length("capture_effective_revision_inputs"."evidence_origins_json") between 2 and 8192),
	CONSTRAINT "chk_capture_effective_revision_inputs_fingerprint" CHECK (length("capture_effective_revision_inputs"."input_fingerprint") = 64)
);
--> statement-breakpoint
CREATE TABLE "capture_materialization_issues" (
	"workspace_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"capture_revision" integer NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"details_json" text NOT NULL,
	"created_at" text NOT NULL,
	"resolved_at" text,
	CONSTRAINT "capture_materialization_issues_pk" PRIMARY KEY("capture_id","capture_revision"),
	CONSTRAINT "chk_capture_materialization_issues_revision" CHECK ("capture_materialization_issues"."capture_revision" > 0),
	CONSTRAINT "chk_capture_materialization_issues_code" CHECK ("capture_materialization_issues"."code" = 'revision_materialization_failed'),
	CONSTRAINT "chk_capture_materialization_issues_message" CHECK (length(btrim("capture_materialization_issues"."message")) between 1 and 500),
	CONSTRAINT "chk_capture_materialization_issues_details" CHECK (length("capture_materialization_issues"."details_json") between 2 and 4096)
);
--> statement-breakpoint
CREATE TABLE "capture_materialization_state" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"completed" integer NOT NULL,
	"total" integer NOT NULL,
	"issue_count" integer NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capture_materialization_state_status" CHECK ("capture_materialization_state"."status" in ('migrating','ready','blocked')),
	CONSTRAINT "chk_capture_materialization_state_counts" CHECK ("capture_materialization_state"."completed" >= 0 and "capture_materialization_state"."total" >= 0
        and "capture_materialization_state"."completed" <= "capture_materialization_state"."total" and "capture_materialization_state"."issue_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "capture_resolution_command_receipts" (
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"result_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "capture_resolution_command_receipts_pk" PRIMARY KEY("workspace_id","idempotency_key"),
	CONSTRAINT "chk_capture_resolution_command_receipts_operation" CHECK ("capture_resolution_command_receipts"."operation" in ('retry','replay','correct','complete')),
	CONSTRAINT "chk_capture_resolution_command_receipts_key" CHECK (length("capture_resolution_command_receipts"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_capture_resolution_command_receipts_fingerprint" CHECK (length("capture_resolution_command_receipts"."request_fingerprint") = 64),
	CONSTRAINT "chk_capture_resolution_command_receipts_result" CHECK (length("capture_resolution_command_receipts"."result_json") between 2 and 16384)
);
--> statement-breakpoint
CREATE TABLE "capture_resolution_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"capture_revision" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"processing_summary" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"retry_policy_id" text NOT NULL,
	"retry_policy_snapshot_json" text NOT NULL,
	"resolver_selection_snapshot_json" text NOT NULL,
	"created_by_actor_json" text NOT NULL,
	"linked_job_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capture_resolution_generations_revision" CHECK ("capture_resolution_generations"."capture_revision" > 0 and "capture_resolution_generations"."ordinal" > 0),
	CONSTRAINT "chk_capture_resolution_generations_trigger" CHECK ("capture_resolution_generations"."trigger" in (
        'intake','correction','restore','retry_destination','replay',
        'manual_completion','legacy_promotion'
      )),
	CONSTRAINT "chk_capture_resolution_generations_status" CHECK ("capture_resolution_generations"."status" in ('active','promoted','superseded','cancelled')),
	CONSTRAINT "chk_capture_resolution_generations_summary" CHECK ("capture_resolution_generations"."processing_summary" in (
        'promoted','blocked','needs_action','retrying','processing',
        'awaiting_destination','awaiting_information','stopped'
      )),
	CONSTRAINT "chk_capture_resolution_generations_fingerprint" CHECK (length("capture_resolution_generations"."input_fingerprint") = 64),
	CONSTRAINT "chk_capture_resolution_generations_policy" CHECK (length("capture_resolution_generations"."retry_policy_id") between 1 and 100
        and length("capture_resolution_generations"."retry_policy_snapshot_json") between 2 and 4096
        and length("capture_resolution_generations"."resolver_selection_snapshot_json") between 2 and 4096),
	CONSTRAINT "chk_capture_resolution_generations_actor" CHECK (length("capture_resolution_generations"."created_by_actor_json") between 2 and 2048)
);
--> statement-breakpoint
CREATE TABLE "capture_resolution_stage_results" (
	"generation_id" text NOT NULL,
	"stage" text NOT NULL,
	"capture_revision" integer NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer NOT NULL,
	"issue_json" text,
	"result_json" text NOT NULL,
	"next_attempt_at" text,
	"resolver_id" text,
	"resolver_version" text,
	"remote_operation_id" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "capture_resolution_stage_results_pk" PRIMARY KEY("generation_id","stage"),
	CONSTRAINT "chk_capture_resolution_stage_results_stage" CHECK ("capture_resolution_stage_results"."stage" in ('destination','information','promotion')),
	CONSTRAINT "chk_capture_resolution_stage_results_revision" CHECK ("capture_resolution_stage_results"."capture_revision" > 0 and "capture_resolution_stage_results"."attempt_count" >= 0),
	CONSTRAINT "chk_capture_resolution_stage_results_status" CHECK ("capture_resolution_stage_results"."status" in (
        'not_required','queued','running','retry_wait','resolved',
        'action_required','exhausted','blocked','awaiting_manual',
        'not_ready','promoted','superseded','cancelled'
      )),
	CONSTRAINT "chk_capture_resolution_stage_results_issue" CHECK ("capture_resolution_stage_results"."issue_json" is null or length("capture_resolution_stage_results"."issue_json") between 2 and 4096),
	CONSTRAINT "chk_capture_resolution_stage_results_result" CHECK (length("capture_resolution_stage_results"."result_json") between 2 and 16384),
	CONSTRAINT "chk_capture_resolution_stage_results_resolver" CHECK ("capture_resolution_stage_results"."resolver_id" is null or length("capture_resolution_stage_results"."resolver_id") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "capture_effective_revision_inputs" ADD CONSTRAINT "capture_effective_revision_inputs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_effective_revision_inputs" ADD CONSTRAINT "fk_capture_effective_revision_inputs_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_materialization_issues" ADD CONSTRAINT "capture_materialization_issues_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_materialization_issues" ADD CONSTRAINT "fk_capture_materialization_issues_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_materialization_state" ADD CONSTRAINT "capture_materialization_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_resolution_command_receipts" ADD CONSTRAINT "capture_resolution_command_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_resolution_generations" ADD CONSTRAINT "capture_resolution_generations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_resolution_generations" ADD CONSTRAINT "fk_capture_resolution_generations_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_resolution_stage_results" ADD CONSTRAINT "fk_capture_resolution_stage_results_generation" FOREIGN KEY ("generation_id") REFERENCES "public"."capture_resolution_generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_capture_effective_revision_inputs_workspace" ON "capture_effective_revision_inputs" USING btree ("workspace_id","capture_id","capture_revision");--> statement-breakpoint
CREATE INDEX "idx_capture_materialization_issues_unresolved" ON "capture_materialization_issues" USING btree ("workspace_id","capture_id","capture_revision") WHERE "capture_materialization_issues"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_resolution_generations_ordinal" ON "capture_resolution_generations" USING btree ("capture_id","ordinal");--> statement-breakpoint
CREATE INDEX "idx_capture_resolution_generations_revision" ON "capture_resolution_generations" USING btree ("capture_id","capture_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_resolution_generations_active" ON "capture_resolution_generations" USING btree ("capture_id") WHERE "capture_resolution_generations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_capture_resolution_generations_workspace" ON "capture_resolution_generations" USING btree ("workspace_id","processing_summary","updated_at","id");