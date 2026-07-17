import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { connectorRuns, retryWork } from '../../db/schema'
import {
  createDrizzleDatabase,
  createFileDatabase,
  createInMemoryDatabase,
  migrateDatabase,
} from '../../db/sqlite'
import { createSqliteConnectorRepository } from '../connectors/connector.repository'
import { createSqliteRawSourceRepository } from './raw-source.repository'
import { createProviderUrlResolutionRepository } from './provider-url-resolution.repository'

describe('provider URL resolution repository', () => {
  it('resumes a pending operation after reopen and atomically claims it once', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-url-work-'))
    const sqlitePath = path.join(directory, 'workspace.sqlite')
    const clock = new Date('2026-07-16T12:00:00.000Z')
    const firstSqlite = createFileDatabase(sqlitePath)
    migrateDatabase(firstSqlite)
    const firstDatabase = createDrizzleDatabase(firstSqlite)
    const connectors = createSqliteConnectorRepository(firstDatabase)
    const instance = await connectors.upsertInstance({
      id: 'jobright-one',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.14.0',
      displayName: 'Jobright',
      enabled: true,
      createdAt: clock.toISOString(),
    })
    firstDatabase.insert(connectorRuns).values({
      id: 'run-one',
      executionScopeId: instance.executionScopeId,
      inputHash: 'sha256:provider-one',
      connectorInstanceId: instance.id,
      mode: 'manual',
      status: 'running',
      startedAt: clock.toISOString(),
      completedAt: null,
      coverageStartedAt: null,
      coverageEndedAt: clock.toISOString(),
      configJson: '{}',
      filtersJson: '{}',
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      statsJson: '{}',
      warningsJson: '[]',
      retryHintsJson: 'null',
      createdAt: clock.toISOString(),
      updatedAt: clock.toISOString(),
      deletedAt: null,
    }).run()
    const intake = await createSqliteRawSourceRepository(
      firstDatabase,
      () => clock,
    ).ingestBatch({
      records: [{
        adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.14.0' },
        capture: {
          connectorInstanceId: instance.id,
          connectorRunId: 'run-one',
          executionScopeId: instance.executionScopeId,
        },
        observedAt: clock.toISOString(),
        providerRecordId: 'jobright.public:provider-one',
        providerSchema: 'jobright-authenticated-search@1',
        payload: { companyName: 'Example', roleTitle: 'Engineer' },
      }],
    })
    const firstRepository = createProviderUrlResolutionRepository(
      firstDatabase,
      () => clock,
    )
    firstRepository.enqueue({
      captureEvidenceVersionId: intake.receipts[0].revision.id,
      connectorInstanceId: instance.id,
      executionScopeId: instance.executionScopeId,
      inputHash: 'sha256:provider-one',
      intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
      providerRecordId: 'jobright.public:provider-one',
      resolverId: 'jobright.provider-url',
      resolverVersion: 'jobright-provider-url@1',
    })

    expect(firstDatabase.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        attempt: 1,
        captureEvidenceVersionId: intake.receipts[0].revision.id,
        nextAttemptAt: clock.toISOString(),
        state: 'scheduled',
      }),
    ])
    const interruptedClaim = firstRepository.claimDue(clock.toISOString())
    expect(interruptedClaim).not.toBeNull()
    firstSqlite.close()

    const reopenedSqlite = createFileDatabase(sqlitePath)
    const reopenedDatabase = createDrizzleDatabase(reopenedSqlite)
    const reopened = createProviderUrlResolutionRepository(
      reopenedDatabase,
      () => clock,
    )
    expect(reopened.nextDueAt()).toBeNull()
    expect(reopened.recoverAcquired(clock.toISOString())).toBe(1)
    expect(reopened.nextDueAt()).toBe(clock.toISOString())

    const [firstClaim, secondClaim] = await Promise.all([
      Promise.resolve().then(() => reopened.claimDue(clock.toISOString())),
      Promise.resolve().then(() => reopened.claimDue(clock.toISOString())),
    ])

    expect(firstClaim).toMatchObject({
      captureEvidenceVersionId: intake.receipts[0].revision.id,
      connectorInstanceId: instance.id,
      providerRecordId: 'jobright.public:provider-one',
      resolverId: 'jobright.provider-url',
    })
    expect(secondClaim).toBeNull()
    expect(reopenedDatabase.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        acquisitionToken: firstClaim?.acquisitionToken,
        state: 'acquired',
      }),
    ])
    reopenedSqlite.close()
  })

  it('does not let stale failure evidence clear a newer acquisition claim', async () => {
    const clock = new Date('2026-07-16T12:00:00.000Z')
    const fixture = await createProviderUrlRaceFixture(clock)
    const firstClaim = fixture.repository.claimDue(clock.toISOString())
    expect(firstClaim).not.toBeNull()
    fixture.repository.release(firstClaim!)
    const newerClaim = fixture.repository.claimDue(clock.toISOString())
    expect(newerClaim).not.toBeNull()

    const recorded = fixture.repository.recordFailureEvidence({
      acquisitionToken: firstClaim!.acquisitionToken,
      retryWorkId: firstClaim!.retryWorkId,
      evidence: { reason: 'stale_claim_should_be_ignored' },
      terminal: true,
    })
    expect(recorded).toBe(false)

    const row = fixture.database.select().from(retryWork).get()!
    expect(row).toMatchObject({
      state: 'acquired',
      acquisitionToken: newerClaim!.acquisitionToken,
      acquiredAt: clock.toISOString(),
    })
    expect(JSON.parse(row.lineageJson).failureEvidence).toBeUndefined()
    fixture.sqlite.close()
  })
})

