-- Final lifecycle cutover (#307). The migration runner wraps this journal entry in
-- one transaction. Preconditions are deliberate and exact: a partial/unknown
-- schema must fail instead of being hidden behind IF EXISTS.

-- connector_capture_work becomes the sole connector retry owner. Claims imported
-- by 0001 cannot survive an application restart, so they are explicitly reported
-- and returned to scheduled before acquisition metadata is cleared.
ALTER TABLE "connector_capture_work" ADD COLUMN "last_attempt_at" text;
--> statement-breakpoint
ALTER TABLE "connector_capture_work" ADD COLUMN "computed_delay_ms" integer;
--> statement-breakpoint
ALTER TABLE "connector_capture_work" ADD COLUMN "server_minimum_delay_ms" integer;
--> statement-breakpoint
ALTER TABLE "connector_capture_work" ADD COLUMN "horizon_at" text;
--> statement-breakpoint
ALTER TABLE "connector_capture_work" ADD COLUMN "acquisition_run_id" text;
--> statement-breakpoint
ALTER TABLE "connector_capture_work" ADD COLUMN "skipped_run_id" text;
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT 'cutover_connector_claim_reset:' || "id", 'reset', 'connector_capture_work', "id",
  'independently claimed connector capture work returned to scheduled',
  json_build_object('previousStatus', "status")::text, '2026-07-22T00:00:00.000Z'
FROM "connector_capture_work" cw
WHERE cw."status" = 'claimed'
  AND NOT EXISTS (
    SELECT 1 FROM "retry_work" rw
    WHERE rw."id" = cw."id" AND rw."kind" = 'connector_capture'
      AND rw."deleted_at" IS NULL AND rw."state" = 'acquired'
  )
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT 'cutover_retry_acquired_reset:' || rw."id", 'reset', 'retry_work', rw."id",
  'legacy acquired connector retry returned to scheduled',
  json_build_object(
    'previousState', rw."state",
    'copyDisposition', CASE
      WHEN EXISTS (SELECT 1 FROM "connector_capture_work" cw WHERE cw."id" = rw."id") THEN 'updated_existing_copy'
      ELSE 'inserted_late_copy'
    END
  )::text,
  '2026-07-22T00:00:00.000Z'
FROM "retry_work" rw
WHERE rw."kind" = 'connector_capture' AND rw."deleted_at" IS NULL
  AND rw."connector_instance_id" IS NOT NULL AND rw."state" = 'acquired'
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "connector_capture_work" cw SET
  "attempt" = greatest(rw."attempt", 1),
  "max_attempts" = greatest(rw."max_attempts", rw."attempt", 1),
  "status" = CASE WHEN rw."state" = 'acquired' THEN 'scheduled' ELSE rw."state" END,
  "next_eligible_at" = CASE WHEN rw."state" IN ('scheduled','acquired') THEN coalesce(rw."next_attempt_at", rw."updated_at") ELSE NULL END,
  "failure_reason" = CASE WHEN rw."state" = 'exhausted' THEN rw."reason" ELSE NULL END,
  "owner_version" = rw."owner_version",
  "acquisition_token" = NULL,
  "claimed_at" = NULL,
  "claim_expires_at" = NULL,
  "last_attempt_at" = rw."last_attempt_at",
  "computed_delay_ms" = rw."computed_delay_ms",
  "server_minimum_delay_ms" = rw."server_minimum_delay_ms",
  "horizon_at" = rw."horizon_at",
  "acquisition_run_id" = NULL,
  "skipped_run_id" = rw."skipped_run_id",
  "updated_at" = rw."updated_at"
FROM "retry_work" rw
WHERE cw."id" = rw."id" AND rw."kind" = 'connector_capture' AND rw."deleted_at" IS NULL;
--> statement-breakpoint
INSERT INTO "connector_capture_work" (
  "id", "workspace_id", "idempotency_key", "attempt", "max_attempts", "status", "next_eligible_at",
  "failure_reason", "failure_detail", "owner_version", "acquisition_token", "claimed_at", "claim_expires_at",
  "created_at", "updated_at", "connector_instance_id", "filter_signature", "checkpoint_schema_version",
  "checkpoint_generation", "last_attempt_at", "computed_delay_ms", "server_minimum_delay_ms", "horizon_at",
  "acquisition_run_id", "skipped_run_id"
)
SELECT rw."id", '00000000-0000-0000-0000-000000000000', rw."id",
  greatest(rw."attempt", 1), greatest(rw."max_attempts", rw."attempt", 1),
  CASE WHEN rw."state" = 'acquired' THEN 'scheduled' ELSE rw."state" END,
  CASE WHEN rw."state" IN ('scheduled','acquired') THEN coalesce(rw."next_attempt_at", rw."updated_at") ELSE NULL END,
  CASE WHEN rw."state" = 'exhausted' THEN rw."reason" ELSE NULL END, NULL, rw."owner_version",
  NULL, NULL, NULL, rw."created_at", rw."updated_at", rw."connector_instance_id",
  left(coalesce(rw."filter_signature", 'filters:{}'), 512), coalesce(rw."checkpoint_schema_version", '1'),
  coalesce(rw."checkpoint_generation", '1'), rw."last_attempt_at", rw."computed_delay_ms",
  rw."server_minimum_delay_ms", rw."horizon_at", NULL, rw."skipped_run_id"
FROM "retry_work" rw
WHERE rw."kind" = 'connector_capture' AND rw."deleted_at" IS NULL AND rw."connector_instance_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "connector_capture_work" cw WHERE cw."id" = rw."id");
--> statement-breakpoint
UPDATE "connector_capture_work" SET
  "last_attempt_at" = coalesce("last_attempt_at", "updated_at"),
  "horizon_at" = coalesce("horizon_at", "updated_at"),
  "status" = CASE WHEN "status" = 'claimed' THEN 'scheduled' ELSE "status" END,
  "acquisition_token" = NULL,
  "claimed_at" = NULL,
  "claim_expires_at" = NULL,
  "acquisition_run_id" = NULL;
--> statement-breakpoint
ALTER TABLE "connector_capture_work" ALTER COLUMN "last_attempt_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "connector_capture_work" ALTER COLUMN "horizon_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "connector_capture_work" ADD CONSTRAINT "chk_connector_capture_work_server_minimum" CHECK ("server_minimum_delay_ms" IS NULL OR "server_minimum_delay_ms" >= 0);
--> statement-breakpoint

-- Action Queue remains a read-time Application projection. Its operational and
-- score sidecars stay intact, gain explicit queue fields, and are re-owned by the
-- canonical Application aggregate below.
ALTER TABLE "application_workflow_states" ADD COLUMN "operational_status" text DEFAULT 'queued' NOT NULL;
--> statement-breakpoint
ALTER TABLE "application_workflow_states" ADD COLUMN "has_applied" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "application_workflow_states" state SET
  "operational_status" = app."status", "has_applied" = app."has_applied"
FROM "applications" app WHERE app."id" = state."application_id";
--> statement-breakpoint

-- Losslessly admit any valid user-created Application written after 0001. These
-- rows have no canonical lineage, so the same explicit manual Job/Opportunity
-- synthesis used by 0001 is repeated rather than quarantining user state.
CREATE FUNCTION cutover_mint_job_uuid(legacy text, created_at text) RETURNS text AS $$
  SELECT lower(substr(ts, 1, 8) || '-' || substr(ts, 9, 4) || '-7' || substr(md5($1), 1, 3)
    || '-8' || substr(md5($1), 4, 3) || '-' || substr(md5($1), 7, 12))
  FROM (SELECT lpad(to_hex((extract(epoch from ($2)::timestamptz) * 1000)::bigint), 12, '0') AS ts) t;
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
INSERT INTO "lifecycle_jobs" ("id", "workspace_id", "facts_revision", "facts_json", "availability_state", "availability_observed_at", "availability_revision", "created_at", "updated_at")
SELECT cutover_mint_job_uuid('cutover:' || app."id", app."created_at"), '00000000-0000-0000-0000-000000000000', 1,
  json_build_object('companyName', coalesce(c."name", 'Unknown'), 'roleTitle', app."role_title", 'sourceName', coalesce(s."name", 'Unknown'), 'roleKind', app."role_kind", 'workMode', app."work_mode", 'location', json_build_object('city', app."city", 'region', app."region", 'country', app."country", 'display', app."location_raw"))::text,
  'unknown', app."created_at", 1, app."created_at", app."updated_at"
FROM "applications" app LEFT JOIN "companies" c ON c."id" = app."company_id" LEFT JOIN "sources" s ON s."id" = app."source_id"
WHERE NOT EXISTS (SELECT 1 FROM "lifecycle_applications" current WHERE current."id" = app."id");
--> statement-breakpoint
INSERT INTO "job_history" ("id", "job_id", "sequence", "kind", "snapshot_json", "audit_json", "created_at")
SELECT 'cutover-job:' || app."id", cutover_mint_job_uuid('cutover:' || app."id", app."created_at"), 1, 'created',
  json_build_object('synthesized', true, 'fromApplication', app."id")::text, '{}', app."created_at"
FROM "applications" app WHERE NOT EXISTS (SELECT 1 FROM "lifecycle_applications" current WHERE current."id" = app."id");
--> statement-breakpoint
INSERT INTO "lifecycle_opportunities" ("id", "workspace_id", "job_id", "revision", "fit", "rank", "cutoff", "disposition", "created_at", "updated_at")
SELECT 'cutover-opp:' || app."id", '00000000-0000-0000-0000-000000000000', cutover_mint_job_uuid('cutover:' || app."id", app."created_at"), 1,
  'unknown', NULL, 'not_evaluated', 'reviewing', app."created_at", app."updated_at"
FROM "applications" app WHERE NOT EXISTS (SELECT 1 FROM "lifecycle_applications" current WHERE current."id" = app."id");
--> statement-breakpoint
INSERT INTO "opportunity_history" ("opportunity_id", "revision", "kind", "snapshot_json", "audit_json", "created_at")
SELECT 'cutover-opp:' || app."id", 1, 'created', json_build_object('synthesized', true)::text, '{}', app."created_at"
FROM "applications" app WHERE NOT EXISTS (SELECT 1 FROM "lifecycle_applications" current WHERE current."id" = app."id");
--> statement-breakpoint
INSERT INTO "lifecycle_applications" ("id", "workspace_id", "opportunity_id", "job_id", "revision", "status", "job_facts_revision", "snapshot_json", "company_name", "source_name", "created_at", "updated_at", "removed_at")
SELECT app."id", '00000000-0000-0000-0000-000000000000', 'cutover-opp:' || app."id",
  cutover_mint_job_uuid('cutover:' || app."id", app."created_at"), 1,
  CASE WHEN app."status" IN ('active','submitted','interviewing','offered','withdrawn','rejected','accepted') THEN app."status" ELSE 'active' END,
  1, json_build_object('job', json_build_object('facts', json_build_object('roleTitle', app."role_title", 'workMode', app."work_mode"), 'factsRevision', 1), 'capturedAt', app."created_at")::text,
  left(coalesce(c."name", 'Unknown'), 500), left(coalesce(s."name", 'Unknown'), 500), app."created_at", app."updated_at", app."deleted_at"
FROM "applications" app LEFT JOIN "companies" c ON c."id" = app."company_id" LEFT JOIN "sources" s ON s."id" = app."source_id"
WHERE NOT EXISTS (SELECT 1 FROM "lifecycle_applications" current WHERE current."id" = app."id");
--> statement-breakpoint
INSERT INTO "application_history" ("application_id", "revision", "kind", "snapshot_json", "audit_json", "created_at")
SELECT app."id", 1, 'created', json_build_object('synthesizedAtCutover', true)::text, '{}', app."created_at"
FROM "applications" app WHERE NOT EXISTS (SELECT 1 FROM "application_history" history WHERE history."application_id" = app."id");
--> statement-breakpoint
INSERT INTO "lifecycle_migration_report" ("id", "category", "source_table", "source_id", "reason", "detail_json", "created_at")
SELECT 'cutover_application:' || app."id", 'synthesized', 'applications', app."id",
  'post-0001 user Application received explicit manual Job and Opportunity lineage',
  json_build_object('jobId', cutover_mint_job_uuid('cutover:' || app."id", app."created_at"), 'opportunityId', 'cutover-opp:' || app."id")::text,
  '2026-07-22T00:00:00.000Z'
FROM "applications" app WHERE app."id" LIKE '%' AND app."id" IN (
  SELECT "application_id" FROM "application_history" WHERE "snapshot_json"::jsonb ? 'synthesizedAtCutover'
)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "pursuit_links" ("id", "application_id", "kind", "label", "url", "is_primary", "created_at")
SELECT link."id", link."application_id", left(coalesce(nullif(link."kind", ''), 'link'), 100),
  left(coalesce(nullif(link."label", ''), 'link'), 200), left(link."url", 4096),
  link."is_primary" AND NOT EXISTS (SELECT 1 FROM "pursuit_links" existing WHERE existing."application_id" = link."application_id" AND existing."is_primary"),
  link."created_at"
FROM "application_links" link
WHERE link."deleted_at" IS NULL AND EXISTS (SELECT 1 FROM "lifecycle_applications" app WHERE app."id" = link."application_id")
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "application_event_records" ("id", "workspace_id", "application_id", "type", "occurred_at", "actor_id", "actor_type", "summary", "created_at")
SELECT event."id", app."workspace_id", event."application_id", left(coalesce(nullif(event."type", ''), 'event'), 100), event."created_at",
  left(coalesce(nullif(event."actor", ''), 'system'), 200), 'system', left(coalesce(nullif(event."message", ''), 'event'), 2000), event."created_at"
FROM "application_events" event JOIN "lifecycle_applications" app ON app."id" = event."application_id"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "application_attempt_records" ("id", "workspace_id", "application_id", "state", "started_at", "completed_at", "summary", "created_at")
SELECT attempt."id", app."workspace_id", attempt."application_id",
  CASE WHEN attempt."status" IN ('pending','running','succeeded','failed') THEN attempt."status" WHEN attempt."status" = 'completed' THEN 'succeeded' ELSE 'pending' END,
  attempt."started_at", attempt."completed_at", CASE WHEN attempt."summary" IS NULL THEN NULL ELSE left(attempt."summary", 2000) END, attempt."created_at"
FROM "application_attempts" attempt JOIN "lifecycle_applications" app ON app."id" = attempt."application_id"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

-- Fail closed if a valid legacy Capture or Job escaped the earlier transform.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "capture_lineages" legacy WHERE NOT EXISTS (SELECT 1 FROM "lifecycle_captures" current WHERE current."id" = legacy."id")) THEN
    RAISE EXCEPTION 'clean lifecycle cutover refused: unmigrated legacy Capture lineage exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "jobs" legacy WHERE NOT EXISTS (
      SELECT 1 FROM "job_history" history
      WHERE history."snapshot_json"::jsonb ->> 'legacyJobId' = legacy."id"
    )
  ) THEN
    RAISE EXCEPTION 'clean lifecycle cutover refused: unmigrated legacy Job exists';
  END IF;
