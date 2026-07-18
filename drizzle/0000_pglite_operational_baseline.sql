CREATE TABLE "application_attempt_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"application_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"payload_json" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"status" text NOT NULL,
	"outcome" text,
	"actor_type" text NOT NULL,
	"actor_name" text,
	"entry_url" text,
	"resume_variant" text,
	"resume_artifact_path" text,
	"summary" text,
	"stop_reason" text,
	"confirmation_url" text,
	"confirmation_text" text,
	"started_at" text NOT NULL,
	"completed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"payload_json" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_links" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"external_id" text,
	"is_primary" boolean NOT NULL,
	"discovered_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
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
	"company_id" text NOT NULL,
	"source_id" text NOT NULL,
	"role_title" text NOT NULL,
	"role_kind" text NOT NULL,
	"term" text,
	"timing_mode" text DEFAULT 'unknown' NOT NULL,
	"terms_json" text DEFAULT '[]' NOT NULL,
	"start_date" text,
	"end_date" text,
	"city" text,
	"region" text,
	"country" text NOT NULL,
	"work_mode" text NOT NULL,
	"location_raw" text,
	"status" text NOT NULL,
	"has_applied" boolean NOT NULL,
	"current_priority_score" integer,
	"current_priority_band" text,
	"current_resume_variant" text,
	"notes" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "capture_evidence_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_lineage_id" text NOT NULL,
	"revision" integer NOT NULL,
	"content_hash" text NOT NULL,
	"adapter_id" text NOT NULL,
	"adapter_kind" text NOT NULL,
	"adapter_version" text NOT NULL,
	"reported_origin_kind" text,
	"reported_origin_name" text,
	"reported_origin_provider_id" text,
	"reported_origin_url" text,
	"observed_at" text NOT NULL,
	"provider_record_id" text,
	"provider_schema" text,
	"payload_json" text,
	"evidence_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "idx_capture_evidence_versions_id_lineage" UNIQUE("id","capture_lineage_id")
);
--> statement-breakpoint
CREATE TABLE "capture_lineages" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captures" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_lineage_id" text NOT NULL,
	"capture_evidence_version_id" text NOT NULL,
	"connector_instance_id" text,
	"connector_run_id" text,
	"execution_scope_id" text,
	"observed_at" text NOT NULL,
	"received_at" text NOT NULL,
	CONSTRAINT "chk_captures_connector_capture" CHECK (("captures"."connector_instance_id" is null and "captures"."connector_run_id" is null and "captures"."execution_scope_id" is null) or ("captures"."connector_instance_id" is not null and "captures"."connector_run_id" is not null and "captures"."execution_scope_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"website_url" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
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
	CONSTRAINT "idx_connector_runs_id_instance" UNIQUE("id","connector_instance_id")
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
CREATE TABLE "job_fact_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"job_id" text NOT NULL,
	"capture_lineage_id" text NOT NULL,
	"capture_evidence_version_id" text NOT NULL,
	"schema_version" text NOT NULL,
	"job_fact_version_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "idx_job_fact_versions_lineage" UNIQUE("id","capture_lineage_id","capture_evidence_version_id")
);
--> statement-breakpoint
CREATE TABLE "job_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"identity_kind" text NOT NULL,
	"identity_namespace" text NOT NULL,
	"identity_value" text NOT NULL,
	"provenance_kind" text NOT NULL,
	"provenance_version" text NOT NULL,
	"evidence_json" text NOT NULL,
	"capture_evidence_version_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_job_identities_kind" CHECK ("job_identities"."identity_kind" in ('provider_job','canonical_destination','intermediary_alias','destination_alias')),
	CONSTRAINT "chk_job_identities_namespace_length" CHECK (length("job_identities"."identity_namespace") between 1 and 512),
	CONSTRAINT "chk_job_identities_value_length" CHECK (length("job_identities"."identity_value") between 1 and 2048),
	CONSTRAINT "chk_job_identities_provenance_kind" CHECK ("job_identities"."provenance_kind" in ('primary_backfill','capture','normalization')),
	CONSTRAINT "chk_job_identities_provenance_version_length" CHECK (length("job_identities"."provenance_version") between 1 and 128),
	CONSTRAINT "chk_job_identities_evidence_length" CHECK (length("job_identities"."evidence_json") between 2 and 16384)
);
--> statement-breakpoint
CREATE TABLE "job_identity_conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"conflicting_job_id" text,
	"capture_evidence_version_id" text NOT NULL,
	"identity_kind" text NOT NULL,
	"identity_namespace" text NOT NULL,
	"identity_value" text NOT NULL,
	"reason" text NOT NULL,
	"provenance_version" text NOT NULL,
	"evidence_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_job_identity_conflicts_kind" CHECK ("job_identity_conflicts"."identity_kind" in ('provider_job','canonical_destination','intermediary_alias','destination_alias')),
	CONSTRAINT "chk_job_identity_conflicts_namespace_length" CHECK (length("job_identity_conflicts"."identity_namespace") between 1 and 512),
	CONSTRAINT "chk_job_identity_conflicts_value_length" CHECK (length("job_identity_conflicts"."identity_value") between 1 and 2048),
	CONSTRAINT "chk_job_identity_conflicts_reason_length" CHECK (length("job_identity_conflicts"."reason") between 1 and 512),
	CONSTRAINT "chk_job_identity_conflicts_provenance_version_length" CHECK (length("job_identity_conflicts"."provenance_version") between 1 and 128),
	CONSTRAINT "chk_job_identity_conflicts_evidence_length" CHECK (length("job_identity_conflicts"."evidence_json") between 2 and 16384)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_kind" text NOT NULL,
	"identity_namespace" text NOT NULL,
	"identity_value" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_jobs_identity_kind_length" CHECK (length("jobs"."identity_kind") between 1 and 64),
	CONSTRAINT "chk_jobs_identity_namespace_length" CHECK (length("jobs"."identity_namespace") between 1 and 4096),
	CONSTRAINT "chk_jobs_identity_value_length" CHECK (length("jobs"."identity_value") between 1 and 2048)
);
--> statement-breakpoint
CREATE TABLE "normalization_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"capture_evidence_version_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"resolver_id" text NOT NULL,
	"resolver_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"declaration_json" text NOT NULL,
	"applicability_json" text NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "normalization_field_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"attempt_sequence" integer NOT NULL,
	"outcome_index" integer NOT NULL,
	"field" text NOT NULL,
	"status" text NOT NULL,
	"resolver_id" text NOT NULL,
	"resolver_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"outcome_json" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "normalization_gates" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"status" text NOT NULL,
	"job_fact_version_id" text,
	"gate_json" text NOT NULL,
	"evaluated_at" text NOT NULL,
	CONSTRAINT "chk_normalization_gates_status" CHECK ("normalization_gates"."status" in ('passed','needs_enrichment','rejected','failed')),
	CONSTRAINT "chk_normalization_gates_job_fact_version" CHECK (("normalization_gates"."status" = 'passed' and "normalization_gates"."job_fact_version_id" is not null) or ("normalization_gates"."status" <> 'passed' and "normalization_gates"."job_fact_version_id" is null))
);
--> statement-breakpoint
CREATE TABLE "normalization_replay_items" (
	"id" text PRIMARY KEY NOT NULL,
	"replay_id" text NOT NULL,
	"capture_lineage_id" text NOT NULL,
	"capture_evidence_version_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"sequence" integer NOT NULL,
	"status" text NOT NULL,
	"normalization_run_id" text,
	"failure_json" text,
	"completed_at" text,
	CONSTRAINT "chk_normalization_replay_items_status" CHECK ("normalization_replay_items"."status" in ('pending','completed','failed'))
);
--> statement-breakpoint
CREATE TABLE "normalization_replay_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"selector_json" text NOT NULL,
	"invalidation_json" text NOT NULL,
	"target_versions_json" text,
	"field_directives_json" text NOT NULL,
	"status" text NOT NULL,
	"accepted_at" text NOT NULL,
	"completed_at" text,
	CONSTRAINT "chk_normalization_replay_requests_status" CHECK ("normalization_replay_requests"."status" in ('accepted','in_progress','completed','completed_with_failures'))
);
--> statement-breakpoint
CREATE TABLE "normalization_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_lineage_id" text NOT NULL,
	"capture_evidence_version_id" text NOT NULL,
	"trigger_capture_id" text,
	"trigger_connector_instance_id" text,
	"trigger_connector_run_id" text,
	"input_hash" text NOT NULL,
	"resolver_set_hash" text NOT NULL,
	"canonical_schema_version" text NOT NULL,
	"gate_policy_version" text NOT NULL,
	"trigger_kind" text DEFAULT 'intake' NOT NULL,
	"trigger_id" text,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_normalization_runs_status" CHECK ("normalization_runs"."status" in ('pending','in_progress','completed','blocked','failed')),
	CONSTRAINT "chk_normalization_runs_trigger_kind" CHECK ("normalization_runs"."trigger_kind" in ('intake'))
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"projection_identity_key" text,
	"projection_aliases_json" text DEFAULT '[]' NOT NULL,
	"job_id" text,
	"job_fact_version_id" text,
	"capture_evidence_version_id" text,
	"adapter_id" text,
	"adapter_kind" text,
	"adapter_version" text,
	"workflow_run_id" text NOT NULL,
	"source_id" text NOT NULL,
	"company_name" text NOT NULL,
	"role_title" text NOT NULL,
	"role_kind" text NOT NULL,
	"term" text,
	"timing_mode" text DEFAULT 'unknown' NOT NULL,
	"terms_json" text DEFAULT '[]' NOT NULL,
	"start_date" text,
	"end_date" text,
	"city" text,
	"region" text,
	"country" text,
	"work_mode" text NOT NULL,
	"location_raw" text,
	"employment_type" text,
	"seniority" text,
	"location_json" text,
	"compensation_json" text,
	"posted_at_json" text,
	"official_url" text,
	"source_url" text,
	"destination_class" text,
	"destination_url" text,
	"intermediary_url" text,
	"usability" text,
	"posted_age" text,
	"priority_score" integer,
	"priority_band" text,
	"fit_notes" text,
	"duplicate_notes" text,
	"blocker" text,
	"policy_blocker" text,
	"disposition_reason" text,
	"merge_status" text NOT NULL,
	"application_id" text,
	"merge_notes" text,
	"discovered_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
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
CREATE TABLE "retry_work" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_scope_id" text NOT NULL,
	"kind" text NOT NULL,
	"connector_instance_id" text,
	"filter_signature" text,
	"checkpoint_schema_version" text,
	"checkpoint_generation" text,
	"capture_evidence_version_id" text,
	"resolver_id" text,
	"resolver_version" text,
	"input_hash" text,
	"reason" text NOT NULL,
	"attempt" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"last_attempt_at" text NOT NULL,
	"computed_delay_ms" integer,
	"server_minimum_delay_ms" integer,
	"next_attempt_at" text,
	"horizon_at" text NOT NULL,
	"state" text NOT NULL,
	"owner_version" text NOT NULL,
	"lineage_json" text NOT NULL,
	"acquired_at" text,
	"acquisition_token" text,
	"acquisition_run_id" text,
	"skipped_run_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "chk_retry_work_kind" CHECK ("retry_work"."kind" in ('connector_capture','normalization')),
	CONSTRAINT "chk_retry_work_reason" CHECK ("retry_work"."reason" in ('rate_limit','server_failure','network_interruption','operation_timeout')),
	CONSTRAINT "chk_retry_work_state" CHECK ("retry_work"."state" in ('scheduled','acquired','completed','exhausted','cancelled')),
	CONSTRAINT "chk_retry_work_attempt" CHECK ("retry_work"."attempt" >= 1 and "retry_work"."max_attempts" >= "retry_work"."attempt"),
	CONSTRAINT "chk_retry_work_server_minimum" CHECK ("retry_work"."server_minimum_delay_ms" is null or "retry_work"."server_minimum_delay_ms" >= 0),
	CONSTRAINT "chk_retry_work_scope" CHECK ((
      "retry_work"."kind" = 'connector_capture'
      and "retry_work"."connector_instance_id" is not null
      and "retry_work"."filter_signature" is not null
      and "retry_work"."checkpoint_schema_version" is not null
      and "retry_work"."checkpoint_generation" is not null
      and "retry_work"."capture_evidence_version_id" is null
      and "retry_work"."resolver_id" is null
      and "retry_work"."resolver_version" is null
      and "retry_work"."input_hash" is null
    ) or (
      "retry_work"."kind" = 'normalization'
      and "retry_work"."connector_instance_id" is null
      and "retry_work"."filter_signature" is null
      and "retry_work"."checkpoint_schema_version" is null
      and "retry_work"."checkpoint_generation" is null
      and "retry_work"."capture_evidence_version_id" is not null
      and "retry_work"."resolver_id" is not null
      and "retry_work"."resolver_version" is not null
      and "retry_work"."input_hash" is not null
    )),
	CONSTRAINT "chk_retry_work_timing" CHECK ((
      "retry_work"."state" in ('scheduled','acquired')
      and "retry_work"."computed_delay_ms" is not null
      and "retry_work"."computed_delay_ms" >= 0
      and "retry_work"."next_attempt_at" is not null
    ) or (
      "retry_work"."state" in ('completed','exhausted','cancelled')
      and "retry_work"."next_attempt_at" is null
    ))
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
CREATE TABLE "sourcing_projection_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_lineage_id" text NOT NULL,
	"capture_evidence_version_id" text NOT NULL,
	"job_fact_version_id" text NOT NULL,
	"status" text NOT NULL,
	"opportunity_id" text,
	"failure_code" text,
	"failure_retryable" boolean,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"projected_at" text,
	"failed_at" text,
	CONSTRAINT "chk_sourcing_projection_outcomes_status" CHECK ("sourcing_projection_outcomes"."status" in ('pending','projected','failed')),
	CONSTRAINT "chk_sourcing_projection_outcomes_fields" CHECK (
      ("sourcing_projection_outcomes"."status" = 'pending' and "sourcing_projection_outcomes"."opportunity_id" is null and "sourcing_projection_outcomes"."failure_code" is null and "sourcing_projection_outcomes"."failure_retryable" is null and "sourcing_projection_outcomes"."projected_at" is null and "sourcing_projection_outcomes"."failed_at" is null)
      or ("sourcing_projection_outcomes"."status" = 'projected' and "sourcing_projection_outcomes"."opportunity_id" is not null and "sourcing_projection_outcomes"."failure_code" is null and "sourcing_projection_outcomes"."failure_retryable" is null and "sourcing_projection_outcomes"."projected_at" is not null and "sourcing_projection_outcomes"."failed_at" is null)
      or ("sourcing_projection_outcomes"."status" = 'failed' and "sourcing_projection_outcomes"."opportunity_id" is null and "sourcing_projection_outcomes"."failure_code" in ('projection_failed','persistence_failed','internal_error') and "sourcing_projection_outcomes"."failure_retryable" is not null and "sourcing_projection_outcomes"."projected_at" is null and "sourcing_projection_outcomes"."failed_at" is not null)
    )
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
ALTER TABLE "application_attempt_steps" ADD CONSTRAINT "application_attempt_steps_attempt_id_application_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."application_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_attempt_steps" ADD CONSTRAINT "application_attempt_steps_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_attempts" ADD CONSTRAINT "application_attempts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_links" ADD CONSTRAINT "application_links_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_scores" ADD CONSTRAINT "application_scores_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_workflow_states" ADD CONSTRAINT "application_workflow_states_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_evidence_versions" ADD CONSTRAINT "capture_evidence_versions_capture_lineage_id_capture_lineages_id_fk" FOREIGN KEY ("capture_lineage_id") REFERENCES "public"."capture_lineages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_lineages" ADD CONSTRAINT "capture_lineages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_capture_lineage_id_capture_lineages_id_fk" FOREIGN KEY ("capture_lineage_id") REFERENCES "public"."capture_lineages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_capture_evidence_version_id_capture_evidence_versions_id_fk" FOREIGN KEY ("capture_evidence_version_id") REFERENCES "public"."capture_evidence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_connector_run_id_connector_runs_id_fk" FOREIGN KEY ("connector_run_id") REFERENCES "public"."connector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_execution_scope_id_source_execution_scopes_id_fk" FOREIGN KEY ("execution_scope_id") REFERENCES "public"."source_execution_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "fk_captures_evidence_version_lineage" FOREIGN KEY ("capture_evidence_version_id","capture_lineage_id") REFERENCES "public"."capture_evidence_versions"("id","capture_lineage_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "fk_captures_run_instance" FOREIGN KEY ("connector_run_id","connector_instance_id") REFERENCES "public"."connector_runs"("id","connector_instance_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_checkpoints" ADD CONSTRAINT "connector_checkpoints_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_observations" ADD CONSTRAINT "connector_observations_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_observations" ADD CONSTRAINT "connector_observations_connector_run_id_connector_runs_id_fk" FOREIGN KEY ("connector_run_id") REFERENCES "public"."connector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_run_synchronizations" ADD CONSTRAINT "connector_run_synchronizations_connector_run_id_connector_runs_id_fk" FOREIGN KEY ("connector_run_id") REFERENCES "public"."connector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_runs" ADD CONSTRAINT "connector_runs_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_schedule_events" ADD CONSTRAINT "connector_schedule_events_schedule_id_connector_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."connector_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_schedule_occurrences" ADD CONSTRAINT "connector_schedule_occurrences_schedule_id_connector_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."connector_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_schedule_occurrences" ADD CONSTRAINT "connector_schedule_occurrences_connector_run_id_connector_runs_id_fk" FOREIGN KEY ("connector_run_id") REFERENCES "public"."connector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_schedule_revisions" ADD CONSTRAINT "connector_schedule_revisions_schedule_id_connector_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."connector_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_schedules" ADD CONSTRAINT "connector_schedules_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_fact_versions" ADD CONSTRAINT "job_fact_versions_run_id_normalization_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."normalization_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_fact_versions" ADD CONSTRAINT "job_fact_versions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_fact_versions" ADD CONSTRAINT "job_fact_versions_capture_lineage_id_capture_lineages_id_fk" FOREIGN KEY ("capture_lineage_id") REFERENCES "public"."capture_lineages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_fact_versions" ADD CONSTRAINT "job_fact_versions_capture_evidence_version_id_capture_evidence_versions_id_fk" FOREIGN KEY ("capture_evidence_version_id") REFERENCES "public"."capture_evidence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_identities" ADD CONSTRAINT "job_identities_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_identities" ADD CONSTRAINT "job_identities_capture_evidence_version_id_capture_evidence_versions_id_fk" FOREIGN KEY ("capture_evidence_version_id") REFERENCES "public"."capture_evidence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_identity_conflicts" ADD CONSTRAINT "job_identity_conflicts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_identity_conflicts" ADD CONSTRAINT "job_identity_conflicts_conflicting_job_id_jobs_id_fk" FOREIGN KEY ("conflicting_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_identity_conflicts" ADD CONSTRAINT "job_identity_conflicts_capture_evidence_version_id_capture_evidence_versions_id_fk" FOREIGN KEY ("capture_evidence_version_id") REFERENCES "public"."capture_evidence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_attempts" ADD CONSTRAINT "normalization_attempts_run_id_normalization_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."normalization_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_attempts" ADD CONSTRAINT "normalization_attempts_capture_evidence_version_id_capture_evidence_versions_id_fk" FOREIGN KEY ("capture_evidence_version_id") REFERENCES "public"."capture_evidence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_field_outcomes" ADD CONSTRAINT "normalization_field_outcomes_run_id_normalization_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."normalization_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_field_outcomes" ADD CONSTRAINT "normalization_field_outcomes_attempt_id_normalization_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."normalization_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_gates" ADD CONSTRAINT "normalization_gates_run_id_normalization_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."normalization_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_gates" ADD CONSTRAINT "normalization_gates_job_fact_version_id_job_fact_versions_id_fk" FOREIGN KEY ("job_fact_version_id") REFERENCES "public"."job_fact_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_replay_items" ADD CONSTRAINT "normalization_replay_items_replay_id_normalization_replay_requests_id_fk" FOREIGN KEY ("replay_id") REFERENCES "public"."normalization_replay_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_replay_items" ADD CONSTRAINT "normalization_replay_items_capture_lineage_id_capture_lineages_id_fk" FOREIGN KEY ("capture_lineage_id") REFERENCES "public"."capture_lineages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_replay_items" ADD CONSTRAINT "normalization_replay_items_capture_evidence_version_id_capture_evidence_versions_id_fk" FOREIGN KEY ("capture_evidence_version_id") REFERENCES "public"."capture_evidence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_replay_items" ADD CONSTRAINT "normalization_replay_items_normalization_run_id_normalization_runs_id_fk" FOREIGN KEY ("normalization_run_id") REFERENCES "public"."normalization_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_runs" ADD CONSTRAINT "normalization_runs_capture_lineage_id_capture_lineages_id_fk" FOREIGN KEY ("capture_lineage_id") REFERENCES "public"."capture_lineages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_runs" ADD CONSTRAINT "normalization_runs_capture_evidence_version_id_capture_evidence_versions_id_fk" FOREIGN KEY ("capture_evidence_version_id") REFERENCES "public"."capture_evidence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_job_fact_version_id_job_fact_versions_id_fk" FOREIGN KEY ("job_fact_version_id") REFERENCES "public"."job_fact_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_capture_evidence_version_id_capture_evidence_versions_id_fk" FOREIGN KEY ("capture_evidence_version_id") REFERENCES "public"."capture_evidence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retry_work" ADD CONSTRAINT "retry_work_execution_scope_id_source_execution_scopes_id_fk" FOREIGN KEY ("execution_scope_id") REFERENCES "public"."source_execution_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retry_work" ADD CONSTRAINT "retry_work_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retry_work" ADD CONSTRAINT "retry_work_capture_evidence_version_id_capture_evidence_versions_id_fk" FOREIGN KEY ("capture_evidence_version_id") REFERENCES "public"."capture_evidence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retry_work" ADD CONSTRAINT "retry_work_acquisition_run_id_connector_runs_id_fk" FOREIGN KEY ("acquisition_run_id") REFERENCES "public"."connector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retry_work" ADD CONSTRAINT "retry_work_skipped_run_id_connector_runs_id_fk" FOREIGN KEY ("skipped_run_id") REFERENCES "public"."connector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_execution_sessions" ADD CONSTRAINT "source_execution_sessions_execution_scope_id_source_execution_scopes_id_fk" FOREIGN KEY ("execution_scope_id") REFERENCES "public"."source_execution_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_projection_outcomes" ADD CONSTRAINT "sourcing_projection_outcomes_capture_lineage_id_capture_lineages_id_fk" FOREIGN KEY ("capture_lineage_id") REFERENCES "public"."capture_lineages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_projection_outcomes" ADD CONSTRAINT "sourcing_projection_outcomes_capture_evidence_version_id_capture_evidence_versions_id_fk" FOREIGN KEY ("capture_evidence_version_id") REFERENCES "public"."capture_evidence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_projection_outcomes" ADD CONSTRAINT "sourcing_projection_outcomes_job_fact_version_id_job_fact_versions_id_fk" FOREIGN KEY ("job_fact_version_id") REFERENCES "public"."job_fact_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_projection_outcomes" ADD CONSTRAINT "sourcing_projection_outcomes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_projection_outcomes" ADD CONSTRAINT "fk_sourcing_projection_outcomes_revision_lineage" FOREIGN KEY ("capture_evidence_version_id","capture_lineage_id") REFERENCES "public"."capture_evidence_versions"("id","capture_lineage_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_projection_outcomes" ADD CONSTRAINT "fk_sourcing_projection_outcomes_job_fact_version_lineage" FOREIGN KEY ("job_fact_version_id","capture_lineage_id","capture_evidence_version_id") REFERENCES "public"."job_fact_versions"("id","capture_lineage_id","capture_evidence_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_subject_application_id_applications_id_fk" FOREIGN KEY ("subject_application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_evidence_versions_lineage_revision" ON "capture_evidence_versions" USING btree ("capture_lineage_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_evidence_versions_lineage_hash" ON "capture_evidence_versions" USING btree ("capture_lineage_id","content_hash");--> statement-breakpoint
CREATE INDEX "idx_capture_evidence_versions_provider_current" ON "capture_evidence_versions" USING btree ("provider_record_id","id","capture_lineage_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capture_lineages_job" ON "capture_lineages" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_captures_lineage" ON "captures" USING btree ("id","capture_evidence_version_id","capture_lineage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_captures_connector_lineage" ON "captures" USING btree ("id","capture_evidence_version_id","capture_lineage_id","connector_instance_id","connector_run_id");--> statement-breakpoint
CREATE INDEX "idx_captures_lineage_chronology" ON "captures" USING btree ("capture_lineage_id","observed_at","received_at","id");--> statement-breakpoint
CREATE INDEX "idx_captures_evidence_version" ON "captures" USING btree ("capture_evidence_version_id");--> statement-breakpoint
CREATE INDEX "idx_captures_connector_run" ON "captures" USING btree ("connector_run_id");--> statement-breakpoint
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
CREATE UNIQUE INDEX "idx_job_fact_versions_run" ON "job_fact_versions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_job_fact_versions_evidence_version_schema" ON "job_fact_versions" USING btree ("capture_evidence_version_id","schema_version");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_identities_identity" ON "job_identities" USING btree ("identity_kind","identity_namespace","identity_value");--> statement-breakpoint
CREATE INDEX "idx_job_identities_job_chronology" ON "job_identities" USING btree ("job_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_identity_conflicts_capture" ON "job_identity_conflicts" USING btree ("job_id","capture_evidence_version_id","identity_kind","identity_namespace","identity_value","reason");--> statement-breakpoint
CREATE INDEX "idx_job_identity_conflicts_chronology" ON "job_identity_conflicts" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_jobs_identity" ON "jobs" USING btree ("identity_kind","identity_namespace","identity_value");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_normalization_attempts_run_sequence" ON "normalization_attempts" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_normalization_attempts_resolver" ON "normalization_attempts" USING btree ("resolver_id","resolver_version","input_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_normalization_field_outcomes_run_sequence" ON "normalization_field_outcomes" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_normalization_field_outcomes_selector" ON "normalization_field_outcomes" USING btree ("run_id","field","attempt_sequence","outcome_index");--> statement-breakpoint
CREATE INDEX "idx_normalization_field_outcomes_resolver" ON "normalization_field_outcomes" USING btree ("resolver_id","resolver_version","input_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_normalization_gates_run" ON "normalization_gates" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_normalization_gates_policy" ON "normalization_gates" USING btree ("policy_version","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_normalization_replay_items_sequence" ON "normalization_replay_items" USING btree ("replay_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_normalization_replay_items_evidence_version" ON "normalization_replay_items" USING btree ("replay_id","capture_evidence_version_id");--> statement-breakpoint
CREATE INDEX "idx_normalization_replay_requests_chronology" ON "normalization_replay_requests" USING btree ("accepted_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_normalization_runs_cache" ON "normalization_runs" USING btree ("capture_evidence_version_id","input_hash","resolver_set_hash","canonical_schema_version","gate_policy_version") WHERE "normalization_runs"."trigger_id" is null;--> statement-breakpoint
CREATE INDEX "idx_normalization_runs_capture_lineage" ON "normalization_runs" USING btree ("capture_lineage_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_opportunities_projection_identity" ON "opportunities" USING btree ("projection_identity_key");--> statement-breakpoint
CREATE INDEX "idx_opportunities_job" ON "opportunities" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_opportunities_job_fact_version" ON "opportunities" USING btree ("job_fact_version_id");--> statement-breakpoint
CREATE INDEX "idx_opportunities_source_id" ON "opportunities" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_opportunities_source_status_discovered" ON "opportunities" USING btree ("source_id","merge_status","discovered_at");--> statement-breakpoint
CREATE INDEX "idx_policy_evidence_subject" ON "policy_evidence" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_policy_evidence_subject_tag" ON "policy_evidence" USING btree ("subject_type","subject_id","tag");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_retry_work_capture_identity" ON "retry_work" USING btree ("connector_instance_id","filter_signature","checkpoint_schema_version","checkpoint_generation") WHERE "retry_work"."kind" = 'connector_capture' and "retry_work"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_retry_work_normalization_identity" ON "retry_work" USING btree ("capture_evidence_version_id","resolver_id","resolver_version","input_hash") WHERE "retry_work"."kind" = 'normalization' and "retry_work"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_retry_work_due" ON "retry_work" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_retry_work_capture_pending" ON "retry_work" USING btree ("kind","connector_instance_id","filter_signature","state","next_attempt_at","updated_at") WHERE "retry_work"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_retry_work_normalization_pending" ON "retry_work" USING btree ("kind","execution_scope_id","state","next_attempt_at","created_at","capture_evidence_version_id") WHERE "retry_work"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_source_execution_scopes_availability" ON "source_execution_scopes" USING btree ("status","blocked_until");--> statement-breakpoint
CREATE INDEX "idx_sources_name" ON "sources" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_sourcing_projection_outcomes_evidence_version" ON "sourcing_projection_outcomes" USING btree ("capture_evidence_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sourcing_projection_outcomes_job_fact_version" ON "sourcing_projection_outcomes" USING btree ("job_fact_version_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_source_id" ON "workflow_runs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_source_type_status_started" ON "workflow_runs" USING btree ("source_id","run_type","status","started_at");--> statement-breakpoint

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_job_identity_bound() RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM job_identities WHERE job_id = NEW.job_id) >= 32 THEN
    RAISE EXCEPTION 'source entity identity bound is exhausted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_job_identities_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'source entity identities are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_job_identity_conflicts_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'source identity conflicts are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_projection_outcome_pending_insert() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    RAISE EXCEPTION 'projection outcome must begin pending';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_projection_outcome_terminal_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('projected', 'failed') THEN
    RAISE EXCEPTION 'projection outcome terminal transition is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_projection_outcome_lineage_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.capture_lineage_id IS DISTINCT FROM OLD.capture_lineage_id
    OR NEW.capture_evidence_version_id IS DISTINCT FROM OLD.capture_evidence_version_id
    OR NEW.job_fact_version_id IS DISTINCT FROM OLD.job_fact_version_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'projection outcome lineage is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION raise_projection_outcomes_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'projection outcomes are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_connector_instance_scope_required() RETURNS trigger AS $$
BEGIN
  IF NEW.execution_scope_id IS NULL OR NOT EXISTS (SELECT 1 FROM source_execution_scopes WHERE id = NEW.execution_scope_id) THEN
    RAISE EXCEPTION 'connector execution scope required';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_connector_instance_scope_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.execution_scope_id IS DISTINCT FROM OLD.execution_scope_id THEN
    RAISE EXCEPTION 'connector instance scope identity immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_connector_run_scope_required() RETURNS trigger AS $$
BEGIN
  IF NEW.execution_scope_id IS NULL OR NOT EXISTS (SELECT 1 FROM source_execution_scopes WHERE id = NEW.execution_scope_id) THEN
    RAISE EXCEPTION 'connector run execution scope required';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_retry_scope_required() RETURNS trigger AS $$
BEGIN
  IF NEW.execution_scope_id IS NULL OR NOT EXISTS (SELECT 1 FROM source_execution_scopes WHERE id = NEW.execution_scope_id) THEN
    RAISE EXCEPTION 'retry execution scope required';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_connector_run_scope_owner() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM connector_instances WHERE id = NEW.connector_instance_id AND execution_scope_id = NEW.execution_scope_id) THEN
    RAISE EXCEPTION 'connector run scope owner mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_capture_scope_owner() RETURNS trigger AS $$
BEGIN
  IF (NEW.connector_instance_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM connector_instances WHERE id = NEW.connector_instance_id AND execution_scope_id = NEW.execution_scope_id))
    OR (NEW.connector_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM connector_runs WHERE id = NEW.connector_run_id AND execution_scope_id = NEW.execution_scope_id AND connector_instance_id = NEW.connector_instance_id)) THEN
    RAISE EXCEPTION 'raw source occurrence scope owner mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_retry_work_scope_owner() RETURNS trigger AS $$
BEGIN
  IF (NEW.kind = 'connector_capture' AND NOT EXISTS (SELECT 1 FROM connector_instances WHERE id = NEW.connector_instance_id AND execution_scope_id = NEW.execution_scope_id))
    OR (NEW.kind = 'normalization' AND (NEW.lineage_json::jsonb)->>'connectorInstanceId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM connector_instances WHERE id = (NEW.lineage_json::jsonb)->>'connectorInstanceId' AND execution_scope_id = NEW.execution_scope_id))
    OR (NEW.kind = 'normalization' AND (NEW.lineage_json::jsonb)->>'connectorRunId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM connector_runs WHERE id = (NEW.lineage_json::jsonb)->>'connectorRunId' AND execution_scope_id = NEW.execution_scope_id AND connector_instance_id = (NEW.lineage_json::jsonb)->>'connectorInstanceId'))
    OR (NEW.acquisition_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM connector_runs WHERE id = NEW.acquisition_run_id AND execution_scope_id = NEW.execution_scope_id))
    OR (NEW.skipped_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM connector_runs WHERE id = NEW.skipped_run_id AND execution_scope_id = NEW.execution_scope_id)) THEN
    RAISE EXCEPTION 'retry work scope owner mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_connector_run_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status NOT IN ('queued','running','completed','failed','cancelled','skipped') THEN
    RAISE EXCEPTION 'invalid connector run status';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_normalization_trigger_lineage() RETURNS trigger AS $$
BEGIN
  IF NOT (
    (NEW.trigger_capture_id IS NULL AND NEW.trigger_connector_instance_id IS NULL AND NEW.trigger_connector_run_id IS NULL)
    OR (
      NEW.trigger_capture_id IS NOT NULL AND NEW.trigger_connector_instance_id IS NOT NULL AND NEW.trigger_connector_run_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM captures capture
        WHERE capture.id = NEW.trigger_capture_id
          AND capture.capture_evidence_version_id = NEW.capture_evidence_version_id
          AND capture.capture_lineage_id = NEW.capture_lineage_id
          AND capture.connector_instance_id = NEW.trigger_connector_instance_id
          AND capture.connector_run_id = NEW.trigger_connector_run_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'normalization trigger lineage is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_normalization_trigger_capture_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM normalization_runs run WHERE run.trigger_capture_id = OLD.id) THEN
      RAISE EXCEPTION 'normalization trigger occurrence is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.capture_lineage_id IS DISTINCT FROM OLD.capture_lineage_id
    OR NEW.capture_evidence_version_id IS DISTINCT FROM OLD.capture_evidence_version_id
    OR NEW.connector_instance_id IS DISTINCT FROM OLD.connector_instance_id
    OR NEW.connector_run_id IS DISTINCT FROM OLD.connector_run_id
  ) AND EXISTS (SELECT 1 FROM normalization_runs run WHERE run.trigger_capture_id = OLD.id) THEN
    RAISE EXCEPTION 'normalization trigger occurrence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_job_identities_bound
BEFORE INSERT ON job_identities
FOR EACH ROW EXECUTE FUNCTION enforce_job_identity_bound();--> statement-breakpoint
CREATE TRIGGER trg_job_identities_no_update
BEFORE UPDATE ON job_identities
FOR EACH ROW EXECUTE FUNCTION raise_job_identities_append_only();--> statement-breakpoint
CREATE TRIGGER trg_job_identities_no_delete
BEFORE DELETE ON job_identities
FOR EACH ROW EXECUTE FUNCTION raise_job_identities_append_only();--> statement-breakpoint
CREATE TRIGGER trg_job_identity_conflicts_no_update
BEFORE UPDATE ON job_identity_conflicts
FOR EACH ROW EXECUTE FUNCTION raise_job_identity_conflicts_append_only();--> statement-breakpoint
CREATE TRIGGER trg_job_identity_conflicts_no_delete
BEFORE DELETE ON job_identity_conflicts
FOR EACH ROW EXECUTE FUNCTION raise_job_identity_conflicts_append_only();--> statement-breakpoint
CREATE TRIGGER trg_sourcing_projection_outcomes_pending_insert
BEFORE INSERT ON sourcing_projection_outcomes
FOR EACH ROW EXECUTE FUNCTION enforce_projection_outcome_pending_insert();--> statement-breakpoint
CREATE TRIGGER trg_sourcing_projection_outcomes_terminal_transition
BEFORE UPDATE ON sourcing_projection_outcomes
FOR EACH ROW EXECUTE FUNCTION enforce_projection_outcome_terminal_transition();--> statement-breakpoint
CREATE TRIGGER trg_sourcing_projection_outcomes_lineage_immutable
BEFORE UPDATE ON sourcing_projection_outcomes
FOR EACH ROW EXECUTE FUNCTION enforce_projection_outcome_lineage_immutable();--> statement-breakpoint
CREATE TRIGGER trg_sourcing_projection_outcomes_no_delete
BEFORE DELETE ON sourcing_projection_outcomes
FOR EACH ROW EXECUTE FUNCTION raise_projection_outcomes_append_only();--> statement-breakpoint
CREATE TRIGGER connector_instances_scope_required_insert
BEFORE INSERT ON connector_instances
FOR EACH ROW EXECUTE FUNCTION enforce_connector_instance_scope_required();--> statement-breakpoint
CREATE TRIGGER connector_instances_scope_required_update
BEFORE UPDATE OF execution_scope_id ON connector_instances
FOR EACH ROW EXECUTE FUNCTION enforce_connector_instance_scope_required();--> statement-breakpoint
CREATE TRIGGER connector_instances_scope_immutable
BEFORE UPDATE OF execution_scope_id ON connector_instances
FOR EACH ROW EXECUTE FUNCTION enforce_connector_instance_scope_immutable();--> statement-breakpoint
CREATE TRIGGER connector_runs_scope_required_insert
BEFORE INSERT ON connector_runs
FOR EACH ROW EXECUTE FUNCTION enforce_connector_run_scope_required();--> statement-breakpoint
CREATE TRIGGER connector_runs_scope_required_update
BEFORE UPDATE OF execution_scope_id ON connector_runs
FOR EACH ROW EXECUTE FUNCTION enforce_connector_run_scope_required();--> statement-breakpoint
CREATE TRIGGER retry_work_scope_required_insert
BEFORE INSERT ON retry_work
FOR EACH ROW EXECUTE FUNCTION enforce_retry_scope_required();--> statement-breakpoint
CREATE TRIGGER retry_work_scope_required_update
BEFORE UPDATE OF execution_scope_id ON retry_work
FOR EACH ROW EXECUTE FUNCTION enforce_retry_scope_required();--> statement-breakpoint
CREATE TRIGGER connector_runs_scope_owner_insert
BEFORE INSERT ON connector_runs
FOR EACH ROW EXECUTE FUNCTION enforce_connector_run_scope_owner();--> statement-breakpoint
CREATE TRIGGER connector_runs_scope_owner_update
BEFORE UPDATE OF execution_scope_id, connector_instance_id ON connector_runs
FOR EACH ROW EXECUTE FUNCTION enforce_connector_run_scope_owner();--> statement-breakpoint
CREATE TRIGGER captures_scope_owner_insert
BEFORE INSERT ON captures
FOR EACH ROW EXECUTE FUNCTION enforce_capture_scope_owner();--> statement-breakpoint
CREATE TRIGGER captures_scope_owner_update
BEFORE UPDATE OF execution_scope_id, connector_instance_id, connector_run_id ON captures
FOR EACH ROW EXECUTE FUNCTION enforce_capture_scope_owner();--> statement-breakpoint
CREATE TRIGGER retry_work_scope_owner_insert
BEFORE INSERT ON retry_work
FOR EACH ROW EXECUTE FUNCTION enforce_retry_work_scope_owner();--> statement-breakpoint
CREATE TRIGGER retry_work_scope_owner_update
BEFORE UPDATE OF execution_scope_id, connector_instance_id, lineage_json, acquisition_run_id, skipped_run_id ON retry_work
FOR EACH ROW EXECUTE FUNCTION enforce_retry_work_scope_owner();--> statement-breakpoint
CREATE TRIGGER connector_runs_status_insert
BEFORE INSERT ON connector_runs
FOR EACH ROW EXECUTE FUNCTION enforce_connector_run_status();--> statement-breakpoint
CREATE TRIGGER connector_runs_status_update
BEFORE UPDATE OF status ON connector_runs
FOR EACH ROW EXECUTE FUNCTION enforce_connector_run_status();--> statement-breakpoint
CREATE TRIGGER trg_normalization_runs_trigger_lineage_insert
BEFORE INSERT ON normalization_runs
FOR EACH ROW EXECUTE FUNCTION enforce_normalization_trigger_lineage();--> statement-breakpoint
CREATE TRIGGER trg_normalization_runs_trigger_lineage_update
BEFORE UPDATE OF trigger_capture_id, trigger_connector_instance_id, trigger_connector_run_id, capture_evidence_version_id, capture_lineage_id ON normalization_runs
FOR EACH ROW EXECUTE FUNCTION enforce_normalization_trigger_lineage();--> statement-breakpoint
CREATE TRIGGER trg_captures_normalization_lineage_update
BEFORE UPDATE OF id, capture_lineage_id, capture_evidence_version_id, connector_instance_id, connector_run_id ON captures
FOR EACH ROW EXECUTE FUNCTION enforce_normalization_trigger_capture_immutable();--> statement-breakpoint
CREATE TRIGGER trg_captures_normalization_lineage_delete
BEFORE DELETE ON captures
FOR EACH ROW EXECUTE FUNCTION enforce_normalization_trigger_capture_immutable();
