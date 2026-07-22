import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPgliteClient, migratePgliteDatabase, type PgliteClient } from './pglite'

/**
 * #298 red-first schema proof for the durable scheduled-work identities at the
 * PGlite public seam. Replaces the legacy retry_work collapse with one identity
 * per operation kind. Uses one migrated in-memory database and raw SQL.
 *
 * Schema-only: no scheduler/claiming behavior (that is covered at the repository
 * seam). Because at most one ACTIVE row per subject is allowed, coexisting
 * active rows in these tests use distinct capture subjects.
 */
const T = '2026-07-19T00:00:00.000Z'
const CAPTURE_IDS = Array.from({ length: 8 }, (_, i) => `cap-${i + 1}`)

async function setupSubjects(client: PgliteClient) {
  await client.query(`insert into workspaces (id, name, created_at, updated_at) values ('ws-1', 'ws-1', '${T}', '${T}')`)
  for (const captureId of CAPTURE_IDS) {
    await client.query(
      `insert into captures (id, workspace_id, evidence_mode, adapter_id, adapter_kind, adapter_version, observed_at, received_at, provider_record_id, provider_schema, payload_json, revision, created_at, updated_at)
       values ('${captureId}', 'ws-1', 'reported', 'a', 'connector', '1', '${T}', '${T}', null, null, null, 1, '${T}', '${T}')`,
    )
    await client.query(
      `insert into capture_revisions (capture_id, revision, kind, snapshot_json, audit_json, created_at) values ('${captureId}', 1, 'created', '{}', '{}', '${T}')`,
    )
  }
  await client.query(
    `insert into source_execution_scopes (id, status, backoff_attempt, auth_generation, created_at, updated_at) values ('scope-aaaaaaaa', 'available', 0, 0, '${T}', '${T}')`,
  )
  await client.query(
    `insert into connector_instances (id, execution_scope_id, connector_id, connector_version, display_name, enabled, config_json, auth_json, filters_json, created_at, updated_at)
     values ('instance-1', 'scope-aaaaaaaa', 'fixture', '1', 'One', true, '{}', '[]', '{}', '${T}', '${T}')`,
  )
}

/** Insert a scheduled provider-URL-resolution row with overridable common fields. */
async function insertProviderResolution(
  client: PgliteClient,
  o: { id: string; captureId: string; idempotencyKey?: string; attempt?: number; maxAttempts?: number; status?: string; nextEligibleAt?: string | null; acquisitionToken?: string | null; claimedAt?: string | null; failureReason?: string | null; failureDetail?: string | null },
) {
  const nextEligible = o.nextEligibleAt === undefined ? `'${T}'` : o.nextEligibleAt === null ? 'null' : `'${o.nextEligibleAt}'`
  const token = o.acquisitionToken === undefined || o.acquisitionToken === null ? 'null' : `'${o.acquisitionToken}'`
  const claimed = o.claimedAt === undefined || o.claimedAt === null ? 'null' : `'${o.claimedAt}'`
  const reason = o.failureReason === undefined || o.failureReason === null ? 'null' : `'${o.failureReason}'`
  const detail = o.failureDetail === undefined || o.failureDetail === null ? 'null' : `'${o.failureDetail}'`
  await client.query(
    `insert into provider_url_resolution_work (
       id, workspace_id, idempotency_key, attempt, max_attempts, status, next_eligible_at,
       failure_reason, failure_detail, owner_version, acquisition_token, claimed_at, claim_expires_at,
       created_at, updated_at, capture_id, resolver_id, resolver_version, intermediary_url_hash
     ) values (
       '${o.id}', 'ws-1', '${o.idempotencyKey ?? o.id}', ${o.attempt ?? 1}, ${o.maxAttempts ?? 5}, '${o.status ?? 'scheduled'}', ${nextEligible},
       ${reason}, ${detail}, 'v1', ${token}, ${claimed}, null,
       '${T}', '${T}', '${o.captureId}', 'jobright', '1', 'urlhash-1'
     )`,
  )
}

