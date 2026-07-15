import { describe, expect, it } from 'vitest'
import type { AppJobConnector } from './connector.runner'
import { assertSupportedConnectorSettings } from './connector.settings-validation'

describe('connector settings host boundary', () => {
  it('rejects undeclared persisted config even when a connector schema permits additional properties', () => {
    const connector = createPermissiveConfigFixture()

    expect(() => assertSupportedConnectorSettings(
      connector,
      { batchSize: 20 },
      {},
    )).not.toThrow()
    expect(() => assertSupportedConnectorSettings(
      connector,
      { batchSize: 20, privateProviderConfig: 'must-not-be-persisted' },
      {},
    )).toThrow(/privateProviderConfig|not declared/i)
  })
})

function createPermissiveConfigFixture(): AppJobConnector {
  return {
    definition: {
      id: 'fixture.permissive-config',
      version: '1.0.0',
      configSchema: {
        version: 'fixture-permissive-config@1',
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            batchSize: { type: 'integer', enum: [10, 20, 50] },
          },
        },
      },
    },
    async refresh(input) {
      return {
        coverage: input.coverage,
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
        observations: [],
        operationOutcome: null,
        status: 'completed',
        stats: { observations: 0 },
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'caught_up',
            boundary: { earliestDate: input.coverage.start.slice(0, 10) },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'caught_up' },
        },
        warnings: [],
      }
    },
  }
}
