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
