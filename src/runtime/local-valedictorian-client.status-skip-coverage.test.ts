import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'

function createTempSqlitePath() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-status-skip-')),
    'valedictorian.sqlite',
  )
}

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
    const sqlitePath = createTempSqlitePath()
    const skipInstant = '2026-07-11T18:45:00.000Z'
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([createFixtureConnector()]),
      now: () => new Date(skipInstant),
      seedDataMode: 'none',
      sqlitePath,
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
        status: 'skipped',
        mode: 'manual',
        coverage: {
          start: '2026-06-01T00:00:00.000Z',
          end: skipInstant,
        },
      },
    })

    const listed = await client.connectors.runs.list({
      connectorInstanceId: 'skip-coverage',
    })
    expect(listed.items[0]).toMatchObject({
      status: 'skipped',
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
