import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPgliteClient, type PgliteClient } from './pglite'
import {
  applyBaselineOnly,
  applyLifecycleMigration,
  applyMigrationsBeforeCleanCutover,
  seedIndependentClaimedConnectorCaptureWork,
  seedLegacyDataset,
} from '../test/lifecycle-migration-harness'

/**
 * #298 Round E journal/PGlite-seam proofs for the lifecycle migration: atomic
 * rollback, on-disk restart with no unjournaled DDL, and repeated-migration
 * idempotency. The representative-data integrity proof is a sibling suite.
 */
async function count(client: PgliteClient, table: string) {
  const r = await client.query<{ n: number }>(`select count(*)::int as n from ${table}`)
  return r.rows[0]!.n
}

describe.sequential('lifecycle migration journal seam', () => {
  const cleanups: Array<() => void | Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
  })

  it('rolls the migration back atomically when a statement fails, leaving the baseline intact', async () => {
    const client = await createPgliteClient()
    cleanups.push(() => client.close())
    await applyBaselineOnly(client)
    await client.query(`insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at) values ('job-x','provider_job','ns','v','2026-07-19T00:00:00.000Z')`)
    // Inject a failure: pre-create a table 0001 creates late, so its CREATE TABLE aborts.
    await client.query(`CREATE TABLE "workspaces" ("id" text primary key)`)

    await expect(applyLifecycleMigration(client)).rejects.toThrow()

    // The whole 0001 transaction rolled back: no lifecycle tables, legacy data intact.
    const captures = await client.query<{ t: string | null }>(`select to_regclass('public.lifecycle_captures') as t`)
    expect(captures.rows[0]!.t).toBeNull()
    expect(await count(client, 'jobs')).toBe(1)
    const applied = await client.query<{ n: number }>(`select count(*)::int as n from drizzle.__drizzle_migrations`)
    expect(applied.rows[0]!.n).toBe(1) // only 0000 recorded; 0001 not applied

    // Drop the conflicting table so nothing leaks to later work.
    await client.query(`DROP TABLE "workspaces"`)
  })

  it('rolls all of 0005 back when the final integrity guard fails after destructive cutover', async () => {
    const client = await createPgliteClient()
    cleanups.push(() => client.close())
    await applyBaselineOnly(client)
    await seedLegacyDataset(client)
    await applyMigrationsBeforeCleanCutover(client)
    await seedIndependentClaimedConnectorCaptureWork(client)
    await client.query(`set session_replication_role = replica`)
    await client.query(`insert into pursuit_links (id, application_id, kind, label, url, is_primary, created_at)
      values ('orphan-final-integrity', 'missing-application', 'posting', 'Orphan',
        'https://example.invalid/orphan', false, '2026-07-19T00:00:00.000Z')`)
    await client.query(`set session_replication_role = origin`)
    const reportsBefore = await count(client, 'lifecycle_migration_report')

    let failure: unknown
    try {
      await applyLifecycleMigration(client)
    } catch (error) {
      failure = error
    }
    const failureMessages: string[] = []
    for (let current = failure; current instanceof Error; current = current.cause) {
      failureMessages.push(current.message)
    }
    expect(failureMessages.join('\n')).toContain('clean lifecycle cutover integrity check failed')

    const addedColumn = await client.query<{ n: number }>(`
      select count(*)::int as n from information_schema.columns
      where table_name = 'connector_capture_work' and column_name = 'last_attempt_at'`)
    expect(addedColumn.rows[0]!.n).toBe(0)
    expect(await count(client, 'lifecycle_migration_report')).toBe(reportsBefore)
    const independent = await client.query<{ status: string; acquisition_token: string | null }>(
      `select status, acquisition_token from connector_capture_work where id = 'cw-independent'`,
    )
    expect(independent.rows).toEqual([{ status: 'claimed', acquisition_token: 'independent-token' }])
    const schema = await client.query<{
      retry: string | null
      legacyJobs: string | null
      legacyOpportunities: string | null
      legacyApplications: string | null
      legacyCaptures: string | null
      canonicalCaptures: string | null
      canonicalJobs: string | null
      canonicalOpportunities: string | null
      canonicalApplications: string | null
    }>(`select to_regclass('public.retry_work') as retry,
        to_regclass('public.captures') as "legacyCaptures",
        to_regclass('public.jobs') as "legacyJobs",
        to_regclass('public.opportunities') as "legacyOpportunities",
        to_regclass('public.applications') as "legacyApplications",
        to_regclass('public.lifecycle_captures') as "canonicalCaptures",
        to_regclass('public.lifecycle_jobs') as "canonicalJobs",
        to_regclass('public.lifecycle_opportunities') as "canonicalOpportunities",
        to_regclass('public.lifecycle_applications') as "canonicalApplications"`)
    expect(schema.rows[0]).toEqual({
      retry: 'retry_work',
      legacyCaptures: 'captures', legacyJobs: 'jobs', legacyOpportunities: 'opportunities',
      legacyApplications: 'applications',
      canonicalCaptures: 'lifecycle_captures', canonicalJobs: 'lifecycle_jobs',
      canonicalOpportunities: 'lifecycle_opportunities', canonicalApplications: 'lifecycle_applications',
    })
    expect(await count(client, 'capture_evidence_versions')).toBeGreaterThan(0)
    expect(await count(client, 'pursuit_links')).toBeGreaterThan(0)
    const applied = await client.query<{ n: number }>(
      `select count(*)::int as n from drizzle.__drizzle_migrations`,
    )
    expect(applied.rows[0]!.n).toBe(5)
  })

  it('persists the migrated schema and data across an on-disk restart with no unjournaled DDL', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-migration-restart-'))
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))

    const first = await createPgliteClient({ dataDir })
    await applyBaselineOnly(first)
    await seedLegacyDataset(first)
    await applyLifecycleMigration(first)
    const jobsBefore = await count(first, 'jobs')
    const captureItemsBefore = await count(first, 'capture_evidence_items')
    await first.close()

    const reopened = await createPgliteClient({ dataDir })
    cleanups.push(() => reopened.close())
    expect(await count(reopened, 'jobs')).toBe(jobsBefore)
    expect(await count(reopened, 'capture_evidence_items')).toBe(captureItemsBefore)
    // Re-running the migrator on the reopened database performs no unjournaled DDL.
    await applyLifecycleMigration(reopened)
    expect(await count(reopened, 'jobs')).toBe(jobsBefore)
    expect(await count(reopened, 'workspaces')).toBe(1)
  })

  it('is idempotent when the migration is applied again', async () => {
    const client = await createPgliteClient()
    cleanups.push(() => client.close())
    await applyBaselineOnly(client)
    await seedLegacyDataset(client)
    await applyLifecycleMigration(client)

    const before = {
      workspaces: await count(client, 'workspaces'),
      captures: await count(client, 'captures'),
      jobs: await count(client, 'jobs'),
      applications: await count(client, 'applications'),
      report: await count(client, 'lifecycle_migration_report'),
    }
    await applyLifecycleMigration(client)
    const after = {
      workspaces: await count(client, 'workspaces'),
      captures: await count(client, 'captures'),
      jobs: await count(client, 'jobs'),
      applications: await count(client, 'applications'),
      report: await count(client, 'lifecycle_migration_report'),
    }
    expect(after).toEqual(before)
    expect(after.workspaces).toBe(1)
  })
})