END $$;
--> statement-breakpoint

-- Repoint retained operational/Application sidecars before retiring the old root.
ALTER TABLE "application_scores" DROP CONSTRAINT "application_scores_application_id_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_workflow_states" DROP CONSTRAINT "application_workflow_states_application_id_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_subject_application_id_applications_id_fk";
--> statement-breakpoint

-- Retired derived/raw pipeline leaves first, then their roots. No CASCADE and no
-- IF EXISTS: every dependency is reviewed and partial states fail loudly.
DROP TABLE "application_attempt_steps";
--> statement-breakpoint
DROP TABLE "application_attempts";
--> statement-breakpoint
DROP TABLE "application_events";
--> statement-breakpoint
DROP TABLE "application_links";
--> statement-breakpoint
DROP TABLE "sourcing_projection_outcomes";
--> statement-breakpoint
DROP TABLE "opportunities";
--> statement-breakpoint
DROP TABLE "normalization_field_outcomes";
--> statement-breakpoint
DROP TABLE "normalization_gates";
--> statement-breakpoint
DROP TABLE "normalization_attempts";
--> statement-breakpoint
DROP TABLE "normalization_replay_items";
--> statement-breakpoint
DROP TABLE "normalization_replay_requests";
--> statement-breakpoint
DROP TABLE "job_fact_versions";
--> statement-breakpoint
DROP TABLE "normalization_runs";
--> statement-breakpoint
DROP TABLE "captures";
--> statement-breakpoint
DROP TABLE "retry_work";
--> statement-breakpoint
DROP TABLE "job_identity_conflicts";
--> statement-breakpoint
DROP TABLE "job_identities";
--> statement-breakpoint
DROP TABLE "capture_evidence_versions";
--> statement-breakpoint
DROP TABLE "capture_lineages";
--> statement-breakpoint
DROP TABLE "jobs";
--> statement-breakpoint
DROP TABLE "applications";
--> statement-breakpoint
DROP TABLE "companies";
--> statement-breakpoint

