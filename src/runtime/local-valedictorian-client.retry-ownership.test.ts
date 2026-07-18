import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestLocalValedictorianClient as createRuntimeLocalValedictorianClient,
  getTestLocalValedictorianDatabase,
} from './local-valedictorian-client.test-harness'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'

function createTempDatabasePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-client-')), 'pglite')
}

describe('runtime local Valedictorian client retry ownership dispatch', () => {
  const originalReferenceTrackerPath = process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH

  beforeEach(() => {
    process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = path.join(
      os.tmpdir(),
      'valedictorian-missing-reference-tracker.md',
    )
  })

  afterEach(() => {
    if (originalReferenceTrackerPath === undefined) {
      delete process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
    } else {
      process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = originalReferenceTrackerPath
    }
  })

  it('dispatches acquired normalization work by trusted ownership and fails unavailable owners without refresh', async () => {
    const pgliteDataPath = createTempDatabasePath()
    const refresh = vi.fn(async () => {
      throw new Error('Connector refresh must not run for untrusted normalization ownership')
    })
    const resolveOwnedCompany = vi.fn((context: { hashInput: (value: string) => string }) => [{
      resolverId: 'fixture.owned-company', resolverVersion: '1.0.0', field: 'companyName' as const,
      inputHash: context.hashInput('Owned Co'), status: 'resolved' as const, value: 'Owned Co', confidence: 1,
    }])
    const resolveUnaffectedRole = vi.fn(() => {
      throw new Error('Unaffected resolver must not execute during exact ownership replay')
    })
    const resolver = {
      declaration: {
        id: 'fixture.owned-company', version: '1.0.0', requiredInputs: ['rawRevision'] as const,
        outputFields: ['companyName'] as const, capabilities: ['pure'] as const, costClass: 'none' as const, precedence: 1_000,
      },
      resolve: resolveOwnedCompany,
    }
    const unaffectedResolver = {
      declaration: {
        id: 'fixture.unaffected-role', version: '1.0.0', requiredInputs: ['rawRevision'] as const,
        outputFields: ['roleTitle'] as const, capabilities: ['pure'] as const, costClass: 'none' as const, precedence: 1_000,
      },
      resolve: resolveUnaffectedRole,
    }
    const connector = {
      definition: { id: 'fixture.jobs', version: '1.0.0', capabilities: { supportsFiltering: true } },
      refresh,
    } as AppJobConnector
    const { createNormalizationResolverRegistry, hashJson } = await import('../modules/sourcing/normalization.registry')
    const {
      retryWork, captureLineages, captureEvidenceVersions, captures,
      normalizationRuns, normalizationAttempts, normalizationFieldOutcomes, connectorRuns, connectorInstances,
    } = await import('../db/schema')
    const client = await createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      normalizationRegistry: createNormalizationResolverRegistry([resolver, unaffectedResolver]),
      now: () => new Date('2026-07-11T12:01:00.000Z'),
      seedDataMode: 'none',
      pgliteDataPath,
    })
    const database = getTestLocalValedictorianDatabase(client)
    const repository = createPgliteConnectorRepository(database)
    await repository.upsertInstance({
      id: 'norm-owner', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Norm owner', enabled: true, filters: {}, createdAt: '2026-07-11T11:00:00.000Z',
    })
    const [instanceRow] = await database.select({ id: connectorInstances.executionScopeId })
      .from(connectorInstances).limit(1)
    const executionScopeId = instanceRow?.id ?? null
    await database.insert(connectorRuns).values({
      id: 'intake-run',
      executionScopeId,
      connectorInstanceId: 'norm-owner',
      mode: 'manual',
      status: 'completed',
      startedAt: '2026-07-11T11:00:00.000Z',
      completedAt: '2026-07-11T11:00:00.000Z',
      coverageStartedAt: '2026-07-11T10:00:00.000Z',
      coverageEndedAt: '2026-07-11T11:00:00.000Z',
      configJson: '{}',
      filtersJson: '{}',
      filterSignature: 'filters:{}',
      observationCount: 1,
      warningCount: 0,
      statsJson: '{}',
      warningsJson: '[]',
      retryHintsJson: 'null',
      createdAt: '2026-07-11T11:00:00.000Z',
      updatedAt: '2026-07-11T11:00:00.000Z',
      deletedAt: null,
    })
    await database.insert(captureLineages).values({ id: 'owned-record', createdAt: '2026-07-11T11:00:00.000Z' })
    await database.insert(captureEvidenceVersions).values({
      id: 'owned-revision', captureLineageId: 'owned-record', revision: 1, contentHash: 'sha256:owned',
      adapterId: 'manual.fixture', adapterKind: 'manual', adapterVersion: '1.0.0',
      payloadJson: JSON.stringify({ company: 'Owned Co', title: 'Intern', url: 'https://jobs.lever.co/acme/owned-1' }),
      observedAt: '2026-07-11T11:00:00.000Z', evidenceJson: JSON.stringify([]),
      createdAt: '2026-07-11T11:00:00.000Z',
    })
    await database.insert(captures).values({
      id: 'intake-occurrence',
      captureLineageId: 'owned-record',
      captureEvidenceVersionId: 'owned-revision',
      connectorInstanceId: 'norm-owner',
      connectorRunId: 'intake-run',
      executionScopeId,
      observedAt: '2026-07-11T11:00:00.000Z',
      receivedAt: '2026-07-11T11:00:00.000Z',
    })
    await database.insert(normalizationRuns).values({
      id: 'prior-run', captureLineageId: 'owned-record', captureEvidenceVersionId: 'owned-revision',
      triggerCaptureId: 'intake-occurrence',
      triggerConnectorInstanceId: 'norm-owner',
      triggerConnectorRunId: 'intake-run',
      inputHash: 'sha256:prior', resolverSetHash: 'sha256:prior-set',
      canonicalSchemaVersion: 'canonical-source-candidate/v1', gatePolicyVersion: 'sourcing-admission/v1',
      triggerKind: 'intake', triggerId: null, status: 'completed',
      createdAt: '2026-07-11T11:00:00.000Z', updatedAt: '2026-07-11T11:00:00.000Z',
    })
    await database.insert(normalizationAttempts).values({
      id: 'prior-attempt', runId: 'prior-run', captureEvidenceVersionId: 'owned-revision', sequence: 0,
      resolverId: 'fixture.unaffected-role', resolverVersion: '1.0.0', inputHash: 'sha256:prior-role',
      declarationJson: JSON.stringify(unaffectedResolver.declaration),
      applicabilityJson: JSON.stringify([]), status: 'completed',
      startedAt: '2026-07-11T11:00:00.000Z', completedAt: '2026-07-11T11:00:00.000Z',
    })
    await database.insert(normalizationFieldOutcomes).values({
      id: 'prior-role-outcome', runId: 'prior-run', attemptId: 'prior-attempt', sequence: 0,
      attemptSequence: 0, outcomeIndex: 0, field: 'roleTitle', status: 'resolved',
      resolverId: 'fixture.unaffected-role', resolverVersion: '1.0.0', inputHash: 'sha256:prior-role',
      outcomeJson: JSON.stringify({
        resolverId: 'fixture.unaffected-role', resolverVersion: '1.0.0', field: 'roleTitle',
        inputHash: 'sha256:prior-role', status: 'resolved', value: 'Intern', confidence: 1,
      }),
    })
    const inputHash = hashJson({ raw: 'sha256:owned', resolver: resolver.declaration })
    await database.insert(retryWork).values({
      id: 'owned-retry', executionScopeId, kind: 'normalization', connectorInstanceId: null, filterSignature: null,
      checkpointSchemaVersion: null, checkpointGeneration: null, captureEvidenceVersionId: 'owned-revision',
      resolverId: 'fixture.owned-company', resolverVersion: '1.0.0', inputHash,
      reason: 'rate_limit', attempt: 1, maxAttempts: 3, lastAttemptAt: '2026-07-11T12:00:00.000Z',
      computedDelayMs: 60_000, serverMinimumDelayMs: null, nextAttemptAt: '2026-07-11T12:00:30.000Z',
      horizonAt: '2026-07-11T13:00:00.000Z', state: 'scheduled', ownerVersion: '1.0.0',
      lineageJson: JSON.stringify({ connectorInstanceId: 'norm-owner' }),
      acquiredAt: null, acquisitionToken: null, acquisitionRunId: null, skippedRunId: null,
      createdAt: '2026-07-11T12:00:00.000Z', updatedAt: '2026-07-11T12:00:00.000Z', deletedAt: null,
    })
    const occurrenceCountBefore = (await database.select().from(captures)).length

    const replayed = await client.connectors.runs.trigger({
      connectorInstanceId: 'norm-owner', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: '2026-07-11T12:01:00.000Z',
    })
    expect(replayed).toMatchObject({ status: 'completed' })
    expect(refresh).not.toHaveBeenCalled()
    expect(resolveOwnedCompany).toHaveBeenCalledTimes(1)
    expect(resolveUnaffectedRole).not.toHaveBeenCalled()
    expect(await database.select().from(captures)).toEqual([
      expect.objectContaining({ id: 'intake-occurrence' }),
    ])
    expect(await database.select().from(captures)).toHaveLength(occurrenceCountBefore)
    expect(await database.select().from(normalizationFieldOutcomes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'prior-role-outcome', field: 'roleTitle', resolverId: 'fixture.unaffected-role' }),
      ]),
    )
    expect(await database.select().from(normalizationAttempts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resolverId: 'fixture.owned-company',
          resolverVersion: '1.0.0',
          captureEvidenceVersionId: 'owned-revision',
        }),
        expect.objectContaining({ id: 'prior-attempt', resolverId: 'fixture.unaffected-role' }),
      ]),
    )
    expect((await database.select().from(normalizationAttempts)).filter((row) => row.resolverId === 'fixture.unaffected-role')).toHaveLength(1)
    expect(await database.select().from(normalizationRuns)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          captureEvidenceVersionId: 'owned-revision',
          triggerCaptureId: null,
          triggerConnectorInstanceId: null,
          triggerConnectorRunId: null,
        }),
        expect.objectContaining({ id: 'prior-run', triggerCaptureId: 'intake-occurrence' }),
      ]),
    )
    expect(await database.select().from(retryWork)).toEqual([
      expect.objectContaining({
        id: 'owned-retry',
        state: 'completed',
        acquiredAt: null,
        acquisitionToken: null,
        acquisitionRunId: null,
      }),
    ])

    await database.insert(retryWork).values({
      id: 'missing-owner-retry', executionScopeId, kind: 'normalization', connectorInstanceId: null, filterSignature: null,
      checkpointSchemaVersion: null, checkpointGeneration: null, captureEvidenceVersionId: 'owned-revision',
      resolverId: 'fixture.missing-owner', resolverVersion: '9.9.9', inputHash: 'sha256:' + 'b'.repeat(64),
      reason: 'rate_limit', attempt: 1, maxAttempts: 3, lastAttemptAt: '2026-07-11T12:00:00.000Z',
      computedDelayMs: 60_000, serverMinimumDelayMs: null, nextAttemptAt: '2026-07-11T12:00:30.000Z',
      horizonAt: '2026-07-11T13:00:00.000Z', state: 'scheduled', ownerVersion: '9.9.9',
      lineageJson: JSON.stringify({ connectorInstanceId: 'norm-owner' }),
      acquiredAt: null, acquisitionToken: null, acquisitionRunId: null, skippedRunId: null,
      createdAt: '2026-07-11T12:00:00.000Z', updatedAt: '2026-07-11T12:00:00.000Z', deletedAt: null,
    })
    await expect(client.connectors.runs.trigger({
      connectorInstanceId: 'norm-owner', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: '2026-07-11T12:01:00.000Z',
    })).rejects.toThrow(/Trusted normalization owner unavailable/)
    expect(refresh).not.toHaveBeenCalled()
    expect(await database.select().from(retryWork)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'missing-owner-retry',
          state: 'scheduled',
          acquiredAt: null,
          acquisitionToken: null,
          acquisitionRunId: null,
        }),
      ]),
    )
  })
})
