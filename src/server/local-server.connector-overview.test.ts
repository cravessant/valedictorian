import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient } from '@sparxie/sdk'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createLocalValedictorianClient } from './local-valedictorian-client.test-harness'
import { createLocalServerHttpTestFixture } from './local-server.http-test-harness'

describe('local connector overview HTTP route', () => {
  const fixture = createLocalServerHttpTestFixture()
  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  it('serves the workspace-scoped Sparxie overview contract', async () => {
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([fixtureConnector]),
      seedDataMode: 'none',
      pgliteDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-overview-')),
    })
    await localClient.connectors.create({
      id: 'http-overview', connectorId: 'fixture.overview', connectorVersion: '1.0.0',
      displayName: 'HTTP overview', enabled: true,
    })
    await localClient.connectors.create({
      id: 'http-disabled', connectorId: 'fixture.overview', connectorVersion: '1.0.0',
      displayName: 'HTTP disabled', enabled: false,
    })
    const server = await fixture.start({
      client: localClient, host: '127.0.0.1', port: 0,
      resolveWorkspaceClient(workspaceId) {
        expect(workspaceId).toBe('overview-workspace')
        return localClient
      },
    })
    const workspace = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('overview-workspace')

    await expect(workspace.connectors.overview.list()).resolves.toMatchObject({
      items: [
        {
          id: 'http-disabled', enabled: false, latestRun: null,
          health: {
            status: 'never_run', summary: 'Connector is disabled and has not run yet.',
          },
        },
        { id: 'http-overview', enabled: true },
      ],
      nextCursor: null,
    })
    await expect(workspace.connectors.overview.list({ enabled: true })).resolves.toMatchObject({
      items: [{ id: 'http-overview', health: { status: 'never_run' }, latestRun: null }],
      nextCursor: null,
    })
    await expect(workspace.connectors.overview.list({ enabled: false })).resolves.toMatchObject({
      items: [{ id: 'http-disabled', health: { status: 'never_run' }, latestRun: null }],
      nextCursor: null,
    })
    const invalid = await fetch(
      `${server.url}/v1/workspaces/overview-workspace/connectors/overview?cursor=invalid`,
    )
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({
      code: 'invalid_connector_overview_cursor',
      message: 'Invalid connector overview cursor.',
    })
  })
})

const fixtureConnector: AppJobConnector = {
  definition: { id: 'fixture.overview', version: '1.0.0' },
  async refresh() {
    throw new Error('refresh is not used by HTTP connector overview tracer')
  },
}
