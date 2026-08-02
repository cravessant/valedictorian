CREATE TABLE "application_attempt_records" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"application_id" text NOT NULL,
	"state" text NOT NULL,
	"started_at" text NOT NULL,
	"completed_at" text,
	"summary" text,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_application_attempt_records_workspace" CHECK (length("application_attempt_records"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_application_attempt_records_state" CHECK ("application_attempt_records"."state" in ('pending','running','succeeded','failed')),
	CONSTRAINT "chk_application_attempt_records_summary" CHECK ("application_attempt_records"."summary" is null or length("application_attempt_records"."summary") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "application_event_records" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"application_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_display_name" text,
	"summary" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_application_event_records_workspace" CHECK (length("application_event_records"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_application_event_records_type" CHECK (length("application_event_records"."type") between 1 and 100),
	CONSTRAINT "chk_application_event_records_actor_type" CHECK ("application_event_records"."actor_type" in ('user','agent','system')),
	CONSTRAINT "chk_application_event_records_summary" CHECK (length("application_event_records"."summary") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "application_history" (
	"application_id" text NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"snapshot_json" text NOT NULL,
	"audit_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "application_history_pk" PRIMARY KEY("application_id","revision"),
	CONSTRAINT "chk_application_history_revision" CHECK ("application_history"."revision" > 0),
	CONSTRAINT "chk_application_history_kind" CHECK ("application_history"."kind" in ('created','status_changed','company_edited','source_edited','link_created','link_updated','link_removed','snapshot_refreshed','removed','restored')),
	CONSTRAINT "chk_application_history_snapshot_bound" CHECK (length("application_history"."snapshot_json") <= 262144),
	CONSTRAINT "chk_application_history_audit_bound" CHECK (length("application_history"."audit_json") <= 16384),
	CONSTRAINT "chk_application_history_audit_keys" CHECK ("application_history"."audit_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')
);
--> statement-breakpoint
CREATE TABLE "application_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"score" integer NOT NULL,
	"band" text NOT NULL,
	"role_relevance" integer NOT NULL,
	"career_signal" integer NOT NULL,
	"city_work_mode" integer NOT NULL,
	"compensation_logistics" integer NOT NULL,
	"penalties_json" text NOT NULL,
	"rationale" text NOT NULL,
	"rubric_version" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_workflow_states" (
	"application_id" text PRIMARY KEY NOT NULL,
	"operational_status" text DEFAULT 'queued' NOT NULL,
	"has_applied" boolean DEFAULT false NOT NULL,
	"lock_started_at" text,
	"hold_started_at" text,
	"manual_review_kind" text,
	"missing_user_info" text,
	"blocker_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"job_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"job_facts_revision" integer NOT NULL,
	"snapshot_json" text NOT NULL,
	"company_name" text NOT NULL,
	"source_name" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"removed_at" text,
	"idempotency_key" text,
	CONSTRAINT "chk_lifecycle_applications_idempotency_key" CHECK ("applications"."idempotency_key" is null or length("applications"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_lifecycle_applications_workspace" CHECK (length("applications"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_lifecycle_applications_revision" CHECK ("applications"."revision" > 0),
	CONSTRAINT "chk_lifecycle_applications_status" CHECK ("applications"."status" in ('active','submitted','interviewing','offered','withdrawn','rejected','accepted')),
	CONSTRAINT "chk_lifecycle_applications_job_facts_revision" CHECK ("applications"."job_facts_revision" > 0),
	CONSTRAINT "chk_lifecycle_applications_snapshot_bound" CHECK (length("applications"."snapshot_json") <= 262144),
	CONSTRAINT "chk_lifecycle_applications_company" CHECK (length("applications"."company_name") between 1 and 500),
	CONSTRAINT "chk_lifecycle_applications_source" CHECK (length("applications"."source_name") between 1 and 500)
);
--> statement-breakpoint
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
	"retry_delay_1_ms" integer NOT NULL,
	"retry_delay_2_ms" integer NOT NULL,
	"retry_delay_3_ms" integer NOT NULL,
	"retry_delay_4_ms" integer NOT NULL,
	"retry_delay_5_ms" integer NOT NULL,
	"retry_delay_6_ms" integer NOT NULL,
	CONSTRAINT "chk_capture_destination_resolution_work_revision" CHECK ("capture_destination_resolution_work"."capture_revision" > 0),
	CONSTRAINT "chk_capture_destination_resolution_work_resolver" CHECK (length("capture_destination_resolution_work"."resolver_id") between 1 and 256
        and length("capture_destination_resolution_work"."resolver_version") between 1 and 128
        and length("capture_destination_resolution_work"."input_fingerprint") = 64),
	CONSTRAINT "chk_capture_destination_resolution_work_retry_policy" CHECK ("capture_destination_resolution_work"."max_attempts" between 1 and 7
        and "capture_destination_resolution_work"."retry_delay_1_ms" between 1 and 86400000
        and "capture_destination_resolution_work"."retry_delay_2_ms" between 1 and 86400000
        and "capture_destination_resolution_work"."retry_delay_3_ms" between 1 and 86400000
        and "capture_destination_resolution_work"."retry_delay_4_ms" between 1 and 86400000
        and "capture_destination_resolution_work"."retry_delay_5_ms" between 1 and 86400000
        and "capture_destination_resolution_work"."retry_delay_6_ms" between 1 and 86400000),
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
CREATE TABLE "capture_evidence_items" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
	"capture_revision" integer NOT NULL,
	"evidence_index" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"value_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_capture_evidence_items_revision" CHECK ("capture_evidence_items"."capture_revision" > 0),
	CONSTRAINT "chk_capture_evidence_items_index" CHECK ("capture_evidence_items"."evidence_index" between 0 and 49),
	CONSTRAINT "chk_capture_evidence_items_kind" CHECK (length("capture_evidence_items"."kind") between 1 and 100),
	CONSTRAINT "chk_capture_evidence_items_label" CHECK (length("capture_evidence_items"."label") between 1 and 200),
	CONSTRAINT "chk_capture_evidence_items_value_bound" CHECK (length("capture_evidence_items"."value_json") <= 16384),
	CONSTRAINT "chk_capture_evidence_items_value_keys" CHECK ("capture_evidence_items"."value_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')
);
--> statement-breakpoint
CREATE TABLE "capture_field_outcomes" (
	"capture_id" text NOT NULL,
	"capture_revision" integer NOT NULL,
	"resolver_id" text NOT NULL,
	"resolver_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"field" text NOT NULL,
	"status" text NOT NULL,
	"outcome_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "capture_field_outcomes_pk" PRIMARY KEY("capture_id","capture_revision","resolver_id","resolver_version","input_hash","field"),
	CONSTRAINT "chk_capture_field_outcomes_revision" CHECK ("capture_field_outcomes"."capture_revision" > 0),
	CONSTRAINT "chk_capture_field_outcomes_resolver" CHECK (length("capture_field_outcomes"."resolver_id") between 1 and 256 and length("capture_field_outcomes"."resolver_version") between 1 and 128 and length("capture_field_outcomes"."input_hash") between 1 and 256),
	CONSTRAINT "chk_capture_field_outcomes_field" CHECK (length("capture_field_outcomes"."field") between 1 and 64),
	CONSTRAINT "chk_capture_field_outcomes_status" CHECK (length("capture_field_outcomes"."status") between 1 and 32),
	CONSTRAINT "chk_capture_field_outcomes_outcome_bound" CHECK (length("capture_field_outcomes"."outcome_json") <= 16384),
	CONSTRAINT "chk_capture_field_outcomes_outcome_keys" CHECK ("capture_field_outcomes"."outcome_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')
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
CREATE TABLE "capture_occurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
	"capture_revision" integer NOT NULL,
	"connector_instance_id" text NOT NULL,
	"connector_run_id" text NOT NULL,
	"execution_scope_id" text NOT NULL,
	"observed_at" text NOT NULL,
	"received_at" text NOT NULL,
	CONSTRAINT "chk_capture_occurrences_revision" CHECK ("capture_occurrences"."capture_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "capture_resolution_command_receipts" (
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"request_snapshot_json" text DEFAULT '{}' NOT NULL,
	"result_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "capture_resolution_command_receipts_pk" PRIMARY KEY("workspace_id","operation","idempotency_key"),
	CONSTRAINT "chk_capture_resolution_command_receipts_operation" CHECK ("capture_resolution_command_receipts"."operation" in ('retry','replay','correct','complete')),
	CONSTRAINT "chk_capture_resolution_command_receipts_key" CHECK (length("capture_resolution_command_receipts"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_capture_resolution_command_receipts_fingerprint" CHECK (length("capture_resolution_command_receipts"."request_fingerprint") = 64),
	CONSTRAINT "chk_capture_resolution_command_receipts_result" CHECK (length("capture_resolution_command_receipts"."result_json") between 2 and 16384),
	CONSTRAINT "chk_capture_resolution_command_receipts_request_snapshot" CHECK (length("capture_resolution_command_receipts"."request_snapshot_json") between 2 and 4096
        and "capture_resolution_command_receipts"."request_snapshot_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')
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
        'manual_completion'
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
CREATE TABLE "capture_revisions" (
	"capture_id" text NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"snapshot_json" text NOT NULL,
	"audit_json" text NOT NULL,
	"connector_instance_id" text,
	"connector_run_id" text,
	"execution_scope_id" text,
	"reported_origin_json" text,
	"content_hash" text,
	"payload_json" text,
	"created_at" text NOT NULL,
	CONSTRAINT "capture_revisions_pk" PRIMARY KEY("capture_id","revision"),
	CONSTRAINT "chk_capture_revisions_revision" CHECK ("capture_revisions"."revision" > 0),
	CONSTRAINT "chk_capture_revisions_kind" CHECK ("capture_revisions"."kind" in ('created','corrected','removed','restored')),
	CONSTRAINT "chk_capture_revisions_snapshot_bound" CHECK (length("capture_revisions"."snapshot_json") <= 262144),
	CONSTRAINT "chk_capture_revisions_audit_bound" CHECK (length("capture_revisions"."audit_json") <= 16384),
	CONSTRAINT "chk_capture_revisions_audit_keys" CHECK ("capture_revisions"."audit_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:'),
	CONSTRAINT "chk_capture_revisions_payload_bound" CHECK ("capture_revisions"."payload_json" is null or length("capture_revisions"."payload_json") <= 262144),
	CONSTRAINT "chk_capture_revisions_payload_keys" CHECK ("capture_revisions"."payload_json" is null or "capture_revisions"."payload_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:'),
	CONSTRAINT "chk_capture_revisions_connector_provenance" CHECK (("capture_revisions"."connector_instance_id" is null and "capture_revisions"."connector_run_id" is null and "capture_revisions"."execution_scope_id" is null and "capture_revisions"."reported_origin_json" is null) or ("capture_revisions"."connector_instance_id" is not null and "capture_revisions"."connector_run_id" is not null and "capture_revisions"."execution_scope_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "captures" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"evidence_mode" text NOT NULL,
	"adapter_id" text NOT NULL,
	"adapter_kind" text NOT NULL,
	"adapter_version" text NOT NULL,
	"observed_at" text NOT NULL,
	"received_at" text NOT NULL,
	"provider_record_id" text,
	"provider_schema" text,
	"payload_json" text,
	"revision" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"removed_at" text,
	"idempotency_key" text,
	CONSTRAINT "chk_lifecycle_captures_idempotency_key" CHECK ("captures"."idempotency_key" is null or length("captures"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_lifecycle_captures_workspace" CHECK (length("captures"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_lifecycle_captures_evidence_mode" CHECK ("captures"."evidence_mode" in ('reported','ats_details_provided')),
	CONSTRAINT "chk_lifecycle_captures_adapter_kind" CHECK ("captures"."adapter_kind" in ('connector','cli','manual','import')),
	CONSTRAINT "chk_lifecycle_captures_adapter_version" CHECK (length("captures"."adapter_version") between 1 and 100),
	CONSTRAINT "chk_lifecycle_captures_provider_record" CHECK ("captures"."provider_record_id" is null or length("captures"."provider_record_id") between 1 and 500),
	CONSTRAINT "chk_lifecycle_captures_provider_schema" CHECK ("captures"."provider_schema" is null or length("captures"."provider_schema") between 1 and 500),
	CONSTRAINT "chk_lifecycle_captures_payload_bound" CHECK ("captures"."payload_json" is null or length("captures"."payload_json") <= 262144),
	CONSTRAINT "chk_lifecycle_captures_payload_keys" CHECK ("captures"."payload_json" is null or "captures"."payload_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:'),
	CONSTRAINT "chk_lifecycle_captures_revision" CHECK ("captures"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "company_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"company_id" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"removed_at" text,
	CONSTRAINT "chk_company_aliases_value" CHECK (length(btrim("company_aliases"."value")) between 1 and 500),
	CONSTRAINT "chk_company_aliases_normalized_value" CHECK (length("company_aliases"."normalized_value") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "company_command_receipts" (
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"result_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "company_command_receipts_workspace_id_idempotency_key_pk" PRIMARY KEY("workspace_id","idempotency_key"),
	CONSTRAINT "chk_company_command_receipts_key" CHECK (length(btrim("company_command_receipts"."idempotency_key")) between 1 and 200),
	CONSTRAINT "chk_company_command_receipts_operation" CHECK ("company_command_receipts"."operation" in ('create','update','notes','alias_add','alias_update','alias_remove','archive','restore','reassign','mark_distinct','merge')),
	CONSTRAINT "chk_company_command_receipts_fingerprint" CHECK (length("company_command_receipts"."request_fingerprint") = 64),
	CONSTRAINT "chk_company_command_receipts_result" CHECK (length("company_command_receipts"."result_json") between 2 and 65536)
);
--> statement-breakpoint
CREATE TABLE "company_duplicate_candidate_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"candidate_revision" integer NOT NULL,
	"decision" text NOT NULL,
	"actor_json" text NOT NULL,
	"rationale" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_company_duplicate_candidate_reviews_decision" CHECK ("company_duplicate_candidate_reviews"."decision" in ('mark_distinct','merge')),
	CONSTRAINT "chk_company_duplicate_candidate_reviews_revision" CHECK ("company_duplicate_candidate_reviews"."candidate_revision" > 0),
	CONSTRAINT "chk_company_duplicate_candidate_reviews_actor" CHECK (length("company_duplicate_candidate_reviews"."actor_json") between 2 and 2048),
	CONSTRAINT "chk_company_duplicate_candidate_reviews_rationale" CHECK (length(btrim("company_duplicate_candidate_reviews"."rationale")) between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "company_duplicate_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lower_company_id" text NOT NULL,
	"higher_company_id" text NOT NULL,
	"revision" integer NOT NULL,
	"score" integer NOT NULL,
	"reason_codes_json" text NOT NULL,
	"matcher_version" text NOT NULL,
	"lower_input_fingerprint" text NOT NULL,
	"higher_input_fingerprint" text NOT NULL,
	"lower_resolved_snapshot_json" text,
	"higher_resolved_snapshot_json" text,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "uq_company_duplicate_candidates_workspace_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "chk_company_duplicate_candidates_id" CHECK ("company_duplicate_candidates"."id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "chk_company_duplicate_candidates_order" CHECK ("company_duplicate_candidates"."lower_company_id" < "company_duplicate_candidates"."higher_company_id"),
	CONSTRAINT "chk_company_duplicate_candidates_revision" CHECK ("company_duplicate_candidates"."revision" > 0),
	CONSTRAINT "chk_company_duplicate_candidates_score" CHECK ("company_duplicate_candidates"."score" between 0 and 10000),
	CONSTRAINT "chk_company_duplicate_candidates_reasons" CHECK (length("company_duplicate_candidates"."reason_codes_json") between 2 and 2048),
	CONSTRAINT "chk_company_duplicate_candidates_matcher" CHECK (length("company_duplicate_candidates"."matcher_version") between 1 and 100),
	CONSTRAINT "chk_company_duplicate_candidates_fingerprints" CHECK (length("company_duplicate_candidates"."lower_input_fingerprint") = 64
        and length("company_duplicate_candidates"."higher_input_fingerprint") = 64),
	CONSTRAINT "chk_company_duplicate_candidates_resolved_snapshots" CHECK (("company_duplicate_candidates"."lower_resolved_snapshot_json" is null
          and "company_duplicate_candidates"."higher_resolved_snapshot_json" is null)
        or ("company_duplicate_candidates"."status" = 'resolved_by_merge'
          and length("company_duplicate_candidates"."lower_resolved_snapshot_json") between 2 and 4096
          and length("company_duplicate_candidates"."higher_resolved_snapshot_json") between 2 and 4096)),
	CONSTRAINT "chk_company_duplicate_candidates_status" CHECK ("company_duplicate_candidates"."status" in ('open','marked_distinct','resolved_by_merge'))
);
--> statement-breakpoint
CREATE TABLE "company_duplicate_index_state" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"matcher_version" text NOT NULL,
	"after_company_id" text,
	"status" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_company_duplicate_index_state_status" CHECK ("company_duplicate_index_state"."status" in ('indexing','ready')),
	CONSTRAINT "chk_company_duplicate_index_state_matcher" CHECK (length("company_duplicate_index_state"."matcher_version") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "company_duplicate_maintenance_work" (
	"workspace_id" text NOT NULL,
	"company_id" text NOT NULL,
	"requested_revision" integer NOT NULL,
	"processed_revision" integer,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "company_duplicate_maintenance_work_workspace_id_company_id_pk" PRIMARY KEY("workspace_id","company_id"),
	CONSTRAINT "chk_company_duplicate_maintenance_work_requested" CHECK ("company_duplicate_maintenance_work"."requested_revision" > 0),
	CONSTRAINT "chk_company_duplicate_maintenance_work_processed" CHECK ("company_duplicate_maintenance_work"."processed_revision" is null
        or ("company_duplicate_maintenance_work"."processed_revision" > 0
          and "company_duplicate_maintenance_work"."processed_revision" <= "company_duplicate_maintenance_work"."requested_revision")),
	CONSTRAINT "chk_company_duplicate_maintenance_work_status" CHECK ("company_duplicate_maintenance_work"."status" in ('pending','processing','idle'))
);
--> statement-breakpoint
CREATE TABLE "company_history" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"company_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"company_revision" integer NOT NULL,
	"kind" text NOT NULL,
	"changed_fields_json" text NOT NULL,
	"actor_json" text NOT NULL,
	"rationale" text NOT NULL,
	"alias_id" text,
	"related_company_id" text,
	"affected_job_ids_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_company_history_sequence" CHECK ("company_history"."sequence" > 0),
	CONSTRAINT "chk_company_history_revision" CHECK ("company_history"."company_revision" > 0),
	CONSTRAINT "chk_company_history_kind" CHECK ("company_history"."kind" in ('created','updated','alias_added','alias_updated',
        'alias_removed','archived','restored','merged')),
	CONSTRAINT "chk_company_history_changed_fields" CHECK (length("company_history"."changed_fields_json") between 2 and 2048),
	CONSTRAINT "chk_company_history_actor" CHECK (length("company_history"."actor_json") between 2 and 2048),
	CONSTRAINT "chk_company_history_rationale" CHECK (length(btrim("company_history"."rationale")) between 1 and 1000),
	CONSTRAINT "chk_company_history_affected_jobs" CHECK (length("company_history"."affected_job_ids_json") between 2 and 16384)
);
--> statement-breakpoint
CREATE TABLE "connector_capture_work" (
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
	"connector_instance_id" text NOT NULL,
	"filter_signature" text NOT NULL,
	"checkpoint_schema_version" text NOT NULL,
	"checkpoint_generation" text NOT NULL,
	"last_attempt_at" text NOT NULL,
	"computed_delay_ms" integer,
	"server_minimum_delay_ms" integer,
	"horizon_at" text NOT NULL,
	"acquisition_run_id" text,
	"skipped_run_id" text,
	CONSTRAINT "chk_connector_capture_work_filter" CHECK (length("connector_capture_work"."filter_signature") between 1 and 512),
	CONSTRAINT "chk_connector_capture_work_server_minimum" CHECK ("connector_capture_work"."server_minimum_delay_ms" is null or "connector_capture_work"."server_minimum_delay_ms" >= 0),
	CONSTRAINT "chk_connector_capture_work_workspace" CHECK (length("connector_capture_work"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_connector_capture_work_idempotency" CHECK (length("connector_capture_work"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_connector_capture_work_budget" CHECK ("connector_capture_work"."attempt" >= 1 and "connector_capture_work"."max_attempts" >= "connector_capture_work"."attempt"),
	CONSTRAINT "chk_connector_capture_work_status" CHECK ("connector_capture_work"."status" in ('scheduled','claimed','completed','exhausted','cancelled','terminal')),
	CONSTRAINT "chk_connector_capture_work_reason" CHECK (("connector_capture_work"."status" = 'terminal' and "connector_capture_work"."failure_reason" in ('invalid_target','unresolvable','unsupported_provider','security_rejected')) or ("connector_capture_work"."status" <> 'terminal' and ("connector_capture_work"."failure_reason" is null or "connector_capture_work"."failure_reason" in ('rate_limit','server_failure','network_interruption','operation_timeout')))),
	CONSTRAINT "chk_connector_capture_work_detail" CHECK ("connector_capture_work"."failure_detail" is null or (length("connector_capture_work"."failure_detail") between 1 and 2000 and "connector_capture_work"."failure_detail" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')),
	CONSTRAINT "chk_connector_capture_work_timing" CHECK (("connector_capture_work"."status" in ('scheduled','claimed') and "connector_capture_work"."next_eligible_at" is not null) or ("connector_capture_work"."status" in ('completed','exhausted','cancelled','terminal') and "connector_capture_work"."next_eligible_at" is null)),
	CONSTRAINT "chk_connector_capture_work_claim_pair" CHECK (("connector_capture_work"."acquisition_token" is null and "connector_capture_work"."claimed_at" is null) or ("connector_capture_work"."acquisition_token" is not null and "connector_capture_work"."claimed_at" is not null)),
	CONSTRAINT "chk_connector_capture_work_scheduled_unclaimed" CHECK ("connector_capture_work"."status" <> 'scheduled' or "connector_capture_work"."acquisition_token" is null)
);
--> statement-breakpoint
CREATE TABLE "connector_checkpoints" (
	"connector_instance_id" text NOT NULL,
	"filter_signature" text DEFAULT 'filters:{}' NOT NULL,
	"checkpoint_json" text NOT NULL,
	"schema_version" text NOT NULL,
	"coverage_started_at" text,
	"coverage_ended_at" text,
	"saved_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "connector_checkpoints_connector_instance_id_filter_signature_pk" PRIMARY KEY("connector_instance_id","filter_signature")
);
--> statement-breakpoint
CREATE TABLE "connector_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_scope_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"connector_version" text NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean NOT NULL,
	"config_json" text NOT NULL,
	"auth_json" text DEFAULT '[]' NOT NULL,
	"filters_json" text DEFAULT '{}' NOT NULL,
	"earliest_backfill_date" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "connector_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_instance_id" text NOT NULL,
	"connector_run_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"connector_version" text NOT NULL,
	"parser_version" text,
	"observation_schema_version" text,
	"source_record_key" text NOT NULL,
	"observed_at" text NOT NULL,
	"company_name" text NOT NULL,
	"role_title" text NOT NULL,
	"location_raw" text,
	"description_text" text,
	"pay_json" text NOT NULL,
	"links_json" text NOT NULL,
	"resolution_json" text NOT NULL,
	"dedupe_keys_json" text NOT NULL,
	"source_metadata_json" text NOT NULL,
	"evidence_json" text NOT NULL,
	"raw_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "connector_run_synchronizations" (
	"connector_run_id" text PRIMARY KEY NOT NULL,
	"snapshot_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_connector_run_synchronizations_length" CHECK (length("connector_run_synchronizations"."snapshot_json") between 2 and 8192)
);
--> statement-breakpoint
CREATE TABLE "connector_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_scope_id" text NOT NULL,
	"connector_instance_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"completed_at" text,
	"coverage_started_at" text,
	"coverage_ended_at" text,
	"config_json" text DEFAULT '{}' NOT NULL,
	"filters_json" text DEFAULT '{}' NOT NULL,
	"filter_signature" text DEFAULT 'filters:{}' NOT NULL,
	"observation_count" integer NOT NULL,
	"warning_count" integer NOT NULL,
	"stats_json" text NOT NULL,
	"warnings_json" text NOT NULL,
	"retry_hints_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "idx_connector_runs_id_instance" UNIQUE("id","connector_instance_id"),
	CONSTRAINT "chk_connector_runs_status" CHECK ("connector_runs"."status" in ('queued','running','completed','failed','cancelled','skipped'))
);
--> statement-breakpoint
CREATE TABLE "connector_schedule_events" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"actor_class" text NOT NULL,
	"action" text NOT NULL,
	"revision" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_schedule_occurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"schedule_revision" text NOT NULL,
	"nominal_at" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"admitted_mode" text NOT NULL,
	"outcome" text NOT NULL,
	"connector_run_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_schedule_revisions" (
	"revision" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"state" text NOT NULL,
	"cadence_json" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_instance_id" text NOT NULL,
	"revision" text NOT NULL,
	"state" text NOT NULL,
	"cadence_json" text NOT NULL,
	"timezone" text NOT NULL,
	"next_eligible_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "hosted_result_polling_work" (
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
	"resolution_request_id" text NOT NULL,
	CONSTRAINT "chk_hosted_result_polling_work_request" CHECK (length("hosted_result_polling_work"."resolution_request_id") between 1 and 256),
	CONSTRAINT "chk_hosted_result_polling_work_workspace" CHECK (length("hosted_result_polling_work"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_hosted_result_polling_work_idempotency" CHECK (length("hosted_result_polling_work"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_hosted_result_polling_work_budget" CHECK ("hosted_result_polling_work"."attempt" >= 1 and "hosted_result_polling_work"."max_attempts" >= "hosted_result_polling_work"."attempt"),
	CONSTRAINT "chk_hosted_result_polling_work_status" CHECK ("hosted_result_polling_work"."status" in ('scheduled','claimed','completed','exhausted','cancelled','terminal')),
	CONSTRAINT "chk_hosted_result_polling_work_reason" CHECK (("hosted_result_polling_work"."status" = 'terminal' and "hosted_result_polling_work"."failure_reason" in ('invalid_target','unresolvable','unsupported_provider','security_rejected')) or ("hosted_result_polling_work"."status" <> 'terminal' and ("hosted_result_polling_work"."failure_reason" is null or "hosted_result_polling_work"."failure_reason" in ('rate_limit','server_failure','network_interruption','operation_timeout')))),
	CONSTRAINT "chk_hosted_result_polling_work_detail" CHECK ("hosted_result_polling_work"."failure_detail" is null or (length("hosted_result_polling_work"."failure_detail") between 1 and 2000 and "hosted_result_polling_work"."failure_detail" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')),
	CONSTRAINT "chk_hosted_result_polling_work_timing" CHECK (("hosted_result_polling_work"."status" in ('scheduled','claimed') and "hosted_result_polling_work"."next_eligible_at" is not null) or ("hosted_result_polling_work"."status" in ('completed','exhausted','cancelled','terminal') and "hosted_result_polling_work"."next_eligible_at" is null)),
	CONSTRAINT "chk_hosted_result_polling_work_claim_pair" CHECK (("hosted_result_polling_work"."acquisition_token" is null and "hosted_result_polling_work"."claimed_at" is null) or ("hosted_result_polling_work"."acquisition_token" is not null and "hosted_result_polling_work"."claimed_at" is not null)),
	CONSTRAINT "chk_hosted_result_polling_work_scheduled_unclaimed" CHECK ("hosted_result_polling_work"."status" <> 'scheduled' or "hosted_result_polling_work"."acquisition_token" is null)
);
--> statement-breakpoint
CREATE TABLE "hosted_submission_work" (
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
	"canonical_url_hash" text NOT NULL,
	CONSTRAINT "chk_hosted_submission_work_url" CHECK (length("hosted_submission_work"."canonical_url_hash") between 1 and 256),
	CONSTRAINT "chk_hosted_submission_work_workspace" CHECK (length("hosted_submission_work"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_hosted_submission_work_idempotency" CHECK (length("hosted_submission_work"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_hosted_submission_work_budget" CHECK ("hosted_submission_work"."attempt" >= 1 and "hosted_submission_work"."max_attempts" >= "hosted_submission_work"."attempt"),
	CONSTRAINT "chk_hosted_submission_work_status" CHECK ("hosted_submission_work"."status" in ('scheduled','claimed','completed','exhausted','cancelled','terminal')),
	CONSTRAINT "chk_hosted_submission_work_reason" CHECK (("hosted_submission_work"."status" = 'terminal' and "hosted_submission_work"."failure_reason" in ('invalid_target','unresolvable','unsupported_provider','security_rejected')) or ("hosted_submission_work"."status" <> 'terminal' and ("hosted_submission_work"."failure_reason" is null or "hosted_submission_work"."failure_reason" in ('rate_limit','server_failure','network_interruption','operation_timeout')))),
	CONSTRAINT "chk_hosted_submission_work_detail" CHECK ("hosted_submission_work"."failure_detail" is null or (length("hosted_submission_work"."failure_detail") between 1 and 2000 and "hosted_submission_work"."failure_detail" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')),
	CONSTRAINT "chk_hosted_submission_work_timing" CHECK (("hosted_submission_work"."status" in ('scheduled','claimed') and "hosted_submission_work"."next_eligible_at" is not null) or ("hosted_submission_work"."status" in ('completed','exhausted','cancelled','terminal') and "hosted_submission_work"."next_eligible_at" is null)),
	CONSTRAINT "chk_hosted_submission_work_claim_pair" CHECK (("hosted_submission_work"."acquisition_token" is null and "hosted_submission_work"."claimed_at" is null) or ("hosted_submission_work"."acquisition_token" is not null and "hosted_submission_work"."claimed_at" is not null)),
	CONSTRAINT "chk_hosted_submission_work_scheduled_unclaimed" CHECK ("hosted_submission_work"."status" <> 'scheduled' or "hosted_submission_work"."acquisition_token" is null)
);
--> statement-breakpoint
CREATE TABLE "job_capture_evidence_references" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"capture_revision" integer NOT NULL,
	"evidence_indexes_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_job_capture_evidence_references_revision" CHECK ("job_capture_evidence_references"."capture_revision" > 0),
	CONSTRAINT "chk_job_capture_evidence_references_indexes" CHECK (length("job_capture_evidence_references"."evidence_indexes_json") between 2 and 4096)
);
--> statement-breakpoint
CREATE TABLE "job_company_assignment_history" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"job_id" text NOT NULL,
	"assignment_revision" integer NOT NULL,
	"prior_company_id" text,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_json" text NOT NULL,
	"rationale" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_job_company_assignment_history_revision" CHECK ("job_company_assignment_history"."assignment_revision" > 0),
	CONSTRAINT "chk_job_company_assignment_history_kind" CHECK ("job_company_assignment_history"."kind" in ('baseline','assigned','reassigned','merged')),
	CONSTRAINT "chk_job_company_assignment_history_rationale" CHECK (length(btrim("job_company_assignment_history"."rationale")) between 1 and 1000),
	CONSTRAINT "chk_job_company_assignment_history_actor" CHECK (length("job_company_assignment_history"."actor_json") between 2 and 2048)
);
--> statement-breakpoint
CREATE TABLE "job_company_assignments" (
	"job_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"company_id" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_job_company_assignments_revision" CHECK ("job_company_assignments"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "job_external_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"account" text,
	"value" text NOT NULL,
	"strength" text NOT NULL,
	"provenance_kind" text NOT NULL,
	"provenance_version" text NOT NULL,
	"evidence_json" text NOT NULL,
	"removed_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_job_external_identities_kind" CHECK ("job_external_identities"."kind" in ('ats_job','employer_job','canonical_destination','posting')),
	CONSTRAINT "chk_job_external_identities_strength" CHECK ("job_external_identities"."strength" in ('strong','provisional')),
	CONSTRAINT "chk_job_external_identities_provider" CHECK ("job_external_identities"."provider" = lower("job_external_identities"."provider") and length("job_external_identities"."provider") between 1 and 200),
	CONSTRAINT "chk_job_external_identities_account" CHECK ("job_external_identities"."account" is null or ("job_external_identities"."account" = lower("job_external_identities"."account") and length("job_external_identities"."account") between 1 and 500)),
	CONSTRAINT "chk_job_external_identities_value" CHECK (length("job_external_identities"."value") between 1 and 2048),
	CONSTRAINT "chk_job_external_identities_provenance_version" CHECK (length("job_external_identities"."provenance_version") between 1 and 128),
	CONSTRAINT "chk_job_external_identities_evidence_bound" CHECK (length("job_external_identities"."evidence_json") between 2 and 16384),
	CONSTRAINT "chk_job_external_identities_evidence_keys" CHECK ("job_external_identities"."evidence_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:'),
	CONSTRAINT "chk_job_external_identities_strong_account" CHECK ("job_external_identities"."strength" = 'provisional' or "job_external_identities"."account" is not null)
);
--> statement-breakpoint
CREATE TABLE "job_history" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"snapshot_json" text NOT NULL,
	"audit_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_job_history_sequence" CHECK ("job_history"."sequence" > 0),
	CONSTRAINT "chk_job_history_kind" CHECK ("job_history"."kind" in ('created','facts_corrected','availability_changed','identity_added','identity_removed','removed','restored')),
	CONSTRAINT "chk_job_history_snapshot_bound" CHECK (length("job_history"."snapshot_json") <= 262144),
	CONSTRAINT "chk_job_history_audit_bound" CHECK (length("job_history"."audit_json") <= 16384),
	CONSTRAINT "chk_job_history_audit_keys" CHECK ("job_history"."audit_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"facts_revision" integer NOT NULL,
	"facts_json" text NOT NULL,
	"availability_state" text NOT NULL,
	"availability_observed_at" text NOT NULL,
	"availability_revision" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"removed_at" text,
	"idempotency_key" text,
	CONSTRAINT "chk_lifecycle_jobs_idempotency_key" CHECK ("jobs"."idempotency_key" is null or length("jobs"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_lifecycle_jobs_id" CHECK ("jobs"."id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "chk_lifecycle_jobs_workspace" CHECK (length("jobs"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_lifecycle_jobs_facts_revision" CHECK ("jobs"."facts_revision" > 0),
	CONSTRAINT "chk_lifecycle_jobs_facts_bound" CHECK (length("jobs"."facts_json") <= 262144),
	CONSTRAINT "chk_lifecycle_jobs_availability_state" CHECK ("jobs"."availability_state" in ('open','closed','unknown')),
	CONSTRAINT "chk_lifecycle_jobs_availability_revision" CHECK ("jobs"."availability_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "normalization_work" (
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
	"resolver_id" text NOT NULL,
	"resolver_version" text NOT NULL,
	"input_hash" text NOT NULL,
	CONSTRAINT "chk_normalization_work_revision" CHECK ("normalization_work"."capture_revision" > 0),
	CONSTRAINT "chk_normalization_work_resolver" CHECK (length("normalization_work"."resolver_id") between 1 and 256 and length("normalization_work"."resolver_version") between 1 and 128 and length("normalization_work"."input_hash") between 1 and 256),
	CONSTRAINT "chk_normalization_work_workspace" CHECK (length("normalization_work"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_normalization_work_idempotency" CHECK (length("normalization_work"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_normalization_work_budget" CHECK ("normalization_work"."attempt" >= 1 and "normalization_work"."max_attempts" >= "normalization_work"."attempt"),
	CONSTRAINT "chk_normalization_work_status" CHECK ("normalization_work"."status" in ('scheduled','claimed','completed','exhausted','cancelled','terminal')),
	CONSTRAINT "chk_normalization_work_reason" CHECK (("normalization_work"."status" = 'terminal' and "normalization_work"."failure_reason" in ('invalid_target','unresolvable','unsupported_provider','security_rejected')) or ("normalization_work"."status" <> 'terminal' and ("normalization_work"."failure_reason" is null or "normalization_work"."failure_reason" in ('rate_limit','server_failure','network_interruption','operation_timeout')))),
	CONSTRAINT "chk_normalization_work_detail" CHECK ("normalization_work"."failure_detail" is null or (length("normalization_work"."failure_detail") between 1 and 2000 and "normalization_work"."failure_detail" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')),
	CONSTRAINT "chk_normalization_work_timing" CHECK (("normalization_work"."status" in ('scheduled','claimed') and "normalization_work"."next_eligible_at" is not null) or ("normalization_work"."status" in ('completed','exhausted','cancelled','terminal') and "normalization_work"."next_eligible_at" is null)),
	CONSTRAINT "chk_normalization_work_claim_pair" CHECK (("normalization_work"."acquisition_token" is null and "normalization_work"."claimed_at" is null) or ("normalization_work"."acquisition_token" is not null and "normalization_work"."claimed_at" is not null)),
	CONSTRAINT "chk_normalization_work_scheduled_unclaimed" CHECK ("normalization_work"."status" <> 'scheduled' or "normalization_work"."acquisition_token" is null)
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"job_id" text NOT NULL,
	"revision" integer NOT NULL,
	"fit" text NOT NULL,
	"rank" integer,
	"cutoff" text NOT NULL,
	"disposition" text NOT NULL,
	"override_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"removed_at" text,
	"idempotency_key" text,
	CONSTRAINT "chk_lifecycle_opportunities_idempotency_key" CHECK ("opportunities"."idempotency_key" is null or length("opportunities"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_lifecycle_opportunities_workspace" CHECK (length("opportunities"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_lifecycle_opportunities_revision" CHECK ("opportunities"."revision" > 0),
	CONSTRAINT "chk_lifecycle_opportunities_fit" CHECK ("opportunities"."fit" in ('fit','possible','not_fit','unknown')),
	CONSTRAINT "chk_lifecycle_opportunities_rank" CHECK ("opportunities"."rank" is null or "opportunities"."rank" > 0),
	CONSTRAINT "chk_lifecycle_opportunities_cutoff" CHECK ("opportunities"."cutoff" in ('above','below','not_evaluated')),
	CONSTRAINT "chk_lifecycle_opportunities_disposition" CHECK ("opportunities"."disposition" in ('reviewing','pursue','hold','declined','archived')),
	CONSTRAINT "chk_lifecycle_opportunities_override_bound" CHECK ("opportunities"."override_json" is null or length("opportunities"."override_json") <= 16384)
);
--> statement-breakpoint
CREATE TABLE "opportunity_history" (
	"opportunity_id" text NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"snapshot_json" text NOT NULL,
	"audit_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "opportunity_history_pk" PRIMARY KEY("opportunity_id","revision"),
	CONSTRAINT "chk_opportunity_history_revision" CHECK ("opportunity_history"."revision" > 0),
	CONSTRAINT "chk_opportunity_history_kind" CHECK ("opportunity_history"."kind" in ('created','evaluation_changed','disposition_changed','removed','restored')),
	CONSTRAINT "chk_opportunity_history_snapshot_bound" CHECK (length("opportunity_history"."snapshot_json") <= 262144),
	CONSTRAINT "chk_opportunity_history_audit_bound" CHECK (length("opportunity_history"."audit_json") <= 16384),
	CONSTRAINT "chk_opportunity_history_audit_keys" CHECK ("opportunity_history"."audit_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')
);
--> statement-breakpoint
CREATE TABLE "policy_config" (
	"id" text PRIMARY KEY NOT NULL,
	"config_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"tag" text NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"payload_json" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_url_resolution_work" (
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
	"resolver_id" text NOT NULL,
	"resolver_version" text NOT NULL,
	"intermediary_url_hash" text NOT NULL,
	CONSTRAINT "chk_provider_url_resolution_work_resolver" CHECK (length("provider_url_resolution_work"."resolver_id") between 1 and 256 and length("provider_url_resolution_work"."resolver_version") between 1 and 128 and length("provider_url_resolution_work"."intermediary_url_hash") between 1 and 256),
	CONSTRAINT "chk_provider_url_resolution_work_workspace" CHECK (length("provider_url_resolution_work"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_provider_url_resolution_work_idempotency" CHECK (length("provider_url_resolution_work"."idempotency_key") between 1 and 200),
	CONSTRAINT "chk_provider_url_resolution_work_budget" CHECK ("provider_url_resolution_work"."attempt" >= 1 and "provider_url_resolution_work"."max_attempts" >= "provider_url_resolution_work"."attempt"),
	CONSTRAINT "chk_provider_url_resolution_work_status" CHECK ("provider_url_resolution_work"."status" in ('scheduled','claimed','completed','exhausted','cancelled','terminal')),
	CONSTRAINT "chk_provider_url_resolution_work_reason" CHECK (("provider_url_resolution_work"."status" = 'terminal' and "provider_url_resolution_work"."failure_reason" in ('invalid_target','unresolvable','unsupported_provider','security_rejected')) or ("provider_url_resolution_work"."status" <> 'terminal' and ("provider_url_resolution_work"."failure_reason" is null or "provider_url_resolution_work"."failure_reason" in ('rate_limit','server_failure','network_interruption','operation_timeout')))),
	CONSTRAINT "chk_provider_url_resolution_work_detail" CHECK ("provider_url_resolution_work"."failure_detail" is null or (length("provider_url_resolution_work"."failure_detail") between 1 and 2000 and "provider_url_resolution_work"."failure_detail" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')),
	CONSTRAINT "chk_provider_url_resolution_work_timing" CHECK (("provider_url_resolution_work"."status" in ('scheduled','claimed') and "provider_url_resolution_work"."next_eligible_at" is not null) or ("provider_url_resolution_work"."status" in ('completed','exhausted','cancelled','terminal') and "provider_url_resolution_work"."next_eligible_at" is null)),
	CONSTRAINT "chk_provider_url_resolution_work_claim_pair" CHECK (("provider_url_resolution_work"."acquisition_token" is null and "provider_url_resolution_work"."claimed_at" is null) or ("provider_url_resolution_work"."acquisition_token" is not null and "provider_url_resolution_work"."claimed_at" is not null)),
	CONSTRAINT "chk_provider_url_resolution_work_scheduled_unclaimed" CHECK ("provider_url_resolution_work"."status" <> 'scheduled' or "provider_url_resolution_work"."acquisition_token" is null)
);
--> statement-breakpoint
CREATE TABLE "pursuit_links" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"is_primary" boolean NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_pursuit_links_kind" CHECK (length("pursuit_links"."kind") between 1 and 100),
	CONSTRAINT "chk_pursuit_links_label" CHECK (length("pursuit_links"."label") between 1 and 200),
	CONSTRAINT "chk_pursuit_links_url" CHECK (length("pursuit_links"."url") between 1 and 4096)
);
--> statement-breakpoint
CREATE TABLE "source_execution_scopes" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"blocked_until" text,
	"backoff_attempt" integer DEFAULT 0 NOT NULL,
	"auth_generation" integer DEFAULT 0 NOT NULL,
	"refresh_lease_token" text,
	"refresh_lease_expires_at" text,
	"action_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "chk_source_execution_scopes_status" CHECK ("source_execution_scopes"."status" in ('available','cooldown','refreshing','action_required')),
	CONSTRAINT "chk_source_execution_scopes_id" CHECK (length("source_execution_scopes"."id") between 8 and 256 and "source_execution_scopes"."id" ~ '^[A-Za-z0-9._~-]+$'),
	CONSTRAINT "chk_source_execution_scopes_backoff" CHECK ("source_execution_scopes"."backoff_attempt" >= 0),
	CONSTRAINT "chk_source_execution_scopes_generation" CHECK ("source_execution_scopes"."auth_generation" >= 0),
	CONSTRAINT "chk_source_execution_scopes_action_reason" CHECK ("source_execution_scopes"."action_reason" is null or "source_execution_scopes"."action_reason" ~ '^[a-z0-9_]{1,64}$')
);
--> statement-breakpoint
CREATE TABLE "source_execution_sessions" (
	"execution_scope_id" text PRIMARY KEY NOT NULL,
	"encrypted_session" text NOT NULL,
	"auth_generation" integer NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_source_execution_sessions_length" CHECK (length("source_execution_sessions"."encrypted_session") between 1 and 1048576),
	CONSTRAINT "chk_source_execution_sessions_generation" CHECK ("source_execution_sessions"."auth_generation" >= 1)
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"account_hint" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "workflow_run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"payload_json" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_type" text NOT NULL,
	"status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_name" text,
	"source_id" text,
	"subject_application_id" text,
	"started_at" text NOT NULL,
	"completed_at" text,
	"coverage_started_at" text,
	"coverage_ended_at" text,
	"timezone" text,
	"input_json" text NOT NULL,
	"summary" text,
	"outcome" text,
	"blocker" text,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "workspace_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"display_name" text NOT NULL,
	"normalized_display_name" text NOT NULL,
	"website_url" text,
	"website_host" text,
	"notes" text,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"merged_into_company_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "uq_workspace_companies_workspace_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "chk_workspace_companies_id" CHECK ("workspace_companies"."id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "chk_workspace_companies_display_name" CHECK (length(btrim("workspace_companies"."display_name")) between 1 and 500),
	CONSTRAINT "chk_workspace_companies_normalized_name" CHECK (length("workspace_companies"."normalized_display_name") between 1 and 500),
	CONSTRAINT "chk_workspace_companies_website_url" CHECK ("workspace_companies"."website_url" is null or length("workspace_companies"."website_url") between 8 and 2048),
	CONSTRAINT "chk_workspace_companies_website_host" CHECK ("workspace_companies"."website_host" is null or length("workspace_companies"."website_host") between 1 and 253),
	CONSTRAINT "chk_workspace_companies_notes" CHECK ("workspace_companies"."notes" is null or length("workspace_companies"."notes") between 1 and 10000),
	CONSTRAINT "chk_workspace_companies_revision" CHECK ("workspace_companies"."revision" > 0),
	CONSTRAINT "chk_workspace_companies_status" CHECK ("workspace_companies"."status" in ('active','archived','merged')),
	CONSTRAINT "chk_workspace_companies_merged_target" CHECK (("workspace_companies"."status" = 'merged') = ("workspace_companies"."merged_into_company_id" is not null)
        and "workspace_companies"."merged_into_company_id" is distinct from "workspace_companies"."id")
);
--> statement-breakpoint
CREATE TABLE "workspace_secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_workspaces_id" CHECK (length("workspaces"."id") between 1 and 200),
	CONSTRAINT "chk_workspaces_name" CHECK (length("workspaces"."name") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "application_attempt_records" ADD CONSTRAINT "application_attempt_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_attempt_records" ADD CONSTRAINT "fk_application_attempt_records_application" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_event_records" ADD CONSTRAINT "application_event_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_event_records" ADD CONSTRAINT "fk_application_event_records_application" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_history" ADD CONSTRAINT "fk_application_history_application" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_scores" ADD CONSTRAINT "fk_application_scores_application" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_workflow_states" ADD CONSTRAINT "fk_application_workflow_states_application" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "fk_lifecycle_applications_opportunity" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "fk_lifecycle_applications_job" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD CONSTRAINT "capture_destination_resolution_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD CONSTRAINT "fk_capture_destination_resolution_work_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_destination_resolution_work" ADD CONSTRAINT "fk_capture_destination_resolution_work_generation" FOREIGN KEY ("generation_id") REFERENCES "public"."capture_resolution_generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_effective_revision_inputs" ADD CONSTRAINT "capture_effective_revision_inputs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_effective_revision_inputs" ADD CONSTRAINT "fk_capture_effective_revision_inputs_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_evidence_items" ADD CONSTRAINT "fk_capture_evidence_items_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_field_outcomes" ADD CONSTRAINT "fk_capture_field_outcomes_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_materialization_issues" ADD CONSTRAINT "capture_materialization_issues_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_materialization_issues" ADD CONSTRAINT "fk_capture_materialization_issues_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_materialization_state" ADD CONSTRAINT "capture_materialization_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_occurrences" ADD CONSTRAINT "fk_capture_occurrences_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_resolution_command_receipts" ADD CONSTRAINT "capture_resolution_command_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_resolution_generations" ADD CONSTRAINT "capture_resolution_generations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_resolution_generations" ADD CONSTRAINT "fk_capture_resolution_generations_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_resolution_stage_results" ADD CONSTRAINT "fk_capture_resolution_stage_results_generation" FOREIGN KEY ("generation_id") REFERENCES "public"."capture_resolution_generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD CONSTRAINT "fk_capture_revisions_capture" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_aliases" ADD CONSTRAINT "fk_company_aliases_company" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_command_receipts" ADD CONSTRAINT "company_command_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_candidate_reviews" ADD CONSTRAINT "fk_company_duplicate_candidate_reviews_candidate" FOREIGN KEY ("workspace_id","candidate_id") REFERENCES "public"."company_duplicate_candidates"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_candidates" ADD CONSTRAINT "company_duplicate_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_candidates" ADD CONSTRAINT "fk_company_duplicate_candidates_lower" FOREIGN KEY ("workspace_id","lower_company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_candidates" ADD CONSTRAINT "fk_company_duplicate_candidates_higher" FOREIGN KEY ("workspace_id","higher_company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_index_state" ADD CONSTRAINT "company_duplicate_index_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_maintenance_work" ADD CONSTRAINT "fk_company_duplicate_maintenance_work_company" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_history" ADD CONSTRAINT "fk_company_history_company" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_history" ADD CONSTRAINT "fk_company_history_related_company" FOREIGN KEY ("workspace_id","related_company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_capture_work" ADD CONSTRAINT "connector_capture_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_capture_work" ADD CONSTRAINT "fk_connector_capture_work_instance" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_checkpoints" ADD CONSTRAINT "connector_checkpoints_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_instances" ADD CONSTRAINT "fk_connector_instances_execution_scope" FOREIGN KEY ("execution_scope_id") REFERENCES "public"."source_execution_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_observations" ADD CONSTRAINT "connector_observations_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_observations" ADD CONSTRAINT "connector_observations_connector_run_id_connector_runs_id_fk" FOREIGN KEY ("connector_run_id") REFERENCES "public"."connector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_run_synchronizations" ADD CONSTRAINT "connector_run_synchronizations_connector_run_id_connector_runs_id_fk" FOREIGN KEY ("connector_run_id") REFERENCES "public"."connector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_runs" ADD CONSTRAINT "connector_runs_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_runs" ADD CONSTRAINT "fk_connector_runs_execution_scope" FOREIGN KEY ("execution_scope_id") REFERENCES "public"."source_execution_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_schedule_events" ADD CONSTRAINT "connector_schedule_events_schedule_id_connector_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."connector_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_schedule_occurrences" ADD CONSTRAINT "connector_schedule_occurrences_schedule_id_connector_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."connector_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_schedule_occurrences" ADD CONSTRAINT "connector_schedule_occurrences_connector_run_id_connector_runs_id_fk" FOREIGN KEY ("connector_run_id") REFERENCES "public"."connector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_schedule_revisions" ADD CONSTRAINT "connector_schedule_revisions_schedule_id_connector_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."connector_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_schedules" ADD CONSTRAINT "connector_schedules_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_result_polling_work" ADD CONSTRAINT "hosted_result_polling_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_result_polling_work" ADD CONSTRAINT "fk_hosted_result_polling_work_capture" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_submission_work" ADD CONSTRAINT "hosted_submission_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_submission_work" ADD CONSTRAINT "fk_hosted_submission_work_capture" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_capture_evidence_references" ADD CONSTRAINT "fk_job_capture_evidence_references_job" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_capture_evidence_references" ADD CONSTRAINT "fk_job_capture_evidence_references_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_company_assignment_history" ADD CONSTRAINT "fk_job_company_assignment_history_job" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_company_assignment_history" ADD CONSTRAINT "fk_job_company_assignment_history_company" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_company_assignment_history" ADD CONSTRAINT "fk_job_company_assignment_history_prior_company" FOREIGN KEY ("workspace_id","prior_company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_company_assignments" ADD CONSTRAINT "fk_job_company_assignments_job" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_company_assignments" ADD CONSTRAINT "fk_job_company_assignments_company" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_external_identities" ADD CONSTRAINT "fk_job_external_identities_job" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_history" ADD CONSTRAINT "fk_job_history_job" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_work" ADD CONSTRAINT "normalization_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_work" ADD CONSTRAINT "fk_normalization_work_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "fk_lifecycle_opportunities_job" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_history" ADD CONSTRAINT "fk_opportunity_history_opportunity" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_url_resolution_work" ADD CONSTRAINT "provider_url_resolution_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_url_resolution_work" ADD CONSTRAINT "fk_provider_url_resolution_work_capture" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuit_links" ADD CONSTRAINT "fk_pursuit_links_application" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_execution_sessions" ADD CONSTRAINT "source_execution_sessions_execution_scope_id_source_execution_scopes_id_fk" FOREIGN KEY ("execution_scope_id") REFERENCES "public"."source_execution_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_subject_application_id_applications_id_fk" FOREIGN KEY ("subject_application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_companies" ADD CONSTRAINT "workspace_companies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_companies" ADD CONSTRAINT "fk_workspace_companies_canonical" FOREIGN KEY ("workspace_id","merged_into_company_id") REFERENCES "public"."workspace_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_application_attempt_records_application" ON "application_attempt_records" USING btree ("application_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_application_event_records_application" ON "application_event_records" USING btree ("application_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_application_scores_application" ON "application_scores" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_applications_opportunity" ON "applications" USING btree ("workspace_id","opportunity_id") WHERE "applications"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_applications_idempotency" ON "applications" USING btree ("workspace_id","idempotency_key") WHERE "applications"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "idx_lifecycle_applications_job" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_destination_resolution_work_idempotency" ON "capture_destination_resolution_work" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_capture_destination_resolution_work_due" ON "capture_destination_resolution_work" USING btree ("status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "idx_capture_destination_resolution_work_generation" ON "capture_destination_resolution_work" USING btree ("generation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_destination_resolution_work_active_generation" ON "capture_destination_resolution_work" USING btree ("generation_id") WHERE "capture_destination_resolution_work"."status" in ('scheduled','claimed');--> statement-breakpoint
CREATE INDEX "idx_capture_effective_revision_inputs_workspace" ON "capture_effective_revision_inputs" USING btree ("workspace_id","capture_id","capture_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_evidence_items_identity" ON "capture_evidence_items" USING btree ("capture_id","capture_revision","evidence_index");--> statement-breakpoint
CREATE INDEX "idx_capture_materialization_issues_unresolved" ON "capture_materialization_issues" USING btree ("workspace_id","capture_id","capture_revision") WHERE "capture_materialization_issues"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "idx_capture_occurrences_connector_run" ON "capture_occurrences" USING btree ("connector_run_id","capture_id");--> statement-breakpoint
CREATE INDEX "idx_capture_occurrences_capture" ON "capture_occurrences" USING btree ("capture_id","capture_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_resolution_generations_ordinal" ON "capture_resolution_generations" USING btree ("capture_id","ordinal");--> statement-breakpoint
CREATE INDEX "idx_capture_resolution_generations_revision" ON "capture_resolution_generations" USING btree ("capture_id","capture_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_resolution_generations_active" ON "capture_resolution_generations" USING btree ("capture_id") WHERE "capture_resolution_generations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_capture_resolution_generations_workspace" ON "capture_resolution_generations" USING btree ("workspace_id","processing_summary","updated_at","id");--> statement-breakpoint
CREATE INDEX "idx_capture_revisions_connector_run" ON "capture_revisions" USING btree ("connector_run_id","capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_revisions_content_hash" ON "capture_revisions" USING btree ("capture_id","content_hash") WHERE "capture_revisions"."content_hash" is not null;--> statement-breakpoint
CREATE INDEX "idx_lifecycle_captures_workspace" ON "captures" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_captures_idempotency" ON "captures" USING btree ("workspace_id","idempotency_key") WHERE "captures"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_captures_provenance" ON "captures" USING btree ("workspace_id","adapter_id",coalesce("provider_schema", ''),"provider_record_id") WHERE "captures"."provider_record_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_company_aliases_company" ON "company_aliases" USING btree ("workspace_id","company_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_company_aliases_active_value" ON "company_aliases" USING btree ("company_id","normalized_value") WHERE "company_aliases"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "idx_company_aliases_duplicate_signal" ON "company_aliases" USING btree ("workspace_id","normalized_value","company_id") WHERE "company_aliases"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_company_duplicate_candidate_reviews_revision" ON "company_duplicate_candidate_reviews" USING btree ("candidate_id","candidate_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_company_duplicate_candidates_pair" ON "company_duplicate_candidates" USING btree ("workspace_id","lower_company_id","higher_company_id");--> statement-breakpoint
CREATE INDEX "idx_company_duplicate_candidates_review_queue" ON "company_duplicate_candidates" USING btree ("workspace_id","status","score" DESC NULLS LAST,"updated_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "idx_company_duplicate_candidates_lower" ON "company_duplicate_candidates" USING btree ("workspace_id","lower_company_id","status");--> statement-breakpoint
CREATE INDEX "idx_company_duplicate_candidates_higher" ON "company_duplicate_candidates" USING btree ("workspace_id","higher_company_id","status");--> statement-breakpoint
CREATE INDEX "idx_company_duplicate_maintenance_work_pending" ON "company_duplicate_maintenance_work" USING btree ("workspace_id","status","updated_at","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_company_history_sequence" ON "company_history" USING btree ("company_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_connector_capture_work_idempotency" ON "connector_capture_work" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_connector_capture_work_due" ON "connector_capture_work" USING btree ("status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "idx_connector_capture_work_subject" ON "connector_capture_work" USING btree ("connector_instance_id","filter_signature");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_connector_capture_work_active_subject" ON "connector_capture_work" USING btree ("connector_instance_id","filter_signature") WHERE "connector_capture_work"."status" in ('scheduled','claimed');--> statement-breakpoint
CREATE INDEX "idx_connector_checkpoints_instance" ON "connector_checkpoints" USING btree ("connector_instance_id");--> statement-breakpoint
CREATE INDEX "idx_connector_instances_connector" ON "connector_instances" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "idx_connector_instances_enabled" ON "connector_instances" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_connector_observations_instance" ON "connector_observations" USING btree ("connector_instance_id");--> statement-breakpoint
CREATE INDEX "idx_connector_observations_run" ON "connector_observations" USING btree ("connector_run_id");--> statement-breakpoint
CREATE INDEX "idx_connector_observations_source_record" ON "connector_observations" USING btree ("connector_instance_id","source_record_key");--> statement-breakpoint
CREATE INDEX "idx_connector_runs_instance" ON "connector_runs" USING btree ("connector_instance_id");--> statement-breakpoint
CREATE INDEX "idx_connector_runs_instance_latest" ON "connector_runs" USING btree ("connector_instance_id","started_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_connector_runs_instance_status_started" ON "connector_runs" USING btree ("connector_instance_id","status","started_at");--> statement-breakpoint
CREATE INDEX "idx_connector_schedule_events_schedule" ON "connector_schedule_events" USING btree ("schedule_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_connector_schedule_occurrences_idempotency" ON "connector_schedule_occurrences" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_connector_schedule_occurrences_schedule" ON "connector_schedule_occurrences" USING btree ("schedule_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_connector_schedule_occurrences_run" ON "connector_schedule_occurrences" USING btree ("connector_run_id");--> statement-breakpoint
CREATE INDEX "idx_connector_schedule_revisions_schedule" ON "connector_schedule_revisions" USING btree ("schedule_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_connector_schedules_instance" ON "connector_schedules" USING btree ("connector_instance_id") WHERE "connector_schedules"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_connector_schedules_next_eligible" ON "connector_schedules" USING btree ("next_eligible_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_hosted_result_polling_work_idempotency" ON "hosted_result_polling_work" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_hosted_result_polling_work_due" ON "hosted_result_polling_work" USING btree ("status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "idx_hosted_result_polling_work_subject" ON "hosted_result_polling_work" USING btree ("capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_hosted_result_polling_work_active_subject" ON "hosted_result_polling_work" USING btree ("capture_id") WHERE "hosted_result_polling_work"."status" in ('scheduled','claimed');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_hosted_submission_work_idempotency" ON "hosted_submission_work" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_hosted_submission_work_due" ON "hosted_submission_work" USING btree ("status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "idx_hosted_submission_work_subject" ON "hosted_submission_work" USING btree ("capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_hosted_submission_work_active_subject" ON "hosted_submission_work" USING btree ("capture_id") WHERE "hosted_submission_work"."status" in ('scheduled','claimed');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_capture_evidence_references_lineage" ON "job_capture_evidence_references" USING btree ("job_id","capture_id","capture_revision");--> statement-breakpoint
CREATE INDEX "idx_job_capture_evidence_references_capture" ON "job_capture_evidence_references" USING btree ("capture_id","capture_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_company_assignment_history_revision" ON "job_company_assignment_history" USING btree ("job_id","assignment_revision");--> statement-breakpoint
CREATE INDEX "idx_job_company_assignments_company" ON "job_company_assignments" USING btree ("workspace_id","company_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_external_identities_strong" ON "job_external_identities" USING btree ("kind","provider",(coalesce("account", '')),"value") WHERE "job_external_identities"."strength" = 'strong' and "job_external_identities"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_external_identities_per_job" ON "job_external_identities" USING btree ("job_id","kind","provider",(coalesce("account", '')),"value") WHERE "job_external_identities"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "idx_job_external_identities_job" ON "job_external_identities" USING btree ("job_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_history_sequence" ON "job_history" USING btree ("job_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_lifecycle_jobs_workspace" ON "jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_jobs_idempotency" ON "jobs" USING btree ("workspace_id","idempotency_key") WHERE "jobs"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_normalization_work_idempotency" ON "normalization_work" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_normalization_work_due" ON "normalization_work" USING btree ("status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "idx_normalization_work_subject" ON "normalization_work" USING btree ("capture_id","capture_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_normalization_work_active_subject" ON "normalization_work" USING btree ("capture_id","capture_revision") WHERE "normalization_work"."status" in ('scheduled','claimed');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_opportunities_job" ON "opportunities" USING btree ("workspace_id","job_id") WHERE "opportunities"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_opportunities_idempotency" ON "opportunities" USING btree ("workspace_id","idempotency_key") WHERE "opportunities"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "idx_lifecycle_opportunities_job_ref" ON "opportunities" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_policy_evidence_subject" ON "policy_evidence" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_policy_evidence_subject_tag" ON "policy_evidence" USING btree ("subject_type","subject_id","tag");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_url_resolution_work_idempotency" ON "provider_url_resolution_work" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_provider_url_resolution_work_due" ON "provider_url_resolution_work" USING btree ("status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "idx_provider_url_resolution_work_subject" ON "provider_url_resolution_work" USING btree ("capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_url_resolution_work_active_subject" ON "provider_url_resolution_work" USING btree ("capture_id") WHERE "provider_url_resolution_work"."status" in ('scheduled','claimed');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pursuit_links_primary" ON "pursuit_links" USING btree ("application_id") WHERE "pursuit_links"."is_primary";--> statement-breakpoint
CREATE INDEX "idx_pursuit_links_application" ON "pursuit_links" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "idx_source_execution_scopes_availability" ON "source_execution_scopes" USING btree ("status","blocked_until");--> statement-breakpoint
CREATE INDEX "idx_sources_name" ON "sources" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_source_id" ON "workflow_runs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_source_type_status_started" ON "workflow_runs" USING btree ("source_id","run_type","status","started_at");--> statement-breakpoint
CREATE INDEX "idx_workspace_companies_directory" ON "workspace_companies" USING btree ("workspace_id","normalized_display_name","id");--> statement-breakpoint
CREATE INDEX "idx_workspace_companies_status" ON "workspace_companies" USING btree ("workspace_id","status","normalized_display_name","id");--> statement-breakpoint
CREATE INDEX "idx_workspace_companies_website_host" ON "workspace_companies" USING btree ("workspace_id","website_host","id") WHERE "workspace_companies"."website_host" is not null;
--> statement-breakpoint
-- Database safeguards that Drizzle Kit 0.31 cannot model.
--
-- Drizzle Kit's PostgreSQL schema language has no trigger or function primitive:
-- pgTable() accepts columns, checks, indexes, and foreign keys only, and the
-- generator's snapshot format has no place to record a pg_proc/pg_trigger entry.
-- Everything else in the baseline comes from src/db/schema.ts through
-- `pnpm db:generate`; these statements are the only lower-level escape hatch, and
-- scripts/generate-database-baseline.ts appends this file verbatim to the one
-- generated baseline so they ship as part of the same journal entry.
--
-- src/db/pglite.baseline.test.ts proves the installed inventory and behavior on a
-- fresh database.

-- Append-only history. Capture revisions and evidence occurrences, job identity
-- and history records, and opportunity/application history are audit trails: the
-- aggregate root carries current state, so an update or delete here would rewrite
-- what was observed.
CREATE OR REPLACE FUNCTION raise_capture_revisions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'capture revisions are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_capture_evidence_items_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'capture evidence occurrences are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_job_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'job history is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_opportunity_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'opportunity history is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_application_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'application history is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_job_external_identities_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'job external identities are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Identity removal is the one permitted mutation, and only in the null -> set
-- direction with every other column unchanged.
CREATE OR REPLACE FUNCTION enforce_job_external_identities_update() RETURNS trigger AS $$
BEGIN
  IF OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.job_id IS NOT DISTINCT FROM OLD.job_id
     AND NEW.kind IS NOT DISTINCT FROM OLD.kind
     AND NEW.provider IS NOT DISTINCT FROM OLD.provider
     AND NEW.account IS NOT DISTINCT FROM OLD.account
     AND NEW.value IS NOT DISTINCT FROM OLD.value
     AND NEW.strength IS NOT DISTINCT FROM OLD.strength
     AND NEW.provenance_kind IS NOT DISTINCT FROM OLD.provenance_kind
     AND NEW.provenance_version IS NOT DISTINCT FROM OLD.provenance_version
     AND NEW.evidence_json IS NOT DISTINCT FROM OLD.evidence_json
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'job external identities are append-only except one-way removal';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Lineage and workspace ownership. A foreign key can bind a row to one parent,
-- but not assert that two independently referenced parents agree on the workspace
-- (or, for an application, on the job) they belong to.
CREATE OR REPLACE FUNCTION enforce_job_capture_reference_workspace() RETURNS trigger AS $$
DECLARE job_workspace text; capture_workspace text;
BEGIN
  SELECT workspace_id INTO job_workspace FROM jobs WHERE id = NEW.job_id;
  SELECT workspace_id INTO capture_workspace FROM captures WHERE id = NEW.capture_id;
  IF job_workspace IS DISTINCT FROM capture_workspace THEN RAISE EXCEPTION 'job capture lineage workspace ownership mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_opportunity_job_workspace() RETURNS trigger AS $$
DECLARE job_workspace text;
BEGIN
  SELECT workspace_id INTO job_workspace FROM jobs WHERE id = NEW.job_id;
  IF job_workspace IS DISTINCT FROM NEW.workspace_id THEN RAISE EXCEPTION 'opportunity job workspace ownership mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_application_lineage() RETURNS trigger AS $$
DECLARE opportunity_job text; opportunity_workspace text;
BEGIN
  SELECT job_id, workspace_id INTO opportunity_job, opportunity_workspace FROM opportunities WHERE id = NEW.opportunity_id;
  IF opportunity_job IS DISTINCT FROM NEW.job_id OR opportunity_workspace IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'application opportunity and job lineage mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Connector execution-scope identity and ownership. A foreign key binds each
-- execution-scope reference, but cannot hold the scope fixed for an instance's
-- lifetime, nor assert that a run's scope is the one its instance belongs to.
CREATE OR REPLACE FUNCTION enforce_connector_instance_scope_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.execution_scope_id IS DISTINCT FROM OLD.execution_scope_id THEN
    RAISE EXCEPTION 'connector instance scope identity immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_connector_run_scope_owner() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM connector_instances WHERE id = NEW.connector_instance_id AND execution_scope_id = NEW.execution_scope_id) THEN
    RAISE EXCEPTION 'connector run scope owner mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_capture_revisions_no_update BEFORE UPDATE ON capture_revisions FOR EACH ROW EXECUTE FUNCTION raise_capture_revisions_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_capture_revisions_no_delete BEFORE DELETE ON capture_revisions FOR EACH ROW EXECUTE FUNCTION raise_capture_revisions_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_capture_evidence_items_no_update BEFORE UPDATE ON capture_evidence_items FOR EACH ROW EXECUTE FUNCTION raise_capture_evidence_items_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_capture_evidence_items_no_delete BEFORE DELETE ON capture_evidence_items FOR EACH ROW EXECUTE FUNCTION raise_capture_evidence_items_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_job_history_no_update BEFORE UPDATE ON job_history FOR EACH ROW EXECUTE FUNCTION raise_job_history_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_job_history_no_delete BEFORE DELETE ON job_history FOR EACH ROW EXECUTE FUNCTION raise_job_history_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_opportunity_history_no_update BEFORE UPDATE ON opportunity_history FOR EACH ROW EXECUTE FUNCTION raise_opportunity_history_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_opportunity_history_no_delete BEFORE DELETE ON opportunity_history FOR EACH ROW EXECUTE FUNCTION raise_opportunity_history_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_application_history_no_update BEFORE UPDATE ON application_history FOR EACH ROW EXECUTE FUNCTION raise_application_history_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_application_history_no_delete BEFORE DELETE ON application_history FOR EACH ROW EXECUTE FUNCTION raise_application_history_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_job_external_identities_update BEFORE UPDATE ON job_external_identities FOR EACH ROW EXECUTE FUNCTION enforce_job_external_identities_update();
--> statement-breakpoint
CREATE TRIGGER trg_job_external_identities_no_delete BEFORE DELETE ON job_external_identities FOR EACH ROW EXECUTE FUNCTION raise_job_external_identities_no_delete();
--> statement-breakpoint
CREATE TRIGGER trg_job_capture_evidence_references_workspace_insert BEFORE INSERT ON job_capture_evidence_references FOR EACH ROW EXECUTE FUNCTION enforce_job_capture_reference_workspace();
--> statement-breakpoint
CREATE TRIGGER trg_job_capture_evidence_references_workspace_update BEFORE UPDATE ON job_capture_evidence_references FOR EACH ROW EXECUTE FUNCTION enforce_job_capture_reference_workspace();
--> statement-breakpoint
CREATE TRIGGER trg_opportunities_workspace_insert BEFORE INSERT ON opportunities FOR EACH ROW EXECUTE FUNCTION enforce_opportunity_job_workspace();
--> statement-breakpoint
CREATE TRIGGER trg_opportunities_workspace_update BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION enforce_opportunity_job_workspace();
--> statement-breakpoint
CREATE TRIGGER trg_applications_lineage_insert BEFORE INSERT ON applications FOR EACH ROW EXECUTE FUNCTION enforce_application_lineage();
--> statement-breakpoint
CREATE TRIGGER trg_applications_lineage_update BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION enforce_application_lineage();
--> statement-breakpoint
CREATE TRIGGER connector_instances_scope_immutable BEFORE UPDATE OF execution_scope_id ON connector_instances FOR EACH ROW EXECUTE FUNCTION enforce_connector_instance_scope_immutable();
--> statement-breakpoint
CREATE TRIGGER connector_runs_scope_owner_insert BEFORE INSERT ON connector_runs FOR EACH ROW EXECUTE FUNCTION enforce_connector_run_scope_owner();
--> statement-breakpoint
CREATE TRIGGER connector_runs_scope_owner_update BEFORE UPDATE OF execution_scope_id, connector_instance_id ON connector_runs FOR EACH ROW EXECUTE FUNCTION enforce_connector_run_scope_owner();
