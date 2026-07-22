import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migratePgliteDatabase, resolvePgliteMigrationsFolder, type PgliteClient } from '../db/pglite'

/**
 * #298 Round E migration test harness.
 *
 * The drizzle migrator applies every pending migration in one transaction, so it
 * cannot natively apply 0000, seed legacy data, then apply 0001. These helpers
 * reproduce the real upgrade path (an existing 0000 database gaining 0001):
 * `applyBaselineOnly` records 0000 via a temp folder holding only that entry, then
 * `applyLifecycleMigration` runs the full folder — the migrator skips 0000 (already
 * recorded by folder time) and applies only 0001's DDL + transform.
 */
export async function applyBaselineOnly(client: PgliteClient) {
  const fullFolder = resolvePgliteMigrationsFolder()
  const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-baseline-'))
  fs.mkdirSync(path.join(tempFolder, 'meta'), { recursive: true })
  fs.copyFileSync(
    path.join(fullFolder, '0000_pglite_operational_baseline.sql'),
    path.join(tempFolder, '0000_pglite_operational_baseline.sql'),
  )
  fs.copyFileSync(
    path.join(fullFolder, 'meta', '0000_snapshot.json'),
    path.join(tempFolder, 'meta', '0000_snapshot.json'),
  )
  const journal = JSON.parse(fs.readFileSync(path.join(fullFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number }>
  }
  journal.entries = journal.entries.filter((entry) => entry.idx === 0)
  fs.writeFileSync(path.join(tempFolder, 'meta', '_journal.json'), JSON.stringify(journal))
  await migratePgliteDatabase(client, { migrationsFolder: tempFolder })
  fs.rmSync(tempFolder, { recursive: true, force: true })
}

export async function applyLifecycleMigration(client: PgliteClient) {
  await migratePgliteDatabase(client, { migrationsFolder: resolvePgliteMigrationsFolder() })
}

const T = '2026-07-19T00:00:00.000Z'

/**
 * Seeds a realistic legacy dataset covering every transform branch: both identity
 * tuple kinds, the four alias kinds, a reverse application link, a policy-derived
 * and a user-authored opportunity, an orphan application, divergent lineage, both
 * retry_work kinds plus the provider marker and the cancelled/terminal split, and a
 * capture whose evidence array exercises the >50, malformed, and forbidden-key drops.
 */
export async function seedLegacyDataset(client: PgliteClient) {
  const q = (sql: string) => client.query(sql)
  // Companies / sources for application display facts.
  await q(`insert into companies (id, name, normalized_name, created_at, updated_at) values ('co-1','Acme','acme','${T}','${T}')`)
  await q(`insert into sources (id, name, created_at, updated_at) values ('src-1','Jobright','${T}','${T}')`)
  // Execution scope + connector instance for connector_capture retry work.
  await q(`insert into source_execution_scopes (id, status, backoff_attempt, auth_generation, created_at, updated_at) values ('scope-xxxxxxxx','available',0,0,'${T}','${T}')`)
  await q(`insert into connector_instances (id, execution_scope_id, connector_id, connector_version, display_name, enabled, config_json, auth_json, filters_json, created_at, updated_at)
    values ('ci-1','scope-xxxxxxxx','jobright','1','Jobright',true,'{}','[]','{}','${T}','${T}')`)
  await q(`insert into connector_runs (id, execution_scope_id, connector_instance_id, mode, status, started_at, completed_at, config_json, filters_json, filter_signature, observation_count, warning_count, stats_json, warnings_json, retry_hints_json, created_at, updated_at)
    values ('run-legacy','scope-xxxxxxxx','ci-1','manual','completed','${T}','${T}','{}','{}','filters:{}',1,0,'{}','[]','null','${T}','${T}')`)

  // Jobs first (capture_lineages.job_id FKs to jobs).
  await q(`insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at) values ('job-A','provider_job','adapter:8:jobright','pr-1','${T}')`)
  await q(`insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at) values ('job-B','destination_url','deterministic-destination/v1','https://acme.com/job/1','${T}')`)

  // Capture lineage A: normal, with two evidence revisions; owns job-A.
  await q(`insert into capture_lineages (id, job_id, created_at) values ('lin-A','job-A','${T}')`)
  await q(`insert into capture_evidence_versions (id, capture_lineage_id, revision, content_hash, adapter_id, adapter_kind, adapter_version, observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at)
    values ('cev-A1','lin-A',1,'sha256:3c9439421e82995a55064b78eeb7fee2e189d8482d3185b2edd1ff0e8b0ea894','jobright','connector','1','${T}','pr-1','schema-1','{"role":"eng"}','[{"kind":"title","label":"Title","value":"Engineer"}]','${T}')`)
  await q(`insert into capture_evidence_versions (id, capture_lineage_id, revision, content_hash, adapter_id, adapter_kind, adapter_version, observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at)
    values ('cev-A2','lin-A',2,'h2','jobright','connector','1','${T}','pr-1','schema-1','{"role":"eng2"}','[{"kind":"title","label":"Title","value":"Engineer II"}]','${T}')`)
  await q(`update capture_evidence_versions set reported_origin_kind = 'job_board', reported_origin_name = 'Jobright' where id = 'cev-A1'`)
  await q(`insert into captures (id, capture_lineage_id, capture_evidence_version_id, connector_instance_id, connector_run_id, execution_scope_id, observed_at, received_at)
    values ('capture-legacy','lin-A','cev-A1','ci-1','run-legacy','scope-xxxxxxxx','${T}','${T}')`)

  // Capture lineage B: divergent lineage (lineage says job-B, facts say job-A).
  await q(`insert into capture_lineages (id, job_id, created_at) values ('lin-B','job-B','${T}')`)
  await q(`insert into capture_evidence_versions (id, capture_lineage_id, revision, content_hash, adapter_id, adapter_kind, adapter_version, observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at)
    values ('cev-B1','lin-B',1,'h3','jobright','connector','1','${T}',null,null,null,'[]','${T}')`)

  // Capture lineage C: evidence degradation paths (>50 items, malformed element, forbidden-key element).
  // Forbidden-key and malformed elements are placed within the first 50 so each
  // degradation path is reported distinctly; 51 valid items follow to trigger the >50 cap.
  // access_token is an OAuth-style key the OLD exact-match denylist would have MISSED.
  const items = ['{"access_token":"leak"}', '"a-bare-string-element"']
  for (let i = 0; i < 51; i += 1) items.push(`{"kind":"k${i}","label":"L${i}","value":${i}}`)
  await q(`insert into capture_lineages (id, job_id, created_at) values ('lin-C',null,'${T}')`)
  await q(`insert into capture_evidence_versions (id, capture_lineage_id, revision, content_hash, adapter_id, adapter_kind, adapter_version, observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at)
    values ('cev-C1','lin-C',1,'h4','jobright','connector','1','${T}',null,null,'{"api_key":"x"}','[${items.join(',')}]','${T}')`)

  // Capture lineage D: malformed (non-JSON) evidence_json — must quarantine+report, not abort.
  await q(`insert into capture_lineages (id, job_id, created_at) values ('lin-D',null,'${T}')`)
  await q(`insert into capture_evidence_versions (id, capture_lineage_id, revision, content_hash, adapter_id, adapter_kind, adapter_version, observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at)
    values ('cev-D1','lin-D',1,'h5','jobright','connector','1','${T}',null,null,null,'this is not json','${T}')`)

  // Identities (primary tuple + the four alias kinds) + fact versions.
  await q(`insert into job_identities (id, job_id, identity_kind, identity_namespace, identity_value, provenance_kind, provenance_version, evidence_json, created_at)
    values ('ji-1','job-A','canonical_destination','deterministic-destination/v1','https://acme.com/job/1','normalization','1','{}','${T}')`)
  await q(`insert into job_identities (id, job_id, identity_kind, identity_namespace, identity_value, provenance_kind, provenance_version, evidence_json, created_at)
    values ('ji-2','job-A','destination_alias','dest-alias/v1','https://acme.com/job/1?utm=x','capture','1','{}','${T}')`)
  await q(`insert into job_identities (id, job_id, identity_kind, identity_namespace, identity_value, provenance_kind, provenance_version, evidence_json, created_at)
    values ('ji-3','job-A','intermediary_alias','inter-alias/v1','https://jobright.ai/jobs/info/abc','capture','1','{}','${T}')`)
  // Fact version for lin-B claims job-A (divergence winner is job-A).
  await q(`insert into normalization_runs (id, capture_lineage_id, capture_evidence_version_id, input_hash, resolver_set_hash, canonical_schema_version, gate_policy_version, status, created_at, updated_at)
    values ('nr-1','lin-A','cev-A2','ih','rsh','csv','gpv','completed','${T}','${T}')`)
  await q(`insert into job_fact_versions (id, run_id, job_id, capture_lineage_id, capture_evidence_version_id, schema_version, job_fact_version_json, created_at)
    values ('jfv-1','nr-1','job-A','lin-A','cev-A2','v1','{"companyName":"Acme","roleTitle":"Engineer"}','${T}')`)
  await q(`insert into normalization_runs (id, capture_lineage_id, capture_evidence_version_id, input_hash, resolver_set_hash, canonical_schema_version, gate_policy_version, status, created_at, updated_at)
    values ('nr-2','lin-B','cev-B1','ih2','rsh','csv','gpv','completed','${T}','${T}')`)
  await q(`insert into job_fact_versions (id, run_id, job_id, capture_lineage_id, capture_evidence_version_id, schema_version, job_fact_version_json, created_at)
    values ('jfv-2','nr-2','job-A','lin-B','cev-B1','v1','{"companyName":"Acme"}','${T}')`)

  // Workflow run + opportunities: policy-derived (below_cutoff), user-authored (not_pursued), quarantined (duplicate).
  await q(`insert into workflow_runs (id, run_type, status, actor_type, started_at, input_json, metadata_json, created_at, updated_at) values ('wr-1','sourcing','completed','system','${T}','{}','{}','${T}','${T}')`)
  await q(oppInsert('opp-policy', 'job-A', 'below_cutoff'))
  await q(oppInsert('opp-user', 'job-B', 'not_pursued'))
  await q(oppInsert('opp-dupe', 'job-A', 'duplicate'))

  // Applications: one linked (via opp-user), one orphan (no linking opportunity).
  await q(appInsert('app-linked'))
  await q(appInsert('app-orphan'))
  // Link opp-user to the linked application (reverse-only legacy linkage).
  await q(`update opportunities set application_id = 'app-linked' where id = 'opp-user'`)
  await q(`insert into application_links (id, application_id, kind, label, url, is_primary, discovered_at, created_at, updated_at) values ('al-1','app-linked','posting','Apply','https://acme.com/apply',true,'${T}','${T}','${T}')`)
  await q(`insert into application_events (id, application_id, type, message, payload_json, actor, created_at) values ('ae-1','app-linked','note','moved forward','{}','user','${T}')`)

  // retry_work: connector_capture, normalization, provider marker, cancelled+evidence (terminal), cancelled without (cancelled), tombstoned.
  await q(retryInsert({ id: 'rw-cap', kind: 'connector_capture', state: 'scheduled' }))
  await q(retryInsert({ id: 'rw-norm', kind: 'normalization', cev: 'cev-A1', state: 'exhausted', reason: 'server_failure' }))
  await q(retryInsert({ id: 'rw-prov', kind: 'normalization', cev: 'cev-A2', state: 'scheduled', workKind: 'provider_url_resolution' }))
  await q(retryInsert({ id: 'rw-term', kind: 'normalization', cev: 'cev-B1', state: 'cancelled', workKind: 'provider_url_resolution', failureEvidence: true }))
  await q(retryInsert({ id: 'rw-cancel', kind: 'connector_capture', state: 'cancelled' }))
  await q(retryInsert({ id: 'rw-dead', kind: 'connector_capture', state: 'scheduled', deleted: true }))
  // NB: retry_work.lineage_json cannot be seeded malformed — the baseline
  // enforce_retry_work_scope_owner trigger casts it to jsonb on every insert, so
  // legacy lineage_json is always valid JSON. The transform's lineage_json guard is
  // therefore defense-in-depth; the reachable malformed-JSON class (capture
  // evidence_json, which has no validating trigger) is exercised by lin-D above.
}

function oppInsert(id: string, jobId: string, mergeStatus: string) {
  return `insert into opportunities (id, job_id, workflow_run_id, source_id, company_name, role_title, role_kind, timing_mode, terms_json, work_mode, merge_status, discovered_at, created_at, updated_at)
    values ('${id}','${jobId}','wr-1','src-1','Acme','Engineer','full_time','unknown','[]','remote','${mergeStatus}','${T}','${T}','${T}')`
}

function appInsert(id: string) {
  return `insert into applications (id, company_id, source_id, role_title, role_kind, timing_mode, terms_json, country, work_mode, status, has_applied, created_at, updated_at)
    values ('${id}','co-1','src-1','Engineer','full_time','unknown','[]','US','remote','active',false,'${T}','${T}')`
}

function retryInsert(o: { id: string; kind: string; state: string; cev?: string; reason?: string; workKind?: string; failureEvidence?: boolean; deleted?: boolean }) {
  const lineage = JSON.stringify({
    ...(o.workKind ? { workKind: o.workKind, connectorInstanceId: 'ci-1', intermediaryUrl: 'https://jobright.ai/x', providerRecordId: 'pr-1' } : {}),
    ...(o.failureEvidence ? { failureEvidence: { type: 'invalid' } } : {}),
  }).replace(/'/g, "''")
  const isCapture = o.kind === 'connector_capture'
  return `insert into retry_work (id, execution_scope_id, kind, connector_instance_id, filter_signature, checkpoint_schema_version, checkpoint_generation, capture_evidence_version_id, resolver_id, resolver_version, input_hash, reason, attempt, max_attempts, last_attempt_at, computed_delay_ms, next_attempt_at, horizon_at, state, owner_version, lineage_json, created_at, updated_at, deleted_at)
    values ('${o.id}','scope-xxxxxxxx','${o.kind}',
      ${isCapture ? `'ci-1'` : 'null'}, ${isCapture ? `'filters:{}'` : 'null'}, ${isCapture ? `'v1'` : 'null'}, ${isCapture ? `'${o.id}'` : 'null'},
      ${o.cev ? `'${o.cev}'` : 'null'}, ${isCapture ? 'null' : `'r'`}, ${isCapture ? 'null' : `'1'`}, ${isCapture ? 'null' : `'ih'`},
      '${o.reason ?? 'network_interruption'}', 1, 3, '${T}',
      ${o.state === 'scheduled' || o.state === 'acquired' ? 0 : 'null'},
      ${o.state === 'scheduled' || o.state === 'acquired' ? `'${T}'` : 'null'},
      '${T}', '${o.state}', '1', '${lineage}', '${T}', '${T}', ${o.deleted ? `'${T}'` : 'null'})`
}
