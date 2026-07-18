import { describe, expect, it, vi } from 'vitest'
import {
  JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_ID,
  JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_VERSION,
  JOBRIGHT_CONNECTOR_ID,
} from '../modules/connectors/jobright.constants'
import { dispatchAcquiredNormalizationWork } from './local-connector-retry-dispatch'

describe('local connector normalization retry dispatch', () => {
  it('awaits persisted normalization context before replaying the acquired work', async () => {
    const normalize = vi.fn(async () => ({ status: 'completed' }))
    const completeRun = vi.fn(async () => ({ id: 'run-1', status: 'completed' }))
    const baselineOutcome = { field: 'companyName', status: 'resolved' }

    const result = await dispatchAcquiredNormalizationWork({
      acquiredWork: {
        kind: 'normalization',
        retryWorkId: 'retry-1',
        executionScopeId: 'scope-1',
        rawRevisionId: 'revision-1',
        resolverId: 'fixture.resolver',
        resolverVersion: 'fixture@1',
      } as never,
      connector: { definition: { id: 'fixture.connector' } } as never,
      connectorRepository: {
        completeRun,
        markRunFailed: vi.fn(),
      } as never,
      connectorRunner: {} as never,
      instanceId: 'instance-1',
      normalizationOrchestrator: { normalize } as never,
      normalizationRegistry: {
        resolvers: [{
          declaration: {
            id: 'fixture.resolver',
            version: 'fixture@1',
            capabilities: ['pure'],
            costClass: 'none',
            outputFields: ['roleTitle'],
            precedence: 10,
            requiredInputs: ['rawRevision'],
            scopeRequirement: 'none',
          },
          resolve: vi.fn(),
        }],
      } as never,
      normalizationRepository: {
        async getRawContext() {
          await Promise.resolve()
          return {
            revision: { id: 'revision-1', rawRecordId: 'raw-1' },
          }
        },
        async getLatestForRevision() {
          await Promise.resolve()
          return { fieldOutcomes: [baselineOutcome] }
        },
      } as never,
      now: () => new Date('2026-07-18T08:00:00.000Z'),
      runRequest: { id: 'run-1' } as never,
      startedAt: '2026-07-18T08:00:00.000Z',
    })

    expect(result).toEqual({ id: 'run-1', status: 'completed' })
    expect(normalize).toHaveBeenCalledWith(
      'raw-1',
      'revision-1',
      expect.any(Object),
      expect.objectContaining({ baselineOutcomes: [baselineOutcome] }),
    )
  })

  it('fails the run and releases acquired work when an async context read rejects', async () => {
    const markRunFailed = vi.fn(async () => ({ id: 'run-1', status: 'failed' }))
    const input = dispatchFixture({
      markRunFailed,
      async getRawContext() {
        throw new Error('context read failed')
      },
    })

    await expect(dispatchAcquiredNormalizationWork(input)).rejects.toThrow('context read failed')
    expect(markRunFailed).toHaveBeenCalledWith(expect.objectContaining({
      connectorRunId: 'run-1',
    }))
  })

  it('fails the run and releases acquired work when terminal completion rejects', async () => {
    const markRunFailed = vi.fn(async () => ({ id: 'run-1', status: 'failed' }))
    const input = dispatchFixture({
      markRunFailed,
      async completeRun() {
        throw new Error('completion failed')
      },
    })

    await expect(dispatchAcquiredNormalizationWork(input)).rejects.toThrow('completion failed')
    expect(markRunFailed).toHaveBeenCalledWith(expect.objectContaining({
      connectorRunId: 'run-1',
    }))
  })

  it('fails the run and releases acquired Jobright work when an async read rejects', async () => {
    const markRunFailed = vi.fn(async () => ({ id: 'run-1', status: 'failed' }))
    const input = dispatchFixture({
      markRunFailed,
      async getRawContext() {
        throw new Error('jobright context read failed')
      },
    }) as never as Record<string, unknown>
    input.connector = { definition: { id: JOBRIGHT_CONNECTOR_ID } }
    input.acquiredWork = {
      kind: 'normalization', retryWorkId: 'retry-1', executionScopeId: 'scope-1',
      rawRevisionId: 'revision-1',
      resolverId: JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_ID,
      resolverVersion: JOBRIGHT_AUTHENTICATED_DESTINATION_RESOLVER_VERSION,
    }

    await expect(dispatchAcquiredNormalizationWork(input as never))
      .rejects.toThrow('jobright context read failed')
    expect(markRunFailed).toHaveBeenCalledWith(expect.objectContaining({
      connectorRunId: 'run-1',
    }))
  })
})

function dispatchFixture(overrides: {
  completeRun?: () => Promise<never>
  getRawContext?: () => Promise<unknown>
  markRunFailed: ReturnType<typeof vi.fn>
}) {
  return {
    acquiredWork: {
      kind: 'normalization',
      retryWorkId: 'retry-1',
      executionScopeId: 'scope-1',
      rawRevisionId: 'revision-1',
      resolverId: 'fixture.resolver',
      resolverVersion: 'fixture@1',
    },
    connector: { definition: { id: 'fixture.connector' } },
    connectorRepository: {
      completeRun: overrides.completeRun ?? (async () => ({ id: 'run-1', status: 'completed' })),
      markRunFailed: overrides.markRunFailed,
    },
    connectorRunner: {},
    instanceId: 'instance-1',
    normalizationOrchestrator: { normalize: vi.fn(async () => ({ status: 'completed' })) },
    normalizationRegistry: {
      resolvers: [{
        declaration: {
          id: 'fixture.resolver', version: 'fixture@1', capabilities: ['pure'],
          costClass: 'none', outputFields: ['roleTitle'], precedence: 10,
          requiredInputs: ['rawRevision'], scopeRequirement: 'none',
        },
        resolve: vi.fn(),
      }],
    },
    normalizationRepository: {
      getRawContext: overrides.getRawContext ?? (async () => ({
        revision: { id: 'revision-1', rawRecordId: 'raw-1' },
      })),
      getLatestForRevision: async () => ({ fieldOutcomes: [] }),
    },
    now: () => new Date('2026-07-18T08:00:00.000Z'),
    runRequest: { id: 'run-1' },
    startedAt: '2026-07-18T08:00:00.000Z',
  } as never
}
