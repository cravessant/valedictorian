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
CREATE TABLE "capture_revisions" (
	"capture_id" text NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"snapshot_json" text NOT NULL,
	"audit_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "capture_revisions_pk" PRIMARY KEY("capture_id","revision"),
	CONSTRAINT "chk_capture_revisions_revision" CHECK ("capture_revisions"."revision" > 0),
	CONSTRAINT "chk_capture_revisions_kind" CHECK ("capture_revisions"."kind" in ('created','corrected','removed','restored')),
	CONSTRAINT "chk_capture_revisions_snapshot_bound" CHECK (length("capture_revisions"."snapshot_json") <= 262144),
	CONSTRAINT "chk_capture_revisions_audit_bound" CHECK (length("capture_revisions"."audit_json") <= 16384),
	CONSTRAINT "chk_capture_revisions_audit_keys" CHECK ("capture_revisions"."audit_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')
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
	CONSTRAINT "chk_connector_capture_work_filter" CHECK (length("connector_capture_work"."filter_signature") between 1 and 512),
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
CREATE TABLE "lifecycle_applications" (
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
	CONSTRAINT "chk_lifecycle_applications_workspace" CHECK (length("lifecycle_applications"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_lifecycle_applications_revision" CHECK ("lifecycle_applications"."revision" > 0),
	CONSTRAINT "chk_lifecycle_applications_status" CHECK ("lifecycle_applications"."status" in ('active','submitted','interviewing','offered','withdrawn','rejected','accepted')),
	CONSTRAINT "chk_lifecycle_applications_job_facts_revision" CHECK ("lifecycle_applications"."job_facts_revision" > 0),
	CONSTRAINT "chk_lifecycle_applications_snapshot_bound" CHECK (length("lifecycle_applications"."snapshot_json") <= 262144),
	CONSTRAINT "chk_lifecycle_applications_company" CHECK (length("lifecycle_applications"."company_name") between 1 and 500),
	CONSTRAINT "chk_lifecycle_applications_source" CHECK (length("lifecycle_applications"."source_name") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "lifecycle_captures" (
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
	CONSTRAINT "chk_lifecycle_captures_workspace" CHECK (length("lifecycle_captures"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_lifecycle_captures_evidence_mode" CHECK ("lifecycle_captures"."evidence_mode" in ('reported','ats_details_provided')),
	CONSTRAINT "chk_lifecycle_captures_adapter_kind" CHECK ("lifecycle_captures"."adapter_kind" in ('connector','cli','manual','import')),
	CONSTRAINT "chk_lifecycle_captures_adapter_version" CHECK (length("lifecycle_captures"."adapter_version") between 1 and 100),
	CONSTRAINT "chk_lifecycle_captures_provider_record" CHECK ("lifecycle_captures"."provider_record_id" is null or length("lifecycle_captures"."provider_record_id") between 1 and 500),
	CONSTRAINT "chk_lifecycle_captures_provider_schema" CHECK ("lifecycle_captures"."provider_schema" is null or length("lifecycle_captures"."provider_schema") between 1 and 500),
	CONSTRAINT "chk_lifecycle_captures_payload_bound" CHECK ("lifecycle_captures"."payload_json" is null or length("lifecycle_captures"."payload_json") <= 262144),
	CONSTRAINT "chk_lifecycle_captures_payload_keys" CHECK ("lifecycle_captures"."payload_json" is null or "lifecycle_captures"."payload_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:'),
	CONSTRAINT "chk_lifecycle_captures_revision" CHECK ("lifecycle_captures"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "lifecycle_jobs" (
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
	CONSTRAINT "chk_lifecycle_jobs_id" CHECK ("lifecycle_jobs"."id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "chk_lifecycle_jobs_workspace" CHECK (length("lifecycle_jobs"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_lifecycle_jobs_facts_revision" CHECK ("lifecycle_jobs"."facts_revision" > 0),
	CONSTRAINT "chk_lifecycle_jobs_facts_bound" CHECK (length("lifecycle_jobs"."facts_json") <= 262144),
	CONSTRAINT "chk_lifecycle_jobs_availability_state" CHECK ("lifecycle_jobs"."availability_state" in ('open','closed','unknown')),
	CONSTRAINT "chk_lifecycle_jobs_availability_revision" CHECK ("lifecycle_jobs"."availability_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "lifecycle_migration_report" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"source_table" text NOT NULL,
	"source_id" text NOT NULL,
	"reason" text NOT NULL,
	"detail_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_lifecycle_migration_report_category" CHECK ("lifecycle_migration_report"."category" in ('reset','quarantine','synthesized')),
	CONSTRAINT "chk_lifecycle_migration_report_source_table" CHECK (length("lifecycle_migration_report"."source_table") between 1 and 128),
	CONSTRAINT "chk_lifecycle_migration_report_source_id" CHECK (length("lifecycle_migration_report"."source_id") between 1 and 256),
	CONSTRAINT "chk_lifecycle_migration_report_reason" CHECK (length("lifecycle_migration_report"."reason") between 1 and 512),
	CONSTRAINT "chk_lifecycle_migration_report_detail_bound" CHECK (length("lifecycle_migration_report"."detail_json") <= 16384),
	CONSTRAINT "chk_lifecycle_migration_report_detail_keys" CHECK ("lifecycle_migration_report"."detail_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:')
);
--> statement-breakpoint
CREATE TABLE "lifecycle_opportunities" (
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
	CONSTRAINT "chk_lifecycle_opportunities_workspace" CHECK (length("lifecycle_opportunities"."workspace_id") between 1 and 200),
	CONSTRAINT "chk_lifecycle_opportunities_revision" CHECK ("lifecycle_opportunities"."revision" > 0),
	CONSTRAINT "chk_lifecycle_opportunities_fit" CHECK ("lifecycle_opportunities"."fit" in ('fit','possible','not_fit','unknown')),
	CONSTRAINT "chk_lifecycle_opportunities_rank" CHECK ("lifecycle_opportunities"."rank" is null or "lifecycle_opportunities"."rank" > 0),
	CONSTRAINT "chk_lifecycle_opportunities_cutoff" CHECK ("lifecycle_opportunities"."cutoff" in ('above','below','not_evaluated')),
	CONSTRAINT "chk_lifecycle_opportunities_disposition" CHECK ("lifecycle_opportunities"."disposition" in ('reviewing','pursue','hold','declined','archived')),
	CONSTRAINT "chk_lifecycle_opportunities_override_bound" CHECK ("lifecycle_opportunities"."override_json" is null or length("lifecycle_opportunities"."override_json") <= 16384)
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
ALTER TABLE "application_attempt_records" ADD CONSTRAINT "fk_application_attempt_records_application" FOREIGN KEY ("application_id") REFERENCES "public"."lifecycle_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_event_records" ADD CONSTRAINT "application_event_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_event_records" ADD CONSTRAINT "fk_application_event_records_application" FOREIGN KEY ("application_id") REFERENCES "public"."lifecycle_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_history" ADD CONSTRAINT "fk_application_history_application" FOREIGN KEY ("application_id") REFERENCES "public"."lifecycle_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_evidence_items" ADD CONSTRAINT "fk_capture_evidence_items_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD CONSTRAINT "fk_capture_revisions_capture" FOREIGN KEY ("capture_id") REFERENCES "public"."lifecycle_captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_capture_work" ADD CONSTRAINT "connector_capture_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_capture_work" ADD CONSTRAINT "fk_connector_capture_work_instance" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_result_polling_work" ADD CONSTRAINT "hosted_result_polling_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_result_polling_work" ADD CONSTRAINT "fk_hosted_result_polling_work_capture" FOREIGN KEY ("capture_id") REFERENCES "public"."lifecycle_captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_submission_work" ADD CONSTRAINT "hosted_submission_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_submission_work" ADD CONSTRAINT "fk_hosted_submission_work_capture" FOREIGN KEY ("capture_id") REFERENCES "public"."lifecycle_captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_capture_evidence_references" ADD CONSTRAINT "fk_job_capture_evidence_references_job" FOREIGN KEY ("job_id") REFERENCES "public"."lifecycle_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_capture_evidence_references" ADD CONSTRAINT "fk_job_capture_evidence_references_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_external_identities" ADD CONSTRAINT "fk_job_external_identities_job" FOREIGN KEY ("job_id") REFERENCES "public"."lifecycle_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_history" ADD CONSTRAINT "fk_job_history_job" FOREIGN KEY ("job_id") REFERENCES "public"."lifecycle_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_applications" ADD CONSTRAINT "lifecycle_applications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_applications" ADD CONSTRAINT "fk_lifecycle_applications_opportunity" FOREIGN KEY ("opportunity_id") REFERENCES "public"."lifecycle_opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_applications" ADD CONSTRAINT "fk_lifecycle_applications_job" FOREIGN KEY ("job_id") REFERENCES "public"."lifecycle_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_captures" ADD CONSTRAINT "lifecycle_captures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_jobs" ADD CONSTRAINT "lifecycle_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_opportunities" ADD CONSTRAINT "lifecycle_opportunities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_opportunities" ADD CONSTRAINT "fk_lifecycle_opportunities_job" FOREIGN KEY ("job_id") REFERENCES "public"."lifecycle_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_work" ADD CONSTRAINT "normalization_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_work" ADD CONSTRAINT "fk_normalization_work_revision" FOREIGN KEY ("capture_id","capture_revision") REFERENCES "public"."capture_revisions"("capture_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_history" ADD CONSTRAINT "fk_opportunity_history_opportunity" FOREIGN KEY ("opportunity_id") REFERENCES "public"."lifecycle_opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_url_resolution_work" ADD CONSTRAINT "provider_url_resolution_work_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_url_resolution_work" ADD CONSTRAINT "fk_provider_url_resolution_work_capture" FOREIGN KEY ("capture_id") REFERENCES "public"."lifecycle_captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuit_links" ADD CONSTRAINT "fk_pursuit_links_application" FOREIGN KEY ("application_id") REFERENCES "public"."lifecycle_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_application_attempt_records_application" ON "application_attempt_records" USING btree ("application_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_application_event_records_application" ON "application_event_records" USING btree ("application_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_evidence_items_identity" ON "capture_evidence_items" USING btree ("capture_id","capture_revision","evidence_index");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_connector_capture_work_idempotency" ON "connector_capture_work" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_connector_capture_work_due" ON "connector_capture_work" USING btree ("status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "idx_connector_capture_work_subject" ON "connector_capture_work" USING btree ("connector_instance_id","filter_signature");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_connector_capture_work_active_subject" ON "connector_capture_work" USING btree ("connector_instance_id","filter_signature") WHERE "connector_capture_work"."status" in ('scheduled','claimed');--> statement-breakpoint
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
CREATE UNIQUE INDEX "idx_job_external_identities_strong" ON "job_external_identities" USING btree ("kind","provider",(coalesce("account", '')),"value") WHERE "job_external_identities"."strength" = 'strong' and "job_external_identities"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_external_identities_per_job" ON "job_external_identities" USING btree ("job_id","kind","provider",(coalesce("account", '')),"value") WHERE "job_external_identities"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "idx_job_external_identities_job" ON "job_external_identities" USING btree ("job_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_history_sequence" ON "job_history" USING btree ("job_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_applications_opportunity" ON "lifecycle_applications" USING btree ("workspace_id","opportunity_id") WHERE "lifecycle_applications"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "idx_lifecycle_applications_job" ON "lifecycle_applications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_lifecycle_captures_workspace" ON "lifecycle_captures" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_lifecycle_jobs_workspace" ON "lifecycle_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_lifecycle_migration_report_category" ON "lifecycle_migration_report" USING btree ("category","source_table");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lifecycle_opportunities_job" ON "lifecycle_opportunities" USING btree ("workspace_id","job_id") WHERE "lifecycle_opportunities"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "idx_lifecycle_opportunities_job_ref" ON "lifecycle_opportunities" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_normalization_work_idempotency" ON "normalization_work" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_normalization_work_due" ON "normalization_work" USING btree ("status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "idx_normalization_work_subject" ON "normalization_work" USING btree ("capture_id","capture_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_normalization_work_active_subject" ON "normalization_work" USING btree ("capture_id","capture_revision") WHERE "normalization_work"."status" in ('scheduled','claimed');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_url_resolution_work_idempotency" ON "provider_url_resolution_work" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_provider_url_resolution_work_due" ON "provider_url_resolution_work" USING btree ("status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "idx_provider_url_resolution_work_subject" ON "provider_url_resolution_work" USING btree ("capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_url_resolution_work_active_subject" ON "provider_url_resolution_work" USING btree ("capture_id") WHERE "provider_url_resolution_work"."status" in ('scheduled','claimed');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pursuit_links_primary" ON "pursuit_links" USING btree ("application_id") WHERE "pursuit_links"."is_primary";--> statement-breakpoint
CREATE INDEX "idx_pursuit_links_application" ON "pursuit_links" USING btree ("application_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_capture_evidence_items_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'capture evidence occurrences are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_capture_revisions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'capture revisions are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
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
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_job_external_identities_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'job external identities are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_job_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'job history is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_job_capture_reference_workspace() RETURNS trigger AS $$
DECLARE
  job_workspace text;
  capture_workspace text;
BEGIN
  SELECT workspace_id INTO job_workspace FROM lifecycle_jobs WHERE id = NEW.job_id;
  SELECT workspace_id INTO capture_workspace FROM lifecycle_captures WHERE id = NEW.capture_id;
  IF job_workspace IS DISTINCT FROM capture_workspace THEN
    RAISE EXCEPTION 'job capture lineage workspace ownership mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_opportunity_job_workspace() RETURNS trigger AS $$
DECLARE
  job_workspace text;
BEGIN
  SELECT workspace_id INTO job_workspace FROM lifecycle_jobs WHERE id = NEW.job_id;
  IF job_workspace IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'opportunity job workspace ownership mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_application_lineage() RETURNS trigger AS $$
DECLARE
  opportunity_job text;
  opportunity_workspace text;
BEGIN
  SELECT job_id, workspace_id INTO opportunity_job, opportunity_workspace
    FROM lifecycle_opportunities WHERE id = NEW.opportunity_id;
  IF opportunity_job IS DISTINCT FROM NEW.job_id OR opportunity_workspace IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'application opportunity and job lineage mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_opportunity_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'opportunity history is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_application_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'application history is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_capture_evidence_items_no_update BEFORE UPDATE ON capture_evidence_items FOR EACH ROW EXECUTE FUNCTION raise_capture_evidence_items_append_only();--> statement-breakpoint
CREATE TRIGGER trg_capture_evidence_items_no_delete BEFORE DELETE ON capture_evidence_items FOR EACH ROW EXECUTE FUNCTION raise_capture_evidence_items_append_only();--> statement-breakpoint
CREATE TRIGGER trg_capture_revisions_no_update BEFORE UPDATE ON capture_revisions FOR EACH ROW EXECUTE FUNCTION raise_capture_revisions_append_only();--> statement-breakpoint
CREATE TRIGGER trg_capture_revisions_no_delete BEFORE DELETE ON capture_revisions FOR EACH ROW EXECUTE FUNCTION raise_capture_revisions_append_only();--> statement-breakpoint
CREATE TRIGGER trg_job_external_identities_update BEFORE UPDATE ON job_external_identities FOR EACH ROW EXECUTE FUNCTION enforce_job_external_identities_update();--> statement-breakpoint
CREATE TRIGGER trg_job_external_identities_no_delete BEFORE DELETE ON job_external_identities FOR EACH ROW EXECUTE FUNCTION raise_job_external_identities_no_delete();--> statement-breakpoint
CREATE TRIGGER trg_job_history_no_update BEFORE UPDATE ON job_history FOR EACH ROW EXECUTE FUNCTION raise_job_history_append_only();--> statement-breakpoint
CREATE TRIGGER trg_job_history_no_delete BEFORE DELETE ON job_history FOR EACH ROW EXECUTE FUNCTION raise_job_history_append_only();--> statement-breakpoint
CREATE TRIGGER trg_job_capture_evidence_references_workspace_insert BEFORE INSERT ON job_capture_evidence_references FOR EACH ROW EXECUTE FUNCTION enforce_job_capture_reference_workspace();--> statement-breakpoint
CREATE TRIGGER trg_job_capture_evidence_references_workspace_update BEFORE UPDATE ON job_capture_evidence_references FOR EACH ROW EXECUTE FUNCTION enforce_job_capture_reference_workspace();--> statement-breakpoint
CREATE TRIGGER trg_lifecycle_opportunities_workspace_insert BEFORE INSERT ON lifecycle_opportunities FOR EACH ROW EXECUTE FUNCTION enforce_opportunity_job_workspace();--> statement-breakpoint
CREATE TRIGGER trg_lifecycle_opportunities_workspace_update BEFORE UPDATE ON lifecycle_opportunities FOR EACH ROW EXECUTE FUNCTION enforce_opportunity_job_workspace();--> statement-breakpoint
CREATE TRIGGER trg_lifecycle_applications_lineage_insert BEFORE INSERT ON lifecycle_applications FOR EACH ROW EXECUTE FUNCTION enforce_application_lineage();--> statement-breakpoint
CREATE TRIGGER trg_lifecycle_applications_lineage_update BEFORE UPDATE ON lifecycle_applications FOR EACH ROW EXECUTE FUNCTION enforce_application_lineage();--> statement-breakpoint
CREATE TRIGGER trg_opportunity_history_no_update BEFORE UPDATE ON opportunity_history FOR EACH ROW EXECUTE FUNCTION raise_opportunity_history_append_only();--> statement-breakpoint
CREATE TRIGGER trg_opportunity_history_no_delete BEFORE DELETE ON opportunity_history FOR EACH ROW EXECUTE FUNCTION raise_opportunity_history_append_only();--> statement-breakpoint
CREATE TRIGGER trg_application_history_no_update BEFORE UPDATE ON application_history FOR EACH ROW EXECUTE FUNCTION raise_application_history_append_only();--> statement-breakpoint
CREATE TRIGGER trg_application_history_no_delete BEFORE DELETE ON application_history FOR EACH ROW EXECUTE FUNCTION raise_application_history_append_only();
--> statement-breakpoint
-- ===================== #298 Round E data transform =====================
-- Runs inside the single 0001 migration transaction (drizzle pg-core wraps all
-- statements in one session.transaction), so any failure rolls the whole
-- migration back to the baseline. Legacy tables are read-only here; they are
-- dropped in the consolidation round. Registry-id mapping: per-workspace DB with
-- no in-DB registry, so one deterministic nil-UUID default workspace is seeded
-- and every pre-lifecycle row is backfilled to it (see workspaces.schema.ts).
INSERT INTO "workspaces" ("id", "name", "created_at", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000000', 'default', '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z');
--> statement-breakpoint
-- Deterministic UUIDv7-shaped mint from a legacy id (version nibble 7, variant 8).
-- Independent of provider/ATS identity; stable per legacy id. Dropped at the end.
CREATE FUNCTION mint_job_uuid(legacy text, created_at text) RETURNS text AS $$
  -- UUIDv7: leading 48 timestamp bits from the row's created_at (k-sortable by real
  -- creation order); the version/variant nibbles are fixed and the random fields are
  -- md5-derived from the legacy id. IMMUTABLE per (legacy id, created_at).
  SELECT lower(
    substr(ts, 1, 8) || '-' || substr(ts, 9, 4) || '-7' || substr(md5($1), 1, 3)
      || '-8' || substr(md5($1), 4, 3) || '-' || substr(md5($1), 7, 12)
  ) FROM (SELECT lpad(to_hex((extract(epoch from ($2)::timestamptz) * 1000)::bigint), 12, '0') AS ts) t;
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
-- Deterministic legacy-id -> minted-id map (real jobs + one synthesized id per
-- application), so every reference to a Job mints consistently.
CREATE TABLE "_job_id_map" ("legacy_id" text PRIMARY KEY, "new_id" text NOT NULL);
--> statement-breakpoint
INSERT INTO "_job_id_map" SELECT j."id", mint_job_uuid(j."id", j."created_at") FROM "jobs" j;
--> statement-breakpoint
INSERT INTO "_job_id_map" SELECT 'synth:' || app."id", mint_job_uuid('synth:' || app."id", app."created_at") FROM "applications" app;
--> statement-breakpoint
-- ===================== Captures =====================
-- Capture roots: one per legacy capture_lineage, from its latest evidence version.
-- evidence_mode defaults to 'reported' (legacy had no evidence mode). Oversized or
-- forbidden-key payloads are reset to NULL and reported.
INSERT INTO "lifecycle_captures" (
  "id", "workspace_id", "evidence_mode", "adapter_id", "adapter_kind", "adapter_version",
  "observed_at", "received_at", "provider_record_id", "provider_schema", "payload_json",
  "revision", "created_at", "updated_at"
)
SELECT cl."id", '00000000-0000-0000-0000-000000000000', 'reported', left(cev."adapter_id", 200),
  CASE WHEN cev."adapter_kind" IN ('connector','cli','manual','import') THEN cev."adapter_kind" ELSE 'connector' END,
  left(cev."adapter_version", 100), cev."observed_at", cev."observed_at",
  CASE WHEN cev."provider_record_id" IS NULL THEN NULL ELSE left(cev."provider_record_id", 500) END,
  CASE WHEN cev."provider_schema" IS NULL THEN NULL ELSE left(cev."provider_schema", 500) END,
  CASE WHEN cev."payload_json" IS NOT NULL AND length(cev."payload_json") <= 262144
    AND cev."payload_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:'
    THEN cev."payload_json" ELSE NULL END,
  cev."revision", cl."created_at", cl."created_at"
FROM "capture_lineages" cl
JOIN "capture_evidence_versions" cev ON cev."capture_lineage_id" = cl."id"
WHERE cev."revision" = (SELECT max("revision") FROM "capture_evidence_versions" WHERE "capture_lineage_id" = cl."id");
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT 'capture_payload:' || cl."id", 'reset', 'capture_evidence_versions', cev."id",
  'payload exceeded bound or contained a forbidden key; reset to null', '{"field":"payload_json"}', '2026-07-20T00:00:00.000Z'
FROM "capture_lineages" cl
JOIN "capture_evidence_versions" cev ON cev."capture_lineage_id" = cl."id"
WHERE cev."revision" = (SELECT max("revision") FROM "capture_evidence_versions" WHERE "capture_lineage_id" = cl."id")
  AND cev."payload_json" IS NOT NULL
  AND (length(cev."payload_json") > 262144 OR cev."payload_json" ~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:');
--> statement-breakpoint
-- Capture revisions: one per legacy evidence version, with a bounded provenance snapshot.
INSERT INTO "capture_revisions" ("capture_id", "revision", "kind", "snapshot_json", "audit_json", "created_at")
SELECT cev."capture_lineage_id", cev."revision",
  CASE WHEN cev."revision" = (SELECT min("revision") FROM "capture_evidence_versions" WHERE "capture_lineage_id" = cev."capture_lineage_id") THEN 'created' ELSE 'corrected' END,
  json_build_object('revision', cev."revision", 'contentHash', cev."content_hash", 'adapterId', cev."adapter_id",
    'adapterVersion', cev."adapter_version", 'observedAt', cev."observed_at", 'providerRecordId', cev."provider_record_id")::text,
  '{}', cev."created_at"
FROM "capture_evidence_versions" cev
WHERE EXISTS (SELECT 1 FROM "capture_lineages" cl WHERE cl."id" = cev."capture_lineage_id");
--> statement-breakpoint
-- Capture evidence items: faithful element-wise extraction (Option A), capped at 50,
-- object elements only, sanitized and bounded. Every dropped element is reported.
INSERT INTO "capture_evidence_items" ("id", "capture_id", "capture_revision", "evidence_index", "kind", "label", "value_json", "created_at")
SELECT cev."id" || ':' || (e.ord - 1), cev."capture_lineage_id", cev."revision", (e.ord - 1)::int,
  left(coalesce(nullif(e.elem->>'kind', ''), 'evidence'), 100),
  left(coalesce(nullif(e.elem->>'label', ''), 'evidence'), 200),
  e.elem::text, cev."created_at"
FROM "capture_evidence_versions" cev,
  LATERAL jsonb_array_elements((CASE WHEN pg_input_is_valid(cev."evidence_json", 'jsonb') THEN cev."evidence_json"::jsonb ELSE '[]'::jsonb END)) WITH ORDINALITY AS e(elem, ord)
WHERE e.ord <= 50
  AND jsonb_typeof(e.elem) = 'object'
  AND length(e.elem::text) <= 16384
  AND e.elem::text !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:';
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT cev."id" || ':drop:' || e.ord, 'reset', 'capture_evidence_versions', cev."id",
  CASE
    WHEN e.ord > 50 THEN 'evidence item beyond the 50-per-revision cap'
    WHEN jsonb_typeof(e.elem) <> 'object' THEN 'malformed (non-object) evidence element'
    WHEN length(e.elem::text) > 16384 THEN 'evidence element exceeded value bound'
    ELSE 'evidence element contained a forbidden key'
  END,
  json_build_object('revision', cev."revision", 'index', (e.ord - 1))::text, '2026-07-20T00:00:00.000Z'
FROM "capture_evidence_versions" cev,
  LATERAL jsonb_array_elements((CASE WHEN pg_input_is_valid(cev."evidence_json", 'jsonb') THEN cev."evidence_json"::jsonb ELSE '[]'::jsonb END)) WITH ORDINALITY AS e(elem, ord)
WHERE e.ord > 50
  OR jsonb_typeof(e.elem) <> 'object'
  OR length(e.elem::text) > 16384
  OR e.elem::text ~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:';
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT cev."id" || ':invalid-evidence', 'reset', 'capture_evidence_versions', cev."id",
  'evidence_json is not valid JSON; evidence items not extracted',
  json_build_object('revision', cev."revision")::text, '2026-07-20T00:00:00.000Z'
FROM "capture_evidence_versions" cev
WHERE NOT pg_input_is_valid(cev."evidence_json", 'jsonb');
--> statement-breakpoint
-- ===================== Jobs =====================
-- Job roots: mint a UUIDv7 per legacy job; facts from the latest job_fact_versions
-- (sanitized/bounded, else reset to {}); availability defaults to unknown.
INSERT INTO "lifecycle_jobs" (
  "id", "workspace_id", "facts_revision", "facts_json", "availability_state",
  "availability_observed_at", "availability_revision", "created_at", "updated_at"
)
SELECT (SELECT m."new_id" FROM "_job_id_map" m WHERE m."legacy_id" = j."id"), '00000000-0000-0000-0000-000000000000', 1,
  coalesce((
    SELECT CASE WHEN length(jfv."job_fact_version_json") <= 262144
        AND jfv."job_fact_version_json" !~* '"[^"]*(authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn)[^"]*"[[:space:]]*:'
      THEN jfv."job_fact_version_json" ELSE '{}' END
    FROM "job_fact_versions" jfv WHERE jfv."job_id" = j."id" ORDER BY jfv."created_at" DESC, jfv."id" DESC LIMIT 1
  ), '{}'),
  'unknown', j."created_at", 1, j."created_at", j."created_at"
FROM "jobs" j;
--> statement-breakpoint
-- Job external identities: the legacy primary tuple, provider board records mapped to
-- 'posting' and canonical destinations/aliases to 'canonical_destination'. No legacy row
-- carries an ATS account, so every migrated identity is provisional (account null).
INSERT INTO "job_external_identities" (
  "id", "job_id", "kind", "provider", "account", "value", "strength",
  "provenance_kind", "provenance_version", "evidence_json", "created_at"
)
SELECT j."id" || ':primary', (SELECT m."new_id" FROM "_job_id_map" m WHERE m."legacy_id" = j."id"),
  CASE j."identity_kind" WHEN 'provider_job' THEN 'posting' WHEN 'destination_url' THEN 'canonical_destination' ELSE 'posting' END,
  lower(left(j."identity_namespace", 200)), NULL, left(j."identity_value", 2048), 'provisional',
  'primary_backfill', '1', '{}', j."created_at"
FROM "jobs" j
ON CONFLICT ("kind", "provider", (coalesce("account", '')), "value") WHERE "strength" = 'strong' AND "removed_at" IS NULL DO NOTHING;
--> statement-breakpoint
INSERT INTO "job_external_identities" (
  "id", "job_id", "kind", "provider", "account", "value", "strength",
  "provenance_kind", "provenance_version", "evidence_json", "created_at"
)
SELECT ji."id", (SELECT m."new_id" FROM "_job_id_map" m WHERE m."legacy_id" = ji."job_id"),
  CASE ji."identity_kind"
    WHEN 'provider_job' THEN 'posting'
    WHEN 'intermediary_alias' THEN 'posting'
    ELSE 'canonical_destination' END,
  lower(left(ji."identity_namespace", 200)), NULL, left(ji."identity_value", 2048), 'provisional',
  CASE WHEN ji."provenance_kind" IN ('primary_backfill','capture','normalization') THEN ji."provenance_kind" ELSE 'capture' END,
  left(ji."provenance_version", 128), '{}', ji."created_at"
FROM "job_identities" ji
ON CONFLICT ("job_id", "kind", "provider", (coalesce("account", '')), "value") WHERE "removed_at" IS NULL DO NOTHING;
--> statement-breakpoint
-- Single Capture->Job lineage owner. Divergence: when capture_lineages.job_id differs
-- from job_fact_versions.job_id, keep the facts-version side and quarantine the capture side.
INSERT INTO "job_capture_evidence_references" ("id", "job_id", "capture_id", "capture_revision", "evidence_indexes_json", "created_at")
SELECT 'lineage:' || cl."id",
  (SELECT m."new_id" FROM "_job_id_map" m WHERE m."legacy_id" = coalesce((SELECT jfv."job_id" FROM "job_fact_versions" jfv WHERE jfv."capture_lineage_id" = cl."id" ORDER BY jfv."created_at" DESC, jfv."id" DESC LIMIT 1), cl."job_id")),
  cl."id",
  (SELECT max("revision") FROM "capture_evidence_versions" WHERE "capture_lineage_id" = cl."id"),
  '[0]', cl."created_at"
FROM "capture_lineages" cl
WHERE cl."job_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "capture_evidence_versions" WHERE "capture_lineage_id" = cl."id");
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT 'lineage_divergence:' || cl."id", 'quarantine', 'capture_lineages', cl."id",
  'capture_lineages.job_id diverged from job_fact_versions.job_id; kept the facts-version job',
  json_build_object('captureSideJob', cl."job_id", 'factsSideJob', (SELECT jfv."job_id" FROM "job_fact_versions" jfv WHERE jfv."capture_lineage_id" = cl."id" ORDER BY jfv."created_at" DESC, jfv."id" DESC LIMIT 1))::text,
  '2026-07-20T00:00:00.000Z'
FROM "capture_lineages" cl
WHERE cl."job_id" IS NOT NULL
  AND (SELECT jfv."job_id" FROM "job_fact_versions" jfv WHERE jfv."capture_lineage_id" = cl."id" ORDER BY jfv."created_at" DESC, jfv."id" DESC LIMIT 1) IS NOT NULL
  AND (SELECT jfv."job_id" FROM "job_fact_versions" jfv WHERE jfv."capture_lineage_id" = cl."id" ORDER BY jfv."created_at" DESC, jfv."id" DESC LIMIT 1) <> cl."job_id";
--> statement-breakpoint
INSERT INTO "job_history" ("id", "job_id", "sequence", "kind", "snapshot_json", "audit_json", "created_at")
SELECT 'jobhist:' || j."id", (SELECT m."new_id" FROM "_job_id_map" m WHERE m."legacy_id" = j."id"), 1, 'created',
  json_build_object('migrated', true, 'legacyJobId', j."id")::text, '{}', j."created_at"
FROM "jobs" j;
--> statement-breakpoint
-- ===================== Opportunities =====================
-- Policy-derived states (not_fit/below_cutoff/blocked) map into fit/cutoff with
-- disposition=reviewing (a policy judgment is never presented as a user decision);
-- user-authored states (not_pursued/archived, written via action-queue and preserved
-- across re-projection) map to declined/archived. merged/duplicate and null-job rows
-- are dedup artifacts / unowned derived state and are quarantined.
-- The target admits one Opportunity per (workspace, Job); legacy could hold several
-- per Job. Keep one deterministically (user dispositions first, then earliest) and
-- quarantine the rest as deduped derived state.
INSERT INTO "lifecycle_opportunities" (
  "id", "workspace_id", "job_id", "revision", "fit", "rank", "cutoff", "disposition", "created_at", "updated_at"
)
SELECT DISTINCT ON (o."job_id") o."id", '00000000-0000-0000-0000-000000000000', (SELECT m."new_id" FROM "_job_id_map" m WHERE m."legacy_id" = o."job_id"), 1,
  CASE WHEN o."merge_status" = 'not_fit' THEN 'not_fit' ELSE 'unknown' END,
  NULL,
  CASE WHEN o."merge_status" = 'below_cutoff' THEN 'below' ELSE 'not_evaluated' END,
  CASE o."merge_status" WHEN 'not_pursued' THEN 'declined' WHEN 'archived' THEN 'archived' ELSE 'reviewing' END,
  o."discovered_at", o."discovered_at"
FROM "opportunities" o
WHERE o."job_id" IS NOT NULL AND o."merge_status" NOT IN ('merged', 'duplicate')
  AND EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = o."job_id")
ORDER BY o."job_id", (CASE WHEN o."merge_status" IN ('not_pursued', 'archived') THEN 0 ELSE 1 END), o."discovered_at", o."id";
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT 'opportunity_quarantine:' || o."id", 'quarantine', 'opportunities', o."id",
  CASE WHEN o."job_id" IS NULL THEN 'opportunity had no Job lineage' ELSE 'dedup artifact (merged/duplicate) is not a workspace decision' END,
  json_build_object('mergeStatus', o."merge_status")::text, '2026-07-20T00:00:00.000Z'
FROM "opportunities" o
WHERE o."job_id" IS NULL OR o."merge_status" IN ('merged', 'duplicate');
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT 'opportunity_dedup:' || o."id", 'quarantine', 'opportunities', o."id",
  'multiple opportunities for the same Job; kept one and deduped the rest',
  json_build_object('jobId', o."job_id")::text, '2026-07-20T00:00:00.000Z'
FROM "opportunities" o
WHERE o."job_id" IS NOT NULL AND o."merge_status" NOT IN ('merged', 'duplicate')
  AND EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = o."job_id")
  AND NOT EXISTS (SELECT 1 FROM "lifecycle_opportunities" lo WHERE lo."id" = o."id");
--> statement-breakpoint
INSERT INTO "opportunity_history" ("opportunity_id", "revision", "kind", "snapshot_json", "audit_json", "created_at")
SELECT lo."id", 1, 'created', json_build_object('migrated', true)::text, '{}', lo."created_at"
FROM "lifecycle_opportunities" lo;
--> statement-breakpoint
-- ===================== Applications =====================
-- Applications are user-authored: an application with no migrated linking opportunity
-- gets a synthesized manual Job + Opportunity (never quarantined). Synthesis is reported.
INSERT INTO "lifecycle_jobs" ("id", "workspace_id", "facts_revision", "facts_json", "availability_state", "availability_observed_at", "availability_revision", "created_at", "updated_at")
SELECT (SELECT m."new_id" FROM "_job_id_map" m WHERE m."legacy_id" = 'synth:' || app."id"), '00000000-0000-0000-0000-000000000000', 1,
  json_build_object('companyName', coalesce((SELECT c."name" FROM "companies" c WHERE c."id" = app."company_id"), 'Unknown'),
    'roleTitle', app."role_title", 'synthesizedFrom', app."id")::text,
  'unknown', app."created_at", 1, app."created_at", app."created_at"
FROM "applications" app
WHERE NOT EXISTS (SELECT 1 FROM "opportunities" o JOIN "lifecycle_opportunities" lo ON lo."id" = o."id" WHERE o."application_id" = app."id");
--> statement-breakpoint
INSERT INTO "job_history" ("id", "job_id", "sequence", "kind", "snapshot_json", "audit_json", "created_at")
SELECT 'jobhist:synth:' || app."id", (SELECT m."new_id" FROM "_job_id_map" m WHERE m."legacy_id" = 'synth:' || app."id"), 1, 'created',
  json_build_object('synthesized', true, 'fromApplication', app."id")::text, '{}', app."created_at"
FROM "applications" app
WHERE NOT EXISTS (SELECT 1 FROM "opportunities" o JOIN "lifecycle_opportunities" lo ON lo."id" = o."id" WHERE o."application_id" = app."id");
--> statement-breakpoint
INSERT INTO "lifecycle_opportunities" ("id", "workspace_id", "job_id", "revision", "fit", "rank", "cutoff", "disposition", "created_at", "updated_at")
SELECT 'synth-opp:' || app."id", '00000000-0000-0000-0000-000000000000', (SELECT m."new_id" FROM "_job_id_map" m WHERE m."legacy_id" = 'synth:' || app."id"), 1,
  'unknown', NULL, 'not_evaluated', 'reviewing', app."created_at", app."created_at"
FROM "applications" app
WHERE NOT EXISTS (SELECT 1 FROM "opportunities" o JOIN "lifecycle_opportunities" lo ON lo."id" = o."id" WHERE o."application_id" = app."id");
--> statement-breakpoint
INSERT INTO "opportunity_history" ("opportunity_id", "revision", "kind", "snapshot_json", "audit_json", "created_at")
SELECT 'synth-opp:' || app."id", 1, 'created', json_build_object('synthesized', true)::text, '{}', app."created_at"
FROM "applications" app
WHERE NOT EXISTS (SELECT 1 FROM "opportunities" o JOIN "lifecycle_opportunities" lo ON lo."id" = o."id" WHERE o."application_id" = app."id");
--> statement-breakpoint
INSERT INTO "lifecycle_applications" (
  "id", "workspace_id", "opportunity_id", "job_id", "revision", "status", "job_facts_revision",
  "snapshot_json", "company_name", "source_name", "created_at", "updated_at"
)
SELECT app."id", '00000000-0000-0000-0000-000000000000',
  coalesce((SELECT lo."id" FROM "lifecycle_opportunities" lo JOIN "opportunities" o ON o."id" = lo."id" WHERE o."application_id" = app."id" ORDER BY lo."id" LIMIT 1), 'synth-opp:' || app."id"),
  coalesce((SELECT lo."job_id" FROM "lifecycle_opportunities" lo JOIN "opportunities" o ON o."id" = lo."id" WHERE o."application_id" = app."id" ORDER BY lo."id" LIMIT 1), (SELECT m."new_id" FROM "_job_id_map" m WHERE m."legacy_id" = 'synth:' || app."id")),
  1,
  CASE WHEN app."status" IN ('active','submitted','interviewing','offered','withdrawn','rejected','accepted') THEN app."status" ELSE 'active' END,
  1,
  json_build_object('roleTitle', app."role_title", 'workMode', app."work_mode", 'country', app."country")::text,
  left(coalesce((SELECT c."name" FROM "companies" c WHERE c."id" = app."company_id"), 'Unknown'), 500),
  left(coalesce((SELECT s."name" FROM "sources" s WHERE s."id" = app."source_id"), 'Unknown'), 500),
  app."created_at", app."created_at"
FROM "applications" app;
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT 'application_synth:' || app."id", 'synthesized', 'applications', app."id",
  'orphan application had no linking opportunity; synthesized a manual Job and Opportunity',
  json_build_object('synthesizedJob', (SELECT m."new_id" FROM "_job_id_map" m WHERE m."legacy_id" = 'synth:' || app."id"), 'synthesizedOpportunity', 'synth-opp:' || app."id")::text, '2026-07-20T00:00:00.000Z'
FROM "applications" app
WHERE NOT EXISTS (SELECT 1 FROM "opportunities" o JOIN "lifecycle_opportunities" lo ON lo."id" = o."id" WHERE o."application_id" = app."id");
--> statement-breakpoint
-- Pursuit links (single primary kept deterministically), bounded attempt/event records, and created history.
INSERT INTO "pursuit_links" ("id", "application_id", "kind", "label", "url", "is_primary", "created_at")
SELECT al."id", al."application_id", left(coalesce(nullif(al."kind", ''), 'link'), 100),
  left(coalesce(nullif(al."label", ''), 'link'), 200), left(al."url", 4096),
  al."is_primary" AND al."id" = (SELECT min("id") FROM "application_links" WHERE "application_id" = al."application_id" AND "is_primary"),
  al."discovered_at"
FROM "application_links" al
WHERE EXISTS (SELECT 1 FROM "applications" app WHERE app."id" = al."application_id");
--> statement-breakpoint
INSERT INTO "application_attempt_records" ("id", "workspace_id", "application_id", "state", "started_at", "completed_at", "summary", "created_at")
SELECT aa."id", '00000000-0000-0000-0000-000000000000', aa."application_id",
  CASE WHEN aa."status" IN ('pending','running','succeeded','failed') THEN aa."status"
    WHEN aa."status" = 'completed' THEN 'succeeded' ELSE 'pending' END,
  aa."started_at", aa."completed_at",
  CASE WHEN aa."summary" IS NULL THEN NULL ELSE left(aa."summary", 2000) END, aa."created_at"
FROM "application_attempts" aa
WHERE EXISTS (SELECT 1 FROM "applications" app WHERE app."id" = aa."application_id");
--> statement-breakpoint
INSERT INTO "application_event_records" ("id", "workspace_id", "application_id", "type", "occurred_at", "actor_id", "actor_type", "summary", "created_at")
SELECT ae."id", '00000000-0000-0000-0000-000000000000', ae."application_id",
  left(coalesce(nullif(ae."type", ''), 'event'), 100), ae."created_at",
  left(coalesce(nullif(ae."actor", ''), 'system'), 200), 'system',
  left(coalesce(nullif(ae."message", ''), 'event'), 2000), ae."created_at"
FROM "application_events" ae
WHERE EXISTS (SELECT 1 FROM "applications" app WHERE app."id" = ae."application_id");
--> statement-breakpoint
INSERT INTO "application_history" ("application_id", "revision", "kind", "snapshot_json", "audit_json", "created_at")
SELECT app."id", 1, 'created', json_build_object('migrated', true)::text, '{}', app."created_at"
FROM "applications" app;
--> statement-breakpoint
-- ===================== Scheduled work (retry_work split) =====================
-- Skip tombstoned rows (reported). Uniform cancelled disambiguation: failureEvidence
-- present -> terminal deterministic failure; absent -> cancellation. acquired -> claimed.
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT 'retry_deleted:' || rw."id", 'reset', 'retry_work', rw."id",
  'tombstoned scheduled-work row skipped', json_build_object('kind', rw."kind", 'state', rw."state")::text, '2026-07-20T00:00:00.000Z'
FROM "retry_work" rw WHERE rw."deleted_at" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT 'retry_invalid_lineage:' || rw."id", 'quarantine', 'retry_work', rw."id",
  'lineage_json is not valid JSON; normalization work could not be classified',
  json_build_object('kind', rw."kind", 'state', rw."state")::text, '2026-07-20T00:00:00.000Z'
FROM "retry_work" rw
WHERE rw."deleted_at" IS NULL AND rw."kind" = 'normalization' AND NOT pg_input_is_valid(rw."lineage_json", 'jsonb');
--> statement-breakpoint
INSERT INTO "connector_capture_work" (
  "id", "workspace_id", "idempotency_key", "attempt", "max_attempts", "status", "next_eligible_at",
  "failure_reason", "failure_detail", "owner_version", "acquisition_token", "claimed_at", "claim_expires_at",
  "created_at", "updated_at", "connector_instance_id", "filter_signature", "checkpoint_schema_version", "checkpoint_generation"
)
SELECT rw."id", '00000000-0000-0000-0000-000000000000', rw."id", greatest(rw."attempt", 1), greatest(rw."max_attempts", rw."attempt", 1),
  CASE rw."state" WHEN 'acquired' THEN 'claimed' ELSE rw."state" END,
  CASE WHEN rw."state" IN ('scheduled','acquired') THEN coalesce(rw."next_attempt_at", '2026-07-20T00:00:00.000Z') ELSE NULL END,
  CASE WHEN rw."state" = 'exhausted' THEN rw."reason" ELSE NULL END, NULL, rw."owner_version",
  CASE WHEN rw."state" = 'acquired' THEN rw."acquisition_token" ELSE NULL END,
  CASE WHEN rw."state" = 'acquired' THEN rw."acquired_at" ELSE NULL END, NULL,
  rw."created_at", rw."updated_at", rw."connector_instance_id", left(coalesce(rw."filter_signature", 'filters:{}'), 512),
  coalesce(rw."checkpoint_schema_version", '1'), coalesce(rw."checkpoint_generation", '1')
FROM "retry_work" rw
WHERE rw."deleted_at" IS NULL AND rw."kind" = 'connector_capture' AND rw."connector_instance_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "provider_url_resolution_work" (
  "id", "workspace_id", "idempotency_key", "attempt", "max_attempts", "status", "next_eligible_at",
  "failure_reason", "failure_detail", "owner_version", "acquisition_token", "claimed_at", "claim_expires_at",
  "created_at", "updated_at", "capture_id", "resolver_id", "resolver_version", "intermediary_url_hash"
)
SELECT rw."id", '00000000-0000-0000-0000-000000000000', rw."id", greatest(rw."attempt", 1), greatest(rw."max_attempts", rw."attempt", 1),
  CASE rw."state" WHEN 'acquired' THEN 'claimed'
    WHEN 'cancelled' THEN CASE WHEN (CASE WHEN pg_input_is_valid(rw."lineage_json", 'jsonb') THEN rw."lineage_json"::jsonb ELSE '{}'::jsonb END) ? 'failureEvidence' THEN 'terminal' ELSE 'cancelled' END
    ELSE rw."state" END,
  CASE WHEN rw."state" IN ('scheduled','acquired') THEN coalesce(rw."next_attempt_at", '2026-07-20T00:00:00.000Z') ELSE NULL END,
  CASE WHEN rw."state" = 'cancelled' AND (CASE WHEN pg_input_is_valid(rw."lineage_json", 'jsonb') THEN rw."lineage_json"::jsonb ELSE '{}'::jsonb END) ? 'failureEvidence' THEN 'unresolvable'
    WHEN rw."state" = 'exhausted' THEN rw."reason" ELSE NULL END, NULL, rw."owner_version",
  CASE WHEN rw."state" = 'acquired' THEN rw."acquisition_token" ELSE NULL END,
  CASE WHEN rw."state" = 'acquired' THEN rw."acquired_at" ELSE NULL END, NULL,
  rw."created_at", rw."updated_at", cev."capture_lineage_id", coalesce(rw."resolver_id", 'legacy'), coalesce(rw."resolver_version", '1'),
  left(md5(coalesce((CASE WHEN pg_input_is_valid(rw."lineage_json", 'jsonb') THEN rw."lineage_json"::jsonb ELSE '{}'::jsonb END)->>'intermediaryUrl', rw."id")), 256)
FROM "retry_work" rw
JOIN "capture_evidence_versions" cev ON cev."id" = rw."capture_evidence_version_id"
WHERE rw."deleted_at" IS NULL AND rw."kind" = 'normalization' AND (CASE WHEN pg_input_is_valid(rw."lineage_json", 'jsonb') THEN rw."lineage_json"::jsonb ELSE '{}'::jsonb END)->>'workKind' = 'provider_url_resolution';
--> statement-breakpoint
INSERT INTO "normalization_work" (
  "id", "workspace_id", "idempotency_key", "attempt", "max_attempts", "status", "next_eligible_at",
  "failure_reason", "failure_detail", "owner_version", "acquisition_token", "claimed_at", "claim_expires_at",
  "created_at", "updated_at", "capture_id", "capture_revision", "resolver_id", "resolver_version", "input_hash"
)
SELECT rw."id", '00000000-0000-0000-0000-000000000000', rw."id", greatest(rw."attempt", 1), greatest(rw."max_attempts", rw."attempt", 1),
  CASE rw."state" WHEN 'acquired' THEN 'claimed'
    WHEN 'cancelled' THEN CASE WHEN (CASE WHEN pg_input_is_valid(rw."lineage_json", 'jsonb') THEN rw."lineage_json"::jsonb ELSE '{}'::jsonb END) ? 'failureEvidence' THEN 'terminal' ELSE 'cancelled' END
    ELSE rw."state" END,
  CASE WHEN rw."state" IN ('scheduled','acquired') THEN coalesce(rw."next_attempt_at", '2026-07-20T00:00:00.000Z') ELSE NULL END,
  CASE WHEN rw."state" = 'cancelled' AND (CASE WHEN pg_input_is_valid(rw."lineage_json", 'jsonb') THEN rw."lineage_json"::jsonb ELSE '{}'::jsonb END) ? 'failureEvidence' THEN 'unresolvable'
    WHEN rw."state" = 'exhausted' THEN rw."reason" ELSE NULL END, NULL, rw."owner_version",
  CASE WHEN rw."state" = 'acquired' THEN rw."acquisition_token" ELSE NULL END,
  CASE WHEN rw."state" = 'acquired' THEN rw."acquired_at" ELSE NULL END, NULL,
  rw."created_at", rw."updated_at", cev."capture_lineage_id", cev."revision",
  coalesce(rw."resolver_id", 'legacy'), coalesce(rw."resolver_version", '1'), coalesce(rw."input_hash", 'legacy')
FROM "retry_work" rw
JOIN "capture_evidence_versions" cev ON cev."id" = rw."capture_evidence_version_id"
WHERE rw."deleted_at" IS NULL AND rw."kind" = 'normalization' AND pg_input_is_valid(rw."lineage_json", 'jsonb') AND coalesce((CASE WHEN pg_input_is_valid(rw."lineage_json", 'jsonb') THEN rw."lineage_json"::jsonb ELSE '{}'::jsonb END)->>'workKind', '') <> 'provider_url_resolution';
--> statement-breakpoint
DROP TABLE "_job_id_map";
--> statement-breakpoint
DROP FUNCTION mint_job_uuid(text, text);
