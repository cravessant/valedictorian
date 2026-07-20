import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPgliteClient, type PgliteClient } from './pglite'
import { applyBaselineOnly, applyLifecycleMigration, seedLegacyDataset } from '../test/lifecycle-migration-harness'

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

  it('persists the migrated schema and data across an on-disk restart with no unjournaled DDL', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-migration-restart-'))
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))

    const first = await createPgliteClient({ dataDir })
    await applyBaselineOnly(first)
    await seedLegacyDataset(first)
    await applyLifecycleMigration(first)
    const jobsBefore = await count(first, 'lifecycle_jobs')
    const captureItemsBefore = await count(first, 'capture_evidence_items')
    await first.close()

    const reopened = await createPgliteClient({ dataDir })
    cleanups.push(() => reopened.close())
    expect(await count(reopened, 'lifecycle_jobs')).toBe(jobsBefore)
    expect(await count(reopened, 'capture_evidence_items')).toBe(captureItemsBefore)
    // Re-running the migrator on the reopened database performs no unjournaled DDL.
    await applyLifecycleMigration(reopened)
    expect(await count(reopened, 'lifecycle_jobs')).toBe(jobsBefore)
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
      captures: await count(client, 'lifecycle_captures'),
      jobs: await count(client, 'lifecycle_jobs'),
      applications: await count(client, 'lifecycle_applications'),
      report: await count(client, 'lifecycle_migration_report'),
    }
    await applyLifecycleMigration(client)
    const after = {
      workspaces: await count(client, 'workspaces'),
      captures: await count(client, 'lifecycle_captures'),
      jobs: await count(client, 'lifecycle_jobs'),
      applications: await count(client, 'lifecycle_applications'),
      report: await count(client, 'lifecycle_migration_report'),
    }
    expect(after).toEqual(before)
    expect(after.workspaces).toBe(1)
  })
})