async function createProviderUrlRaceFixture(clock: Date) {
  const sqlite = createInMemoryDatabase()
  migrateDatabase(sqlite)
  const database = createDrizzleDatabase(sqlite)
  const connectors = createSqliteConnectorRepository(database)
  const instance = await connectors.upsertInstance({
    id: 'jobright-race', connectorId: 'jobright.resolver', connectorVersion: '0.14.0',
    displayName: 'Jobright', enabled: true, createdAt: clock.toISOString(),
  })
  database.insert(connectorRuns).values({
    id: 'run-race', executionScopeId: instance.executionScopeId,
    connectorInstanceId: instance.id, mode: 'manual', status: 'running',
    startedAt: clock.toISOString(), completedAt: null,
    coverageStartedAt: null, coverageEndedAt: clock.toISOString(),
    configJson: '{}', filtersJson: '{}', filterSignature: 'filters:{}',
    observationCount: 0, warningCount: 0, statsJson: '{}', warningsJson: '[]',
    retryHintsJson: 'null', createdAt: clock.toISOString(), updatedAt: clock.toISOString(), deletedAt: null,
  }).run()
  const intake = await createSqliteRawSourceRepository(database, () => clock).ingestBatch({
    records: [{
      adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.14.0' },
      capture: { connectorInstanceId: instance.id, connectorRunId: 'run-race', executionScopeId: instance.executionScopeId },
      observedAt: clock.toISOString(), providerRecordId: 'jobright.public:provider-race',
      providerSchema: 'jobright-authenticated-search@1', payload: { companyName: 'Example', roleTitle: 'Engineer' },
    }],
  })
  const repository = createProviderUrlResolutionRepository(database, () => clock)
  repository.enqueue({
    captureEvidenceVersionId: intake.receipts[0].revision.id,
    connectorInstanceId: instance.id,
    executionScopeId: instance.executionScopeId,
    inputHash: 'sha256:provider-race',
    intermediaryUrl: 'https://jobright.ai/jobs/info/provider-race',
    providerRecordId: 'jobright.public:provider-race',
    resolverId: 'jobright.provider-url',
    resolverVersion: 'jobright-provider-url@1',
  })
  return { database, repository, sqlite }
}
