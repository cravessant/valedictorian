import { describe, expect, it, vi } from 'vitest'
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
})
