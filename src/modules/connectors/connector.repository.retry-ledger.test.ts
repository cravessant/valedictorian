import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { connectorCaptureWork } from '../scheduling/scheduling.schema'
import { createPgliteClient, createPgliteDatabase, type PgliteClient } from '../../db/pglite'
import { DEFAULT_WORKSPACE_ID } from '../../db/workspaces.schema'
import { prepareConfiguredPgliteDataPath } from '../../test/pglite-template'
import { createPgliteConnectorRepository } from './connector.repository'
import { useResettablePgliteTestConnectorRepositoryContext } from './connector.repository.pglite-test-helpers'
import { completedConnectorRefreshContract } from './connector-refresh-result.test-helpers'

const BASE = '2026-07-11T12:00:00.000Z'
const DUE = '2026-07-11T12:01:00.000Z'

describe.sequential('PGlite connector capture work ledger', () => {
  const createContext = useResettablePgliteTestConnectorRepositoryContext()

  it('returns one persisted not-due run for repeated triggers in the same window', async () => {
    const { database, repository } = await createContext()
    await seedScheduledWork(repository, 'not-due')

    const first = await repository.recordRunRequest({
      connectorInstanceId: 'not-due', mode: 'manual', startedAt: '2026-07-11T12:00:30.000Z',
    })
    const second = await repository.recordRunRequest({
      connectorInstanceId: 'not-due', mode: 'manual', startedAt: '2026-07-11T12:00:45.000Z',
    })

    expect(first.acquired).toBe(false)
    expect(second.acquired).toBe(false)
    expect(second.run.id).toBe(first.run.id)
    expect(first.run).toMatchObject({
      status: 'skipped',
      retryHints: { state: 'not_due', nextAttemptAt: DUE },
    })
    const [work] = await database.select().from(connectorCaptureWork)
    expect(work).toMatchObject({ status: 'scheduled', skippedRunId: first.run.id })
  })

  it('allows exactly one exact-due claim across repository callers', async () => {
    const { database, repository: first } = await createContext()
    await seedScheduledWork(first, 'claim-race')
    const second = createPgliteConnectorRepository(database)

    const results = await Promise.all([first, second].map((repository) => repository.recordRunRequest({
      connectorInstanceId: 'claim-race', mode: 'catch_up', startedAt: DUE,
    })))

    expect(results.filter(({ acquired }) => acquired)).toHaveLength(1)
    expect(new Set(results.map(({ run }) => run.id))).toHaveLength(1)
    const [work] = await database.select().from(connectorCaptureWork)
    expect(work).toMatchObject({
      status: 'claimed', acquisitionRunId: results[0]!.run.id,
    })
    expect(work?.acquisitionToken).toEqual(expect.any(String))
    expect(work?.claimedAt).toBe(DUE)
  })

  it('releases a claimed row when its interrupted run is recovered', async () => {
    const { database, repository } = await createContext()
    await seedScheduledWork(repository, 'recovery')
    const claimed = await repository.recordRunRequest({
      connectorInstanceId: 'recovery', mode: 'manual', startedAt: DUE,
    })
    expect(claimed.acquired).toBe(true)

    await expect(repository.recoverInterruptedRuns({
      completedAt: '2026-07-11T12:02:00.000Z',
    })).resolves.toBe(1)

    const [work] = await database.select().from(connectorCaptureWork)
    expect(work).toMatchObject({
      status: 'scheduled', acquisitionRunId: null, acquisitionToken: null, claimedAt: null,
    })
    const reacquired = await repository.recordRunRequest({
      connectorInstanceId: 'recovery', mode: 'catch_up', startedAt: '2026-07-11T12:03:00.000Z',
    })
    expect(reacquired).toMatchObject({
      acquired: true, acquiredWork: { kind: 'connector_capture', retryWorkId: work!.id },
    })
  })

  it('reuses the persisted claim after the database owner restarts', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-work-restart-'))
    const dataDir = path.join(temporaryRoot, 'pglite')
    prepareConfiguredPgliteDataPath(dataDir)
    try {
      const firstClient = await createPgliteClient({ dataDir })
      const first = createPgliteConnectorRepository(createPgliteDatabase(firstClient))
      await seedScheduledWork(first, 'restart')
      const claimed = await first.recordRunRequest({
        connectorInstanceId: 'restart', mode: 'catch_up', startedAt: DUE,
      })
      expect(claimed.acquired).toBe(true)
      await firstClient.close()

      const secondClient = await createPgliteClient({ dataDir })
      const database = createPgliteDatabase(secondClient)
      const second = createPgliteConnectorRepository(database)
      const repeated = await second.recordRunRequest({
        connectorInstanceId: 'restart', mode: 'catch_up', startedAt: DUE,
      })
      expect(repeated).toMatchObject({ acquired: false, acquiredWork: null })
      expect(repeated.run.id).toBe(claimed.run.id)
      const [work] = await database.select().from(connectorCaptureWork)
      expect(work).toMatchObject({ status: 'claimed', acquisitionRunId: claimed.run.id })
      await secondClient.close()
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('uses the due index independently of a large terminal history', async () => {
    const { client, database, repository } = await createContext()
    const instance = await repository.upsertInstance(instanceInput('bounded-history'))
    const rows = Array.from({ length: 2_000 }, (_, index) => terminalWork(instance.id, index))
    for (let index = 0; index < rows.length; index += 50) {
      await database.insert(connectorCaptureWork).values(rows.slice(index, index + 50))
    }
    await persistRetryAdvice(repository, instance.id)
    await client.exec('set enable_seqscan = off')

    const plan = await explainPlan(client,
      "select * from connector_capture_work where status='scheduled' and next_eligible_at <= $1 order by next_eligible_at limit 1",
      [DUE])
    expect(plan).toContain('idx_connector_capture_work_due')
    expect(plan).not.toContain('Seq Scan')
  })
})

function instanceInput(id: string) {
  return {
    id, connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
    displayName: id, enabled: true, filters: {}, createdAt: BASE,
  }
}

async function seedScheduledWork(
  repository: ReturnType<typeof createPgliteConnectorRepository>,
  connectorInstanceId: string,
) {
  const instance = await repository.upsertInstance(instanceInput(connectorInstanceId))
  await persistRetryAdvice(repository, instance.id)
}

async function persistRetryAdvice(
  repository: ReturnType<typeof createPgliteConnectorRepository>,
  connectorInstanceId: string,
) {
  await repository.recordRefreshResult({
    connectorInstanceId, mode: 'manual', startedAt: BASE,
    completedAt: '2026-07-11T12:00:01.000Z', config: {}, filters: {},
    filterSignature: 'filters:{}',
    result: {
      ...completedConnectorRefreshContract('2026-07-11'),
      observations: [], warnings: [], stats: { observations: 0 },
      coverage: { start: '2026-07-11T11:00:00.000Z', end: BASE },
      nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
      retryHints: {
        state: 'scheduled', reason: 'server_failure', attempt: 1, maxAttempts: 3,
        lastAttemptAt: BASE, computedDelayMs: 60_000, nextAttemptAt: DUE,
        horizonAt: '2026-07-11T13:00:00.000Z',
      },
    },
  })
}

function terminalWork(connectorInstanceId: string, index: number) {
  return {
    id: `terminal-${index}`, workspaceId: DEFAULT_WORKSPACE_ID,
    idempotencyKey: `terminal:${index}`, connectorInstanceId,
    filterSignature: `terminal:${index}`, checkpointSchemaVersion: 'v1',
    checkpointGeneration: String(index), attempt: 3, maxAttempts: 3,
    status: 'exhausted' as const, nextEligibleAt: null, failureReason: 'server_failure',
    failureDetail: null, ownerVersion: '1', acquisitionToken: null,
    claimedAt: null, claimExpiresAt: null, lastAttemptAt: BASE,
    computedDelayMs: 60_000, serverMinimumDelayMs: null,
    horizonAt: '2026-07-11T13:00:00.000Z', acquisitionRunId: null,
    skippedRunId: null, createdAt: BASE, updatedAt: BASE,
  }
}

async function explainPlan(client: PgliteClient, query: string, parameters: unknown[]) {
  const result = await client.query<Record<'QUERY PLAN', string>>(`explain ${query}`, parameters)
  return result.rows.map((row) => row['QUERY PLAN']).join('\n')
}