ALTER TABLE "lifecycle_captures" RENAME TO "captures";
--> statement-breakpoint
ALTER TABLE "lifecycle_jobs" RENAME TO "jobs";
--> statement-breakpoint
ALTER TABLE "lifecycle_opportunities" RENAME TO "opportunities";
--> statement-breakpoint
ALTER TABLE "lifecycle_applications" RENAME TO "applications";
--> statement-breakpoint

ALTER TABLE "application_scores" ADD CONSTRAINT "fk_application_scores_application" FOREIGN KEY ("application_id") REFERENCES "applications"("id");
--> statement-breakpoint
ALTER TABLE "application_workflow_states" ADD CONSTRAINT "fk_application_workflow_states_application" FOREIGN KEY ("application_id") REFERENCES "applications"("id");
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_subject_application_id_applications_id_fk" FOREIGN KEY ("subject_application_id") REFERENCES "applications"("id");
--> statement-breakpoint
CREATE INDEX "idx_application_scores_application" ON "application_scores" ("application_id", "created_at");
--> statement-breakpoint

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

DROP FUNCTION cutover_mint_job_uuid(text, text);
--> statement-breakpoint
DROP FUNCTION enforce_job_identity_bound();
--> statement-breakpoint
DROP FUNCTION raise_job_identities_append_only();
--> statement-breakpoint
DROP FUNCTION raise_job_identity_conflicts_append_only();
--> statement-breakpoint
DROP FUNCTION enforce_projection_outcome_pending_insert();
--> statement-breakpoint
DROP FUNCTION enforce_projection_outcome_terminal_transition();
--> statement-breakpoint
DROP FUNCTION enforce_projection_outcome_lineage_immutable();
--> statement-breakpoint
DROP FUNCTION raise_projection_outcomes_append_only();
--> statement-breakpoint
DROP FUNCTION enforce_retry_scope_required();
--> statement-breakpoint
DROP FUNCTION enforce_capture_scope_owner();
--> statement-breakpoint
DROP FUNCTION enforce_retry_work_scope_owner();
--> statement-breakpoint
DROP FUNCTION enforce_normalization_trigger_lineage();
--> statement-breakpoint
DROP FUNCTION enforce_normalization_trigger_capture_immutable();
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM application_scores score LEFT JOIN applications app ON app.id = score.application_id WHERE app.id IS NULL)
    OR EXISTS (SELECT 1 FROM application_workflow_states state LEFT JOIN applications app ON app.id = state.application_id WHERE app.id IS NULL)
    OR EXISTS (SELECT 1 FROM pursuit_links link LEFT JOIN applications app ON app.id = link.application_id WHERE app.id IS NULL)
    OR EXISTS (SELECT 1 FROM applications app LEFT JOIN opportunities opportunity ON opportunity.id = app.opportunity_id WHERE opportunity.id IS NULL)
    OR EXISTS (SELECT 1 FROM opportunities opportunity LEFT JOIN jobs job ON job.id = opportunity.job_id WHERE job.id IS NULL)
    OR EXISTS (SELECT 1 FROM job_capture_evidence_references ref LEFT JOIN captures capture ON capture.id = ref.capture_id LEFT JOIN jobs job ON job.id = ref.job_id WHERE capture.id IS NULL OR job.id IS NULL)
  THEN RAISE EXCEPTION 'clean lifecycle cutover integrity check failed';
  END IF;
END $$;
