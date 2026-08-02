import { describe, expect, it } from 'vitest'
import { createStaticConnectorRegistry } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/core/connector.registry'
import type { AppJobConnector } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/ports/connector.runner-contracts'
import { connectorRunSynchronizationCopy } from '@sparxie/valedictorian-local-runtime/connectors'
import {
  createOwnedTestPgliteDataPath,
  createTestLocalValedictorianClient as createRuntimeLocalValedictorianClient,
} from './local-valedictorian-client.test-harness'

function createFixtureConnector(): AppJobConnector {
  return {
    definition: {
      id: 'fixture.skip',
      version: '1.0.0',
      displayName: 'Skip fixture',
      capabilities: {
        fetchesPublicPages: false,
        resolvesIntermediaryLinks: false,
        supportsFiltering: false,
        supportsIncrementalRefresh: true,
      },
      checkpoint: { schemaVersion: 'fixture-checkpoint@1' },
    },
    async refresh() {
      throw new Error('refresh is not used by status-skip tracer')
    },
  }
}

describe('runtime connectors.status.skip coverage', () => {
  it('persists skipped run coverage from the selected earliest date through return and list', async () => {
    const pgliteDataPath = createOwnedTestPgliteDataPath('valedictorian-status-skip-')
    const skipInstant = '2026-07-11T18:45:00.000Z'
    const client = await createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([createFixtureConnector()]),
      now: () => new Date(skipInstant),
      seedDataMode: 'none',
      pgliteDataPath,
    })

    const created = await client.connectors.create({
      id: 'skip-coverage',
      connectorId: 'fixture.skip',
      connectorVersion: '1.0.0',
      displayName: 'Skip coverage',
      enabled: true,
      earliestBackfillDate: '2026-06-01',
    })
    expect(created.earliestBackfillDate).toBe('2026-06-01')

    const skipped = await client.connectors.status.skip({
      connectorInstanceId: 'skip-coverage',
      reason: 'user_skipped_for_coverage_tracer',
    })

    expect(skipped).toMatchObject({
      action: 'skip',
      status: 'skipped',
      run: {
        mode: 'manual',
        coverage: {
          start: '2026-06-01T00:00:00.000Z',
          end: skipInstant,
        },
        outcome: { kind: 'cancelled', reason: 'user_skipped_for_coverage_tracer' },
        status: 'cancelled',
      },
    })
    expect(connectorRunSynchronizationCopy(skipped.run)).toMatchObject({
      label: 'Skipped by user',
      state: 'skipped',
      summary: 'This synchronization work opportunity was skipped by the user.',
    })

    const listed = await client.connectors.runs.list({
      connectorInstanceId: 'skip-coverage',
    })
    expect(listed.items[0]).toMatchObject({
      status: 'cancelled',
      coverage: {
        start: '2026-06-01T00:00:00.000Z',
        end: skipInstant,
      },
      stats: expect.objectContaining({
        reason: 'user_skipped_for_coverage_tracer',
        skipped: true,
      }),
    })
  })
})
