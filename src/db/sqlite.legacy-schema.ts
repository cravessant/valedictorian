import {
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_CONNECTOR_VERSION,
} from '../modules/connectors/jobright.constants'
import type Database from 'better-sqlite3'

function tableExists(database: Database.Database, tableName: string) {
  const row = database
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(tableName)

  return Boolean(row)
}

export function migrateLegacyDatabaseSchema(database: Database.Database) {
  database.exec(`
    pragma defer_foreign_keys = on;
    drop table if exists connector_projection_keys;
    drop table if exists connector_observations;
    drop table if exists normalization_field_outcomes;
    drop table if exists normalization_gates;
    drop table if exists canonical_source_candidates;
    drop table if exists normalization_replay_items;
    drop table if exists normalization_attempts;
    drop table if exists normalization_runs;
    drop table if exists normalization_replay_requests;
    drop table if exists source_identity_conflicts;
    drop table if exists source_entity_identities;
    drop table if exists raw_source_occurrences;
    drop table if exists raw_source_revisions;
    drop table if exists raw_source_records;
    drop table if exists source_entities;
    drop table if exists connector_checkpoints;
    drop table if exists connector_runs;
    drop table if exists sourcing_findings;
  `)
  database.exec(`
    pragma foreign_keys = on;

    create table if not exists companies (
      id text primary key,
      name text not null,
      normalized_name text not null,
      website_url text,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists sources (
      id text primary key,
      name text not null,
      account_hint text,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists applications (
      id text primary key,
      company_id text not null references companies(id),
      source_id text not null references sources(id),
      role_title text not null,
      role_kind text not null,
      term text,
      timing_mode text not null default 'unknown',
      terms_json text not null default '[]',
      start_date text,
      end_date text,
      city text,
      region text,
      country text not null,
      work_mode text not null,
      location_raw text,
      status text not null,
      has_applied integer not null,
      current_priority_score integer,
      current_priority_band text,
      current_resume_variant text,
      notes text,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists application_links (
      id text primary key,
      application_id text not null references applications(id),
      kind text not null,
      label text not null,
      url text not null,
      external_id text,
      is_primary integer not null,
      discovered_at text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists application_scores (
      id text primary key,
      application_id text not null references applications(id),
      score integer not null,
      band text not null,
      role_relevance integer not null,
      career_signal integer not null,
      city_work_mode integer not null,
      compensation_logistics integer not null,
      penalties_json text not null,
      rationale text not null,
      rubric_version text not null,
      created_at text not null
    );

    create table if not exists application_workflow_states (
      application_id text primary key references applications(id),
      lock_started_at text,
      hold_started_at text,
      manual_review_kind text,
      missing_user_info text,
      blocker_reason text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists application_events (
      id text primary key,
      application_id text not null references applications(id),
      type text not null,
      message text not null,
      payload_json text not null,
      actor text not null,
      created_at text not null
    );

    create table if not exists application_attempts (
      id text primary key,
      application_id text not null references applications(id),
      status text not null,
      outcome text,
      actor_type text not null,
      actor_name text,
      entry_url text,
      resume_variant text,
      resume_artifact_path text,
      summary text,
      stop_reason text,
      confirmation_url text,
      confirmation_text text,
      started_at text not null,
      completed_at text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists application_attempt_steps (
      id text primary key,
      attempt_id text not null references application_attempts(id),
      application_id text not null references applications(id),
      sequence integer not null,
      type text not null,
      message text not null,
      payload_json text not null,
      actor text not null,
      created_at text not null
    );

    create table if not exists workflow_runs (
      id text primary key,
      run_type text not null,
      status text not null,
      actor_type text not null,
      actor_name text,
      source_id text references sources(id),
      subject_application_id text references applications(id),
      started_at text not null,
      completed_at text,
      coverage_started_at text,
      coverage_ended_at text,
      timezone text,
      input_json text not null,
      summary text,
      outcome text,
      blocker text,
      metadata_json text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists workflow_run_steps (
      id text primary key,
      workflow_run_id text not null references workflow_runs(id),
      sequence integer not null,
      type text not null,
      message text not null,
      payload_json text not null,
      actor text not null,
      created_at text not null
    );

    create table if not exists user_profile (
      id text primary key,
      address_line_1 text,
      address_line_2 text,
      city text,
      country text,
      citizenship text,
      class_standing text,
      cover_letter_path text,
      degree text,
      email text,
      full_name text,
      github_url text,
      graduation_date text,
      high_school text,
      language text,
      linkedin_url text,
      major text,
      phone text,
      phone_device_type text,
      portfolio_url text,
      preferred_name text,
      region text,
      relocation text,
      relocation_notes text,
      require_sponsorship text,
      require_sponsorship_future text,
      sat_score text,
      school text,
      transcript_path text,
      travel text,
      travel_notes text,
      willing_to_relocate integer,
      willing_to_travel integer,
      work_authorization text,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists profile_education (
      id text primary key,
      education_type text not null,
      school text not null,
      degree text,
      major text,
      graduation_date text,
      class_standing text,
      sat_score text,
      transcript_path text,
      notes text,
      sort_order integer not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists profile_answers (
      key text primary key,
      label text not null,
      question_pattern text not null,
      answer text not null,
      category text,
      include_in_agent_context integer not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists profile_secrets (
      key text primary key,
      label text not null,
      kind text not null,
      encrypted_value text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists profile_sensitive_details (
      id text primary key,
      birth_day_encrypted text,
      birth_month_encrypted text,
      birth_year_encrypted text,
      date_of_birth_encrypted text,
      disability_status_encrypted text,
      gender_encrypted text,
      hispanic_latino_encrypted text,
      race_ethnicity_encrypted text,
      ssn_last_4_encrypted text,
      veteran_status_encrypted text,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists policy_config (
      id text primary key,
      config_json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists policy_evidence (
      id text primary key,
      subject_type text not null,
      subject_id text not null,
      tag text not null,
      source text not null,
      note text,
      payload_json text not null,
      created_at text not null
    );

    create table if not exists connector_instances (
      id text primary key,
      connector_id text not null,
      connector_version text not null,
      display_name text not null,
      enabled integer not null,
      config_json text not null,
      auth_json text not null default '[]',
      filters_json text not null default '{}',
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists connector_runs (
      id text primary key,
      connector_instance_id text not null references connector_instances(id),
      mode text not null,
      status text not null,
      started_at text not null,
      completed_at text,
      coverage_started_at text,
      coverage_ended_at text,
      config_json text not null default '{}',
      filters_json text not null default '{}',
      filter_signature text not null default 'filters:{}',
      observation_count integer not null,
      warning_count integer not null,
      stats_json text not null,
      warnings_json text not null,
      retry_hints_json text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists connector_checkpoints (
      connector_instance_id text not null references connector_instances(id),
      filter_signature text not null default 'filters:{}',
      checkpoint_json text not null,
      schema_version text not null,
      coverage_started_at text,
      coverage_ended_at text,
      saved_at text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text,
      primary key (connector_instance_id, filter_signature)
    );

    create table if not exists connector_observations (
      id text primary key,
      connector_instance_id text not null references connector_instances(id),
      connector_run_id text not null references connector_runs(id),
      connector_id text not null,
      connector_version text not null,
      parser_version text,
      observation_schema_version text,
      source_record_key text not null,
      observed_at text not null,
      company_name text not null,
      role_title text not null,
      location_raw text,
      description_text text,
      pay_json text not null,
      links_json text not null,
      resolution_json text not null,
      dedupe_keys_json text not null,
      source_metadata_json text not null,
      evidence_json text not null,
      raw_json text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create table if not exists source_entities (
      id text primary key not null,
      identity_kind text not null,
      identity_namespace text not null,
      identity_value text not null,
      created_at text not null,
      constraint chk_source_entities_identity_kind_length
        check (length(identity_kind) between 1 and 64),
      constraint chk_source_entities_identity_namespace_length
        check (length(identity_namespace) between 1 and 4096),
      constraint chk_source_entities_identity_value_length
        check (length(identity_value) between 1 and 2048)
    );

    create table if not exists raw_source_records (
      id text primary key not null,
      source_entity_id text references source_entities(id),
      created_at text not null
    );

    create table if not exists raw_source_revisions (
      id text primary key not null,
      raw_record_id text not null references raw_source_records(id),
      revision integer not null,
      content_hash text not null,
      adapter_id text not null,
      adapter_kind text not null,
      adapter_version text not null,
      reported_origin_kind text,
      reported_origin_name text,
      reported_origin_provider_id text,
      reported_origin_url text,
      observed_at text not null,
      provider_record_id text,
      provider_schema text,
      payload_json text,
      evidence_json text not null,
      created_at text not null
    );

    create table if not exists raw_source_occurrences (
      id text primary key not null,
      raw_record_id text not null references raw_source_records(id),
      raw_revision_id text not null references raw_source_revisions(id),
      connector_instance_id text references connector_instances(id),
      connector_run_id text references connector_runs(id),
      observed_at text not null,
      received_at text not null,
      foreign key (raw_revision_id, raw_record_id)
        references raw_source_revisions(id, raw_record_id),
      foreign key (connector_run_id, connector_instance_id)
        references connector_runs(id, connector_instance_id),
      constraint chk_raw_source_occurrences_connector_capture check(
        (connector_instance_id is null and connector_run_id is null)
        or (connector_instance_id is not null and connector_run_id is not null)
      )
    );

    create table if not exists source_entity_identities (
      id text primary key not null,
      source_entity_id text not null references source_entities(id),
      identity_kind text not null,
      identity_namespace text not null,
      identity_value text not null,
      provenance_kind text not null,
      provenance_version text not null,
      evidence_json text not null,
      raw_revision_id text references raw_source_revisions(id),
      created_at text not null,
      constraint chk_source_entity_identities_kind check(identity_kind in ('provider_job','canonical_destination','intermediary_alias','destination_alias')),
      constraint chk_source_entity_identities_namespace_length check(length(identity_namespace) between 1 and 512),
      constraint chk_source_entity_identities_value_length check(length(identity_value) between 1 and 2048),
      constraint chk_source_entity_identities_provenance_kind check(provenance_kind in ('primary_backfill','capture','normalization')),
      constraint chk_source_entity_identities_provenance_version_length check(length(provenance_version) between 1 and 128),
      constraint chk_source_entity_identities_evidence_length check(length(evidence_json) between 2 and 16384)
    );

    create table if not exists source_identity_conflicts (
      id text primary key not null,
      source_entity_id text not null references source_entities(id),
      conflicting_source_entity_id text references source_entities(id),
      raw_revision_id text not null references raw_source_revisions(id),
      identity_kind text not null,
      identity_namespace text not null,
      identity_value text not null,
      reason text not null,
      provenance_version text not null,
      evidence_json text not null,
      created_at text not null,
      constraint chk_source_identity_conflicts_kind check(identity_kind in ('provider_job','canonical_destination','intermediary_alias','destination_alias')),
      constraint chk_source_identity_conflicts_namespace_length check(length(identity_namespace) between 1 and 512),
      constraint chk_source_identity_conflicts_value_length check(length(identity_value) between 1 and 2048),
      constraint chk_source_identity_conflicts_reason_length check(length(reason) between 1 and 512),
      constraint chk_source_identity_conflicts_provenance_version_length check(length(provenance_version) between 1 and 128),
      constraint chk_source_identity_conflicts_evidence_length check(length(evidence_json) between 2 and 16384)
    );

    create table if not exists normalization_runs (
      id text primary key not null,
      raw_record_id text not null references raw_source_records(id),
      raw_revision_id text not null references raw_source_revisions(id),
      input_hash text not null,
      resolver_set_hash text not null,
      canonical_schema_version text not null,
      gate_policy_version text not null,
      trigger_kind text not null default 'intake',
      trigger_id text,
      status text not null,
      created_at text not null,
      updated_at text not null,
      constraint chk_normalization_runs_status check(status in ('pending','in_progress','completed','blocked','failed')),
      constraint chk_normalization_runs_trigger_kind check(trigger_kind in ('intake'))
    );

    create table if not exists normalization_replay_requests (
      id text primary key not null,
      selector_json text not null,
      invalidation_json text not null,
      target_versions_json text,
      field_directives_json text not null,
      status text not null,
      accepted_at text not null,
      completed_at text,
      constraint chk_normalization_replay_requests_status check(status in ('accepted','in_progress','completed','completed_with_failures'))
    );

    create table if not exists normalization_replay_items (
      id text primary key not null,
      replay_id text not null references normalization_replay_requests(id),
      raw_record_id text not null references raw_source_records(id),
      raw_revision_id text not null references raw_source_revisions(id),
      input_hash text not null,
      sequence integer not null,
      status text not null,
      normalization_run_id text references normalization_runs(id),
      failure_json text,
      completed_at text,
      constraint chk_normalization_replay_items_status check(status in ('pending','completed','failed'))
    );

    create table if not exists normalization_attempts (
      id text primary key not null,
      run_id text not null references normalization_runs(id),
      raw_revision_id text not null references raw_source_revisions(id),
      sequence integer not null,
      resolver_id text not null,
      resolver_version text not null,
      input_hash text not null,
      declaration_json text not null,
      applicability_json text not null,
      status text not null,
      started_at text not null,
      completed_at text
    );

    create table if not exists normalization_field_outcomes (
      id text primary key not null,
      run_id text not null references normalization_runs(id),
      attempt_id text not null references normalization_attempts(id),
      sequence integer not null,
      attempt_sequence integer not null,
      outcome_index integer not null,
      field text not null,
      status text not null,
      resolver_id text not null,
      resolver_version text not null,
      input_hash text not null,
      outcome_json text not null
    );

    create table if not exists canonical_source_candidates (
      id text primary key not null,
      run_id text not null references normalization_runs(id),
      source_entity_id text not null references source_entities(id),
      raw_record_id text not null references raw_source_records(id),
      raw_revision_id text not null references raw_source_revisions(id),
      schema_version text not null,
      candidate_json text not null,
      created_at text not null
    );

    create table if not exists normalization_gates (
      id text primary key not null,
      run_id text not null references normalization_runs(id),
      policy_version text not null,
      status text not null,
      candidate_id text references canonical_source_candidates(id),
      gate_json text not null,
      evaluated_at text not null,
      constraint chk_normalization_gates_status check(status in ('passed','needs_enrichment','rejected','failed')),
      constraint chk_normalization_gates_candidate check((status = 'passed' and candidate_id is not null) or (status <> 'passed' and candidate_id is null))
    );

    create table if not exists sourcing_findings (
      id text primary key,
      projection_identity_key text,
      source_entity_id text references source_entities(id),
      canonical_candidate_id text references canonical_source_candidates(id),
      raw_revision_id text references raw_source_revisions(id),
      adapter_id text,
      adapter_kind text,
      adapter_version text,
      workflow_run_id text not null references workflow_runs(id),
      source_id text not null references sources(id),
      company_name text not null,
      role_title text not null,
      role_kind text not null,
      term text,
      timing_mode text not null default 'unknown',
      terms_json text not null default '[]',
      start_date text,
      end_date text,
      city text,
      region text,
      country text,
      work_mode text not null,
      location_raw text,
      employment_type text,
      seniority text,
      location_json text,
      compensation_json text,
      posted_at_json text,
      official_url text,
      source_url text,
      destination_class text,
      destination_url text,
      intermediary_url text,
      usability text,
      posted_age text,
      priority_score integer,
      priority_band text,
      fit_notes text,
      duplicate_notes text,
      blocker text,
      policy_blocker text,
      disposition_reason text,
      merge_status text not null,
      merged_application_id text references applications(id),
      merge_notes text,
      discovered_at text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create index if not exists idx_sources_name on sources(name);
    create index if not exists idx_workflow_runs_source_id on workflow_runs(source_id);
    create index if not exists idx_workflow_runs_source_type_status_started
      on workflow_runs(source_id, run_type, status, started_at);
    create index if not exists idx_sourcing_findings_source_id on sourcing_findings(source_id);
    create unique index if not exists idx_sourcing_findings_projection_identity
      on sourcing_findings(projection_identity_key);
    create index if not exists idx_sourcing_findings_source_entity
      on sourcing_findings(source_entity_id);
    create unique index if not exists idx_sourcing_findings_canonical_candidate
      on sourcing_findings(canonical_candidate_id);
    create index if not exists idx_sourcing_findings_source_status_discovered
      on sourcing_findings(source_id, merge_status, discovered_at);
    create index if not exists idx_policy_evidence_subject
      on policy_evidence(subject_type, subject_id);
    create index if not exists idx_policy_evidence_subject_tag
      on policy_evidence(subject_type, subject_id, tag);
    create index if not exists idx_connector_instances_connector
      on connector_instances(connector_id);
    create index if not exists idx_connector_instances_enabled
      on connector_instances(enabled);
    create index if not exists idx_connector_runs_instance
      on connector_runs(connector_instance_id);
    create unique index if not exists idx_connector_runs_id_instance
      on connector_runs(id, connector_instance_id);
    create index if not exists idx_connector_runs_instance_status_started
      on connector_runs(connector_instance_id, status, started_at);
    create index if not exists idx_connector_checkpoints_instance
      on connector_checkpoints(connector_instance_id);
    create index if not exists idx_connector_observations_instance
      on connector_observations(connector_instance_id);
    create index if not exists idx_connector_observations_run
      on connector_observations(connector_run_id);
    create index if not exists idx_connector_observations_source_record
      on connector_observations(connector_instance_id, source_record_key);
    create unique index if not exists idx_source_entities_identity
      on source_entities(identity_kind, identity_namespace, identity_value);
    create unique index if not exists idx_source_entity_identities_identity
      on source_entity_identities(identity_kind, identity_namespace, identity_value);
    create index if not exists idx_source_entity_identities_entity_chronology
      on source_entity_identities(source_entity_id, created_at, id);
    create unique index if not exists idx_source_identity_conflicts_occurrence
      on source_identity_conflicts(source_entity_id, raw_revision_id, identity_kind, identity_namespace, identity_value, reason);
    create index if not exists idx_source_identity_conflicts_chronology
      on source_identity_conflicts(created_at, id);
    create trigger if not exists trg_source_entity_identities_bound
      before insert on source_entity_identities
      when (
        select count(*) from source_entity_identities
        where source_entity_id = new.source_entity_id
      ) >= 32
      begin select raise(abort, 'source entity identity bound is exhausted'); end;
    create trigger if not exists trg_source_entity_identities_no_update
      before update on source_entity_identities
      begin select raise(abort, 'source entity identities are append-only'); end;
    create trigger if not exists trg_source_entity_identities_no_delete
      before delete on source_entity_identities
      begin select raise(abort, 'source entity identities are append-only'); end;
    create trigger if not exists trg_source_identity_conflicts_no_update
      before update on source_identity_conflicts
      begin select raise(abort, 'source identity conflicts are append-only'); end;
    create trigger if not exists trg_source_identity_conflicts_no_delete
      before delete on source_identity_conflicts
      begin select raise(abort, 'source identity conflicts are append-only'); end;
    create unique index if not exists idx_raw_source_records_source_entity
      on raw_source_records(source_entity_id);
    create unique index if not exists idx_raw_source_revisions_record_revision
      on raw_source_revisions(raw_record_id, revision);
    create unique index if not exists idx_raw_source_revisions_id_record
      on raw_source_revisions(id, raw_record_id);
    create unique index if not exists idx_raw_source_revisions_record_hash
      on raw_source_revisions(raw_record_id, content_hash);
    create index if not exists idx_raw_source_occurrences_record_chronology
      on raw_source_occurrences(raw_record_id, observed_at, received_at, id);
    create unique index if not exists idx_raw_source_occurrences_lineage
      on raw_source_occurrences(id, raw_revision_id, raw_record_id);
    create unique index if not exists idx_raw_source_occurrences_connector_lineage
      on raw_source_occurrences(
        id, raw_revision_id, raw_record_id, connector_instance_id, connector_run_id
      );
    create unique index if not exists idx_normalization_runs_cache
      on normalization_runs(raw_revision_id, input_hash, resolver_set_hash, canonical_schema_version, gate_policy_version)
      where "normalization_runs"."trigger_id" is null;
    create index if not exists idx_normalization_runs_raw_record
      on normalization_runs(raw_record_id, created_at);
    create unique index if not exists idx_normalization_attempts_run_sequence
      on normalization_attempts(run_id, sequence);
    create index if not exists idx_normalization_attempts_resolver
      on normalization_attempts(resolver_id, resolver_version, input_hash);
    create unique index if not exists idx_normalization_field_outcomes_run_sequence
      on normalization_field_outcomes(run_id, sequence);
    create index if not exists idx_normalization_field_outcomes_selector
      on normalization_field_outcomes(run_id, field, attempt_sequence, outcome_index);
    create index if not exists idx_normalization_field_outcomes_resolver
      on normalization_field_outcomes(resolver_id, resolver_version, input_hash);
    create unique index if not exists idx_canonical_source_candidates_run
      on canonical_source_candidates(run_id);
    create index if not exists idx_canonical_source_candidates_revision_schema
      on canonical_source_candidates(raw_revision_id, schema_version);
    create unique index if not exists idx_normalization_gates_run
      on normalization_gates(run_id);
    create index if not exists idx_normalization_gates_policy
      on normalization_gates(policy_version, status);
    create index if not exists idx_normalization_replay_requests_chronology
      on normalization_replay_requests(accepted_at, id);
    create unique index if not exists idx_normalization_replay_items_sequence
      on normalization_replay_items(replay_id, sequence);
    create unique index if not exists idx_normalization_replay_items_revision
      on normalization_replay_items(replay_id, raw_revision_id);
    create index if not exists idx_raw_source_occurrences_revision
      on raw_source_occurrences(raw_revision_id);
    create index if not exists idx_raw_source_occurrences_connector_run
      on raw_source_occurrences(connector_run_id);

  `)

  ensureColumns(database, 'normalization_runs', [
    ['trigger_occurrence_id', 'text'],
    ['trigger_connector_instance_id', 'text'],
    ['trigger_connector_run_id', 'text'],
  ])
  database.exec(`
    create trigger if not exists trg_normalization_runs_trigger_lineage_insert
    before insert on normalization_runs
    when not (
      (new.trigger_occurrence_id is null and new.trigger_connector_instance_id is null
        and new.trigger_connector_run_id is null)
      or (
        new.trigger_occurrence_id is not null and new.trigger_connector_instance_id is not null
        and new.trigger_connector_run_id is not null and exists (
          select 1 from raw_source_occurrences occurrence
          where occurrence.id = new.trigger_occurrence_id
            and occurrence.raw_revision_id = new.raw_revision_id
            and occurrence.raw_record_id = new.raw_record_id
            and occurrence.connector_instance_id = new.trigger_connector_instance_id
            and occurrence.connector_run_id = new.trigger_connector_run_id
        )
      )
    )
    begin select raise(abort, 'normalization trigger lineage mismatch'); end;
    create trigger if not exists trg_normalization_runs_trigger_lineage_update
    before update of trigger_occurrence_id, trigger_connector_instance_id,
      trigger_connector_run_id, raw_revision_id, raw_record_id on normalization_runs
    when not (
      (new.trigger_occurrence_id is null and new.trigger_connector_instance_id is null
        and new.trigger_connector_run_id is null)
      or (
        new.trigger_occurrence_id is not null and new.trigger_connector_instance_id is not null
        and new.trigger_connector_run_id is not null and exists (
          select 1 from raw_source_occurrences occurrence
          where occurrence.id = new.trigger_occurrence_id
            and occurrence.raw_revision_id = new.raw_revision_id
            and occurrence.raw_record_id = new.raw_record_id
            and occurrence.connector_instance_id = new.trigger_connector_instance_id
            and occurrence.connector_run_id = new.trigger_connector_run_id
        )
      )
    )
    begin select raise(abort, 'normalization trigger lineage mismatch'); end;
    create trigger if not exists trg_raw_source_occurrences_normalization_lineage_update
    before update of id, raw_record_id, raw_revision_id, connector_instance_id,
      connector_run_id on raw_source_occurrences
    when (
      new.id is not old.id
      or new.raw_record_id is not old.raw_record_id
      or new.raw_revision_id is not old.raw_revision_id
      or new.connector_instance_id is not old.connector_instance_id
      or new.connector_run_id is not old.connector_run_id
    ) and exists (
      select 1 from normalization_runs run where run.trigger_occurrence_id = old.id
    )
    begin select raise(abort, 'normalization trigger occurrence is immutable'); end;
    create trigger if not exists trg_raw_source_occurrences_normalization_lineage_delete
    before delete on raw_source_occurrences
    when exists (
      select 1 from normalization_runs run where run.trigger_occurrence_id = old.id
    )
    begin select raise(abort, 'normalization trigger occurrence is immutable'); end;
  `)

  ensureColumns(database, 'user_profile', [
    ['address_line_1', 'text'],
    ['address_line_2', 'text'],
    ['citizenship', 'text'],
    ['class_standing', 'text'],
    ['cover_letter_path', 'text'],
    ['degree', 'text'],
    ['high_school', 'text'],
    ['language', 'text'],
    ['major', 'text'],
    ['phone_device_type', 'text'],
    ['relocation', 'text'],
    ['relocation_notes', 'text'],
    ['require_sponsorship', 'text'],
    ['require_sponsorship_future', 'text'],
    ['sat_score', 'text'],
    ['transcript_path', 'text'],
    ['travel', 'text'],
    ['travel_notes', 'text'],
    ['willing_to_relocate', 'integer'],
    ['willing_to_travel', 'integer'],
  ])
  ensureColumns(database, 'applications', [
    ['timing_mode', "text not null default 'unknown'"],
    ['terms_json', "text not null default '[]'"],
    ['start_date', 'text'],
    ['end_date', 'text'],
  ])
  ensureColumns(database, 'sourcing_findings', [
    ['projection_identity_key', 'text'],
    ['source_entity_id', 'text'],
    ['canonical_candidate_id', 'text'],
    ['raw_revision_id', 'text'],
    ['adapter_id', 'text'],
    ['adapter_kind', 'text'],
    ['adapter_version', 'text'],
    ['timing_mode', "text not null default 'unknown'"],
    ['terms_json', "text not null default '[]'"],
    ['start_date', 'text'],
    ['end_date', 'text'],
    ['employment_type', 'text'],
    ['seniority', 'text'],
    ['location_json', 'text'],
    ['compensation_json', 'text'],
    ['posted_at_json', 'text'],
  ])
  ensureColumns(database, 'profile_sensitive_details', [
    ['birth_day_encrypted', 'text'],
    ['birth_month_encrypted', 'text'],
    ['birth_year_encrypted', 'text'],
    ['date_of_birth_encrypted', 'text'],
    ['disability_status_encrypted', 'text'],
    ['gender_encrypted', 'text'],
    ['hispanic_latino_encrypted', 'text'],
    ['race_ethnicity_encrypted', 'text'],
    ['ssn_last_4_encrypted', 'text'],
    ['veteran_status_encrypted', 'text'],
  ])
  ensureColumns(database, 'sourcing_findings', [
    ['policy_blocker', 'text'],
    ['disposition_reason', 'text'],
  ])
  ensureColumns(database, 'connector_instances', [
    ['auth_json', "text not null default '[]'"],
    ['filters_json', "text not null default '{}'"],
  ])
  ensureColumns(database, 'connector_runs', [
    ['config_json', "text not null default '{}'"],
    ['filters_json', "text not null default '{}'"],
    ['filter_signature', "text not null default 'filters:{}'"],
  ])
  ensureConnectorCheckpointFilterScope(database)
  ensureColumns(database, 'connector_observations', [
    ['parser_version', 'text'],
    ['observation_schema_version', 'text'],
  ])
  database.prepare(`
    update connector_instances set connector_version = ? where connector_id = ?
  `).run(JOBRIGHT_CONNECTOR_VERSION, JOBRIGHT_CONNECTOR_ID)
}

