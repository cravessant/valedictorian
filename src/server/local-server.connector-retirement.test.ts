import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ConnectorRetirementConflictError, createHttpValedictorianClient } from '@sparxie/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import {
  closeLocalValedictorianClient,
  createLocalValedictorianClient,
  getLocalValedictorianTestDatabase,
  openPgliteTestDatabase,
} from './local-valedictorian-client.test-harness'
import { createLocalServerHttpTestFixture } from './local-server.http-test-harness'

function createTempDatabasePath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'connector-retirement-http-'))
}

describe('local connector retirement HTTP contract', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  it('retires a stale connector through the typed workspace client and persists across restart', async () => {
    const pgliteDataPath = createTempDatabasePath()
    const setup = await openPgliteTestDatabase(pgliteDataPath)
    await createPgliteConnectorRepository(setup.database).upsertInstance({
      id: 'stale-http-connector',
      connectorId: 'removed.connector',
      connectorVersion: '0.1.0',
      displayName: 'Removed connector',
      enabled: true,
      createdAt: '2026-07-13T12:00:00.000Z',
    })
    await setup.close()
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([]),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: 'workspace-retirement',
      now: () => new Date('2026-07-13T16:00:00.000Z'),
    })
    const server = await fixture.start({
      client: localClient,
      port: 0,
      resolveWorkspaceClient: () => localClient,
    })
    const workspace = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-retirement')

    await expect(workspace.connectors.remove({
      connectorInstanceId: 'stale-http-connector',
    })).resolves.toMatchObject({
      connectorInstanceId: 'stale-http-connector',
      lifecycle: 'retired',
      retiredAt: '2026-07-13T16:00:00.000Z',
    })
    await closeLocalValedictorianClient(localClient)

    const restarted = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([]),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: 'workspace-retirement',
    })
    await expect(restarted.connectors.list()).resolves.toEqual({ items: [] })
  })

  it('returns the sanitized typed conflict for active work through HTTP', async () => {
    const pgliteDataPath = createTempDatabasePath()
    const localClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([]),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: 'workspace-retirement',
    })
    const repository = createPgliteConnectorRepository(
      getLocalValedictorianTestDatabase(localClient),
    )
    await repository.upsertInstance({
      id: 'active-http-connector',
      connectorId: 'removed.connector',
      connectorVersion: '0.1.0',
      displayName: 'Active connector',
      enabled: true,
      createdAt: '2026-07-13T12:00:00.000Z',
    })
    const queued = (await repository.recordRunRequest({
      connectorInstanceId: 'active-http-connector',
      mode: 'manual',
      startedAt: '2026-07-13T15:00:00.000Z',
    })).run
    const server = await fixture.start({
      client: localClient,
      port: 0,
      resolveWorkspaceClient: () => localClient,
    })
    const workspace = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-retirement')

    const removal = workspace.connectors.remove({ connectorInstanceId: 'active-http-connector' })

    await expect(removal).rejects.toBeInstanceOf(ConnectorRetirementConflictError)
    await expect(removal).rejects.toMatchObject({
      status: 409,
      conflict: {
        code: 'connector_retirement_active_work_conflict',
        connectorInstanceId: 'active-http-connector',
        cancellationRequired: true,
        activeRuns: [{ connectorRunId: queued.id, status: 'queued' }],
      },
    })
  })
})