describe.sequential('PGlite scheduled-work identities', () => {
  let client: PgliteClient

  beforeAll(async () => {
    client = await createPgliteClient()
    await migratePgliteDatabase(client)
    await setupSubjects(client)
  })

  afterAll(async () => {
    await client.close()
  })

  it('creates one durable identity table per operation kind', async () => {
    const result = await client.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`)
    const names = result.rows.map((row) => row.tablename)
    for (const table of [
      'connector_capture_work', 'normalization_work', 'provider_url_resolution_work',
      'hosted_submission_work', 'hosted_result_polling_work',
    ]) {
      expect(names).toContain(table)
    }
    expect(names).not.toContain('retry_work')
  })

  it('keeps distinct operation kinds for one subject as independent rows with independent budgets', async () => {
    await insertProviderResolution(client, { id: 'pur-1', captureId: 'cap-1', attempt: 2, maxAttempts: 5 })
    await client.query(
      `insert into hosted_submission_work (id, workspace_id, idempotency_key, attempt, max_attempts, status, next_eligible_at, owner_version, created_at, updated_at, capture_id, canonical_url_hash)
       values ('hsw-1', 'ws-1', 'hsw-1', 1, 3, 'scheduled', '${T}', 'v1', '${T}', '${T}', 'cap-1', 'canon-1')`,
    )
    // Exhausting the hosted submission budget does not touch the provider-resolution row for the same capture.
    await client.query(`update hosted_submission_work set status = 'exhausted', next_eligible_at = null, attempt = 3 where id = 'hsw-1'`)
    const provider = await client.query<{ status: string; attempt: number; max_attempts: number }>(
      `select status, attempt, max_attempts from provider_url_resolution_work where id = 'pur-1'`,
    )
    expect(provider.rows[0]).toEqual({ status: 'scheduled', attempt: 2, max_attempts: 5 })
  })

  it('uniques the idempotency key within each identity table', async () => {
    await insertProviderResolution(client, { id: 'pur-idem', captureId: 'cap-2', idempotencyKey: 'shared-idem' })
    // Distinct capture so the failure is the idempotency key, not the active-subject rule.
    await expect(
      insertProviderResolution(client, { id: 'pur-idem-2', captureId: 'cap-3', idempotencyKey: 'shared-idem' }),
    ).rejects.toThrow(/unique|duplicate/i)
  })

  it('serializes active work per subject and allows a fresh active row after a terminal one', async () => {
    await insertProviderResolution(client, { id: 'pur-active-1', captureId: 'cap-4', status: 'scheduled' })
    // A second ACTIVE row for the same capture subject is rejected.
    await expect(
      insertProviderResolution(client, { id: 'pur-active-2', captureId: 'cap-4', status: 'scheduled' }),
    ).rejects.toThrow(/unique|duplicate/i)
    // Once the first is terminal, a fresh active row for the same subject is allowed.
    await client.query(`update provider_url_resolution_work set status = 'terminal', next_eligible_at = null, failure_reason = 'unresolvable' where id = 'pur-active-1'`)
    await insertProviderResolution(client, { id: 'pur-active-3', captureId: 'cap-4', status: 'scheduled' })
  })

  it('represents typed terminal deterministic failure distinctly from exhaustion and cancellation', async () => {
    // A terminal row carries a deterministic reason and no next-eligible time.
    await insertProviderResolution(client, { id: 'pur-terminal', captureId: 'cap-5', status: 'terminal', nextEligibleAt: null, failureReason: 'unresolvable' })
    // Terminal with a retryable reason is rejected.
    await expect(
      insertProviderResolution(client, { id: 'pur-terminal-bad', captureId: 'cap-6', status: 'terminal', nextEligibleAt: null, failureReason: 'server_failure' }),
    ).rejects.toThrow(/chk_provider_url_resolution_work_reason|check/i)
    // A deterministic reason on a non-terminal (exhausted) row is rejected.
    await expect(
      insertProviderResolution(client, { id: 'pur-exhausted-det', captureId: 'cap-6', status: 'exhausted', nextEligibleAt: null, failureReason: 'unresolvable' }),
    ).rejects.toThrow(/chk_provider_url_resolution_work_reason|check/i)
  })

  it('enforces attempt-budget, status, and next-eligible timing constraints', async () => {
    await expect(insertProviderResolution(client, { id: 'pur-budget', captureId: 'cap-7', attempt: 6, maxAttempts: 5 })).rejects.toThrow(/chk_provider_url_resolution_work_budget|check/i)
    await expect(insertProviderResolution(client, { id: 'pur-status', captureId: 'cap-7', status: 'invented' })).rejects.toThrow(/chk_provider_url_resolution_work_status|check/i)
    await expect(insertProviderResolution(client, { id: 'pur-notiming', captureId: 'cap-7', status: 'scheduled', nextEligibleAt: null })).rejects.toThrow(/chk_provider_url_resolution_work_timing|check/i)
    await expect(insertProviderResolution(client, { id: 'pur-terminaltiming', captureId: 'cap-7', status: 'completed', nextEligibleAt: T })).rejects.toThrow(/chk_provider_url_resolution_work_timing|check/i)
  })

  it('enforces concurrency claim-column constraints', async () => {
    await expect(
      insertProviderResolution(client, { id: 'pur-claimscheduled', captureId: 'cap-7', status: 'scheduled', acquisitionToken: 'tok', claimedAt: T }),
    ).rejects.toThrow(/chk_provider_url_resolution_work_scheduled_unclaimed|check/i)
    await expect(
      insertProviderResolution(client, { id: 'pur-claimhalf', captureId: 'cap-7', status: 'claimed', acquisitionToken: 'tok', claimedAt: null }),
    ).rejects.toThrow(/chk_provider_url_resolution_work_claim_pair|check/i)
    await insertProviderResolution(client, { id: 'pur-claimed', captureId: 'cap-8', status: 'claimed', acquisitionToken: 'tok', claimedAt: T })
  })

  it('bounds and sanitizes failure evidence', async () => {
    await expect(
      insertProviderResolution(client, { id: 'pur-badreason', captureId: 'cap-7', status: 'exhausted', nextEligibleAt: null, failureReason: 'invented' }),
    ).rejects.toThrow(/chk_provider_url_resolution_work_reason|check/i)
    await expect(
      insertProviderResolution(client, { id: 'pur-secretdetail', captureId: 'cap-7', status: 'exhausted', nextEligibleAt: null, failureReason: 'server_failure', failureDetail: '{"password":"x"}' }),
    ).rejects.toThrow(/chk_provider_url_resolution_work_detail|check/i)
    await expect(
      insertProviderResolution(client, { id: 'pur-hugedetail', captureId: 'cap-7', status: 'exhausted', nextEligibleAt: null, failureReason: 'server_failure', failureDetail: 'x'.repeat(2001) }),
    ).rejects.toThrow(/chk_provider_url_resolution_work_detail|check/i)
  })

  it('binds each identity to its typed subject foreign key', async () => {
    await expect(
      client.query(
        `insert into normalization_work (id, workspace_id, idempotency_key, attempt, max_attempts, status, next_eligible_at, owner_version, created_at, updated_at, capture_id, capture_revision, resolver_id, resolver_version, input_hash)
         values ('nw-badrev', 'ws-1', 'nw-badrev', 1, 5, 'scheduled', '${T}', 'v1', '${T}', '${T}', 'cap-1', 99, 'r', '1', 'h')`,
      ),
    ).rejects.toThrow(/foreign key/i)
    await expect(
      client.query(
        `insert into connector_capture_work (id, workspace_id, idempotency_key, attempt, max_attempts, status, next_eligible_at, owner_version, created_at, updated_at, connector_instance_id, filter_signature, checkpoint_schema_version, checkpoint_generation, last_attempt_at, horizon_at)
         values ('ccw-badinst', 'ws-1', 'ccw-badinst', 1, 5, 'scheduled', '${T}', 'v1', '${T}', '${T}', 'missing-instance', 'filters:{}', 'v1', 'g1', '${T}', '${T}')`,
      ),
    ).rejects.toThrow(/foreign key/i)
    await client.query(
      `insert into normalization_work (id, workspace_id, idempotency_key, attempt, max_attempts, status, next_eligible_at, owner_version, created_at, updated_at, capture_id, capture_revision, resolver_id, resolver_version, input_hash)
       values ('nw-ok', 'ws-1', 'nw-ok', 1, 5, 'scheduled', '${T}', 'v1', '${T}', '${T}', 'cap-1', 1, 'r', '1', 'h')`,
    )
    await client.query(
      `insert into connector_capture_work (id, workspace_id, idempotency_key, attempt, max_attempts, status, next_eligible_at, owner_version, created_at, updated_at, connector_instance_id, filter_signature, checkpoint_schema_version, checkpoint_generation, last_attempt_at, horizon_at)
       values ('ccw-ok', 'ws-1', 'ccw-ok', 1, 5, 'scheduled', '${T}', 'v1', '${T}', '${T}', 'instance-1', 'filters:{}', 'v1', 'g1', '${T}', '${T}')`,
    )
  })
})