function ensureConnectorCheckpointFilterScope(database: Database.Database) {
  if (!tableExists(database, 'connector_checkpoints')) {
    return
  }

  const tableInfo = database.prepare('pragma table_info(connector_checkpoints)').all() as Array<{
    name: string
    pk: number
  }>
  const existingColumns = new Set(tableInfo.map((column) => column.name))
  const primaryKeyColumns = tableInfo
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name)

  if (
    existingColumns.has('filter_signature') &&
    primaryKeyColumns.join(',') === 'connector_instance_id,filter_signature'
  ) {
    database.exec(`
      create index if not exists idx_connector_checkpoints_instance
        on connector_checkpoints(connector_instance_id);
    `)
    return
  }

  const filterSignatureExpression = existingColumns.has('filter_signature')
    ? "coalesce(filter_signature, 'filters:{}')"
    : "'filters:{}'"

  database.exec(`
    pragma foreign_keys = off;

    create table connector_checkpoints_next (
      connector_instance_id text not null references connector_instances(id),
      filter_signature text not null default 'filters:{}',
      checkpoint_json text not null,
      schema_version text not null,
      coverage_started_at text,
      coverage_ended_at text,
      saved_at text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text,
      primary key (connector_instance_id, filter_signature)
    );

    insert into connector_checkpoints_next (
      connector_instance_id,
      filter_signature,
      checkpoint_json,
      schema_version,
      coverage_started_at,
      coverage_ended_at,
      saved_at,
      created_at,
      updated_at,
      deleted_at
    )
    select
      connector_instance_id,
      ${filterSignatureExpression},
      checkpoint_json,
      schema_version,
      coverage_started_at,
      coverage_ended_at,
      saved_at,
      created_at,
      updated_at,
      deleted_at
    from connector_checkpoints;

    drop table connector_checkpoints;
    alter table connector_checkpoints_next rename to connector_checkpoints;

    create index if not exists idx_connector_checkpoints_instance
      on connector_checkpoints(connector_instance_id);

    pragma foreign_keys = on;
  `)
}

function ensureColumns(database: Database.Database, tableName: string, columns: Array<[string, string]>) {
  const existingColumns = new Set(
    (database.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )

  for (const [name, definition] of columns) {
    if (!existingColumns.has(name)) {
      database.exec(`alter table ${tableName} add column ${name} ${definition}`)
    }
  }
}
