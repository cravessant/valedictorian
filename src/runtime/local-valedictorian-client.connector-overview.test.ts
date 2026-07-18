import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { connectorOverviewListResultSchema } from 'sparxie'
import { describe, expect, it } from 'vitest'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { completedConnectorRefreshContract } from '../modules/connectors/connector-refresh-result.test-helpers'
import { createLocalValedictorianClient } from './local-valedictorian-client'

describe('runtime connector overview', () => {
  it('returns a strict sanitized never-run connector row through the workspace contract', async () => {
    const client = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector]),
      now: () => new Date('2026-07-13T12:00:00.000Z'),
      seedDataMode: 'none',
      pgliteDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-connector-overview-')),
    })
    await client.connectors.create({
      id: 'overview-never-run', connectorId: 'fixture.overview', connectorVersion: '1.0.0',
      displayName: 'Overview never run', enabled: true,
    })

    const result = connectorOverviewListResultSchema.parse(
      await client.connectors.overview.list(),
    )

    expect(result).toEqual({
      items: [{
        id: 'overview-never-run', connectorId: 'fixture.overview', connectorVersion: '1.0.0',
        displayName: 'Overview never run', enabled: true,
        health: {
          severity: 'warning', status: 'never_run', statusLabel: 'Never run',
          summary: 'Connector is enabled but has not run yet.', warningCount: 0, warnings: [],
        },
        actionRequired: [], actions: [], latestRun: null, cooldown: null,
      }],
      nextCursor: null,
    })
    expect(JSON.stringify(result)).not.toMatch(/auth|config|filter|scope|retry|session|secret/i)
  })

  it('paginates in UTF-8 id order and binds continuation to the exact filters', async () => {
    const client = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector]),
      seedDataMode: 'none',
      pgliteDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-connector-overview-page-')),
    })
    for (const [id, enabled] of [
      ['é-overview', true], ['z-overview', true], ['a-overview', true], ['😀-overview', true],
      ['disabled-overview', false],
    ] as const) {
      await client.connectors.create({
        id, connectorId: 'fixture.overview', connectorVersion: '1.0.0',
        displayName: id, enabled,
      })
    }

    const first = await client.connectors.overview.list({ enabled: true, limit: 2 })
    expect(first.items.map(({ id }) => id)).toEqual(['a-overview', 'z-overview'])
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await client.connectors.overview.list({
      cursor: first.nextCursor!, enabled: true, limit: 2,
    })
    expect(second).toMatchObject({
      items: [{ id: 'é-overview' }, { id: '😀-overview' }],
      nextCursor: null,
    })
    await expect(client.connectors.overview.list({
      cursor: first.nextCursor!, enabled: false, limit: 2,
    })).rejects.toMatchObject({ code: 'invalid_connector_overview_cursor', statusCode: 400 })
    await expect(client.connectors.overview.list({ cursor: 'not-a-valid-cursor' }))
      .rejects.toMatchObject({ code: 'invalid_connector_overview_cursor', statusCode: 400 })
    await expect(client.connectors.overview.list({
      cursor: `${first.nextCursor!}!`, enabled: true, limit: 2,
    })).rejects.toMatchObject({ code: 'invalid_connector_overview_cursor', statusCode: 400 })
  })

  it('applies conjunctive public status and severity filters before pagination', async () => {
    const client = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector]),
      seedDataMode: 'none',
      pgliteDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-connector-overview-filter-')),
    })
    for (const id of ['caught-up', 'never-run']) {
      await client.connectors.create({
        id, connectorId: 'fixture.overview', connectorVersion: '1.0.0',
        displayName: id, enabled: true,
      })
    }
    await client.connectors.runs.trigger({
      connectorInstanceId: 'caught-up', coverageEndedAt: '2026-07-13T12:00:00.000Z',
    })

    await expect(client.connectors.overview.list({
      enabled: true, severity: 'healthy', status: 'caught_up', limit: 1,
    })).resolves.toMatchObject({
      items: [{ id: 'caught-up', health: { severity: 'healthy', status: 'caught_up' } }],
      nextCursor: null,
    })
    await expect(client.connectors.overview.list({ status: 'failed' })).resolves.toEqual({
      items: [], nextCursor: null,
    })
  })

  it('classifies an explicit user skip without exposing its persisted reason', async () => {
    const client = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector]),
      seedDataMode: 'none',
      pgliteDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-connector-overview-skip-')),
    })
    await client.connectors.create({
      id: 'user-skip', connectorId: 'fixture.overview', connectorVersion: '1.0.0',
      displayName: 'User skip', enabled: true,
    })
    await client.connectors.status.skip({
      connectorInstanceId: 'user-skip', reason: 'user_skipped_private_detail',
    })

    const result = await client.connectors.overview.list({ status: 'skipped' })
    expect(result.items[0]).toMatchObject({
      id: 'user-skip', health: { status: 'skipped' },
      latestRun: {
        status: 'cancelled', outcome: 'cancelled', cancellationKind: 'user_skipped',
      },
    })
    expect(JSON.stringify(result)).not.toContain('user_skipped_private_detail')
  })
})

const fixtureConnector: AppJobConnector = {
  definition: { id: 'fixture.overview', version: '1.0.0' },
  async refresh(input) {
    return {
      ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
      coverage: input.coverage,
      nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-overview@1' },
      observations: [], stats: { observations: 0 }, warnings: [],
    }
  },
}
