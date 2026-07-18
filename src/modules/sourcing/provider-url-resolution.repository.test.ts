import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  connectorInstances,
  connectorRuns,
  retryWork,
  sourceExecutionScopes,
} from '../../db/schema'
import {
  createPgliteClient,
  createPgliteDatabase,
  migratePgliteDatabase,
  type PgliteDatabase,
} from '../../db/pglite'
import { createPgliteRawSourceRepository } from './raw-source.repository'
import { createProviderUrlResolutionRepository } from './provider-url-resolution.repository'

describe('provider URL resolution repository', () => {
  it('resumes a pending operation after reopen and atomically claims it once', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-url-work-'))
    const dataDir = path.join(directory, 'pglite')
    const clock = new Date('2026-07-16T12:00:00.000Z')
    let client = await createPgliteClient({ dataDir })

    try {
      const firstDatabase = await migratePgliteDatabase(client)
      const capture = await createConnectorCapture(firstDatabase, 'one', clock.toISOString())
      const intake = await createPgliteRawSourceRepository(
        firstDatabase,
        () => clock,
      ).ingestBatch({
        records: [{
          adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.14.0' },
          capture,
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
      await firstRepository.enqueue({
        captureEvidenceVersionId: intake.receipts[0].revision.id,
        connectorInstanceId: capture.connectorInstanceId,
        executionScopeId: capture.executionScopeId,
        inputHash: 'sha256:provider-one',
        intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
        providerRecordId: 'jobright.public:provider-one',
        resolverId: 'jobright.provider-url',
        resolverVersion: 'jobright-provider-url@1',
      })

      await expect(firstDatabase.select().from(retryWork)).resolves.toEqual([
        expect.objectContaining({
          attempt: 1,
          captureEvidenceVersionId: intake.receipts[0].revision.id,
          nextAttemptAt: clock.toISOString(),
          state: 'scheduled',
        }),
      ])
      await expect(firstRepository.claimDue(clock.toISOString())).resolves.not.toBeNull()
      await client.close()

      client = await createPgliteClient({ dataDir })
      const reopenedDatabase = createPgliteDatabase(client)
      const reopened = createProviderUrlResolutionRepository(reopenedDatabase, () => clock)
      await expect(reopened.nextDueAt()).resolves.toBeNull()
      await expect(reopened.recoverAcquired(clock.toISOString())).resolves.toBe(1)
      await expect(reopened.nextDueAt()).resolves.toBe(clock.toISOString())

      const [firstClaim, secondClaim] = await Promise.all([
        reopened.claimDue(clock.toISOString()),
        reopened.claimDue(clock.toISOString()),
      ])

      expect(firstClaim).toMatchObject({
        captureEvidenceVersionId: intake.receipts[0].revision.id,
        connectorInstanceId: capture.connectorInstanceId,
        providerRecordId: 'jobright.public:provider-one',
        resolverId: 'jobright.provider-url',
      })
      expect(secondClaim).toBeNull()
      await expect(reopenedDatabase.select().from(retryWork)).resolves.toEqual([
        expect.objectContaining({
          acquisitionToken: firstClaim?.acquisitionToken,
          state: 'acquired',
        }),
      ])
    } finally {
      await client.close()
      fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  it('does not let stale failure evidence clear a newer acquisition claim', async () => {
    const clock = new Date('2026-07-16T12:00:00.000Z')
    const fixture = await createProviderUrlRaceFixture(clock)

    try {
      const firstClaim = await fixture.repository.claimDue(clock.toISOString())
      expect(firstClaim).not.toBeNull()
      await fixture.repository.release(firstClaim!)
      const newerClaim = await fixture.repository.claimDue(clock.toISOString())
      expect(newerClaim).not.toBeNull()

      await expect(fixture.repository.recordFailureEvidence({
        acquisitionToken: firstClaim!.acquisitionToken,
        retryWorkId: firstClaim!.retryWorkId,
        evidence: { reason: 'stale_claim_should_be_ignored' },
        terminal: true,
      })).resolves.toBe(false)

      const [row] = await fixture.database.select().from(retryWork).limit(1)
      expect(row).toMatchObject({
        state: 'acquired',
        acquisitionToken: newerClaim!.acquisitionToken,
        acquiredAt: clock.toISOString(),
      })
      expect(JSON.parse(row!.lineageJson).failureEvidence).toBeUndefined()
    } finally {
      await fixture.client.close()
    }
  })
})

async function createProviderUrlRaceFixture(clock: Date) {
  const client = await createPgliteClient()
  const database = await migratePgliteDatabase(client)
  const capture = await createConnectorCapture(database, 'race', clock.toISOString())
  const intake = await createPgliteRawSourceRepository(database, () => clock).ingestBatch({
    records: [{
      adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.14.0' },
      capture,
      observedAt: clock.toISOString(),
      providerRecordId: 'jobright.public:provider-race',
      providerSchema: 'jobright-authenticated-search@1',
      payload: { companyName: 'Example', roleTitle: 'Engineer' },
    }],
  })
  const repository = createProviderUrlResolutionRepository(database, () => clock)
  await repository.enqueue({
    captureEvidenceVersionId: intake.receipts[0].revision.id,
    connectorInstanceId: capture.connectorInstanceId,
    executionScopeId: capture.executionScopeId,
    inputHash: 'sha256:provider-race',
    intermediaryUrl: 'https://jobright.ai/jobs/info/provider-race',
    providerRecordId: 'jobright.public:provider-race',
    resolverId: 'jobright.provider-url',
    resolverVersion: 'jobright-provider-url@1',
  })
  return { client, database, repository }
}

async function createConnectorCapture(
  database: PgliteDatabase,
  suffix: string,
  timestamp: string,
) {
  const executionScopeId = `provider-scope-${suffix}`
  const connectorInstanceId = `provider-instance-${suffix}`
  const connectorRunId = `provider-run-${suffix}`
  await database.insert(sourceExecutionScopes).values({
    id: executionScopeId, createdAt: timestamp, updatedAt: timestamp,
  })
  await database.insert(connectorInstances).values({
    id: connectorInstanceId, executionScopeId, connectorId: 'jobright.resolver',
    connectorVersion: '0.14.0', displayName: 'Jobright', enabled: true,
    configJson: '{}', createdAt: timestamp, updatedAt: timestamp,
  })
  await database.insert(connectorRuns).values({
    id: connectorRunId, executionScopeId, connectorInstanceId, mode: 'manual',
    status: 'running', startedAt: timestamp, observationCount: 0, warningCount: 0,
    statsJson: '{}', warningsJson: '[]', retryHintsJson: 'null',
    createdAt: timestamp, updatedAt: timestamp,
  })
  return { connectorInstanceId, connectorRunId, executionScopeId }
}
