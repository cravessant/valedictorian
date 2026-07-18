import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createHttpValedictorianClient } from 'sparxie'
import App from './App'
import {
  createApplication,
  createListResult,
  createSettingsApi,
  openConnectorEditor,
} from './App.test-helpers'
import { createStaticConnectorRegistry } from './modules/connectors/connector.registry'
import type { AppJobConnector } from './modules/connectors/connector.runner'
import { JOBRIGHT_CONNECTOR_ID, JOBRIGHT_CONNECTOR_VERSION } from './modules/connectors/jobright.constants'
import { deriveSourceExecutionScopeId } from './modules/source-execution/source-execution-governor'
import {
  closeTestLocalValedictorianClient,
  createTestLocalValedictorianClient as createLocalValedictorianClient,
  getTestLocalValedictorianDatabase,
} from './runtime/local-valedictorian-client.test-harness'
import type { LocalValedictorianClient } from './runtime/local-connector-client.contract'
import {
  createValedictorianHttpServer,
  type StartedValedictorianHttpServer,
} from './server/local-server'

const CLOCK = '2026-07-13T18:00:00.000Z'
const WORKSPACE_ID = 'workspace-connector-readd'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(async () => {
  cleanup()
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
  delete (window as Window & { connectors?: unknown }).connectors
  await activeServer?.close()
  activeServer = null
  if (activeClient) {
    await closeTestLocalValedictorianClient(activeClient)
    activeClient = null
  }
  if (activePgliteDataPath) {
    fs.rmSync(activePgliteDataPath, { force: true, recursive: true })
    activePgliteDataPath = null
  }
})

let activeServer: StartedValedictorianHttpServer | null = null
let activeClient: LocalValedictorianClient | null = null
let activePgliteDataPath: string | null = null

describe('Jobright remove then re-add through renderer HTTP and PGlite', () => {
  it('adds a fresh connector-instance id after remove without resurrecting the retired tombstone', async () => {
    const { client } = await startFixtureServer()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()

    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await openConnectorEditor()
    expect(await screen.findByText('1 connector instance configured.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Remove Jobright internslist' }))
      .toBeInTheDocument()

    const firstList = await client.connectors.list()
    expect(firstList.items).toHaveLength(1)
    const retiredId = firstList.items[0]!.id

    fireEvent.click(screen.getByRole('button', { name: 'Remove Jobright internslist' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Remove connector',
    }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Remove Jobright internslist' }))
        .not.toBeInTheDocument()
    })
    expect(await screen.findByRole('button', { name: 'Add Jobright connector' })).toBeEnabled()
    await expect(client.connectors.list()).resolves.toEqual({ items: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Add Jobright connector' }))
    expect(await screen.findByText('1 connector instance configured.')).toBeInTheDocument()
    expect(screen.queryByText(/already configured/i)).not.toBeInTheDocument()

    const secondList = await client.connectors.list()
    expect(secondList.items).toHaveLength(1)
    const replacement = secondList.items[0]!
    expect(replacement.id).not.toBe(retiredId)
    expect(replacement.id).not.toBe('jobright-default')
    expect(deriveSourceExecutionScopeId(replacement.id))
      .not.toBe(deriveSourceExecutionScopeId(retiredId))

    const database = getTestLocalValedictorianDatabase(client)
    expect((await database.execute(sql`
      select deleted_at as "deletedAt" from connector_instances where id = ${retiredId}
    `)).rows[0]).toEqual({ deletedAt: expect.any(String) })
    expect((await database.execute(sql`
      select deleted_at as "deletedAt" from connector_instances where id = ${replacement.id}
    `)).rows[0]).toEqual({ deletedAt: null })
  })
})

describe('active Jobright uniqueness after fresh-id create', () => {
  it('rejects a second active Jobright with a different instance id', async () => {
    activePgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jobright-active-dup-'))
    activeClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([createJobrightFixtureConnector()]),
      seedDataMode: 'none',
      pgliteDataPath: activePgliteDataPath,
      workspaceId: WORKSPACE_ID,
    })
    activeServer = await createValedictorianHttpServer({
      client: activeClient,
      host: '127.0.0.1',
      port: 0,
    })
    const workspace = createHttpValedictorianClient({ baseUrl: activeServer.url })
      .forWorkspace(WORKSPACE_ID)

    await workspace.connectors.create(jobrightCreateInput('jobright-active-a'))
    await expect(workspace.connectors.create(jobrightCreateInput('jobright-active-b')))
      .rejects.toMatchObject({ status: 409, body: { code: 'already_configured' } })
    await expect(workspace.connectors.list()).resolves.toMatchObject({
      items: [{ id: 'jobright-active-a' }],
    })
  })
})

async function startFixtureServer() {
  activePgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jobright-readd-'))
  const connector = createJobrightFixtureConnector()
  activeClient = await createLocalValedictorianClient({
    connectorRegistry: createStaticConnectorRegistry([connector]),
    now: () => new Date(CLOCK),
    secretCodec: {
      decrypt: (value) => value.replace(/^enc:/, ''),
      encrypt: (value) => `enc:${value}`,
    },
    seedDataMode: 'none',
    pgliteDataPath: activePgliteDataPath,
    workspaceId: WORKSPACE_ID,
  })
  const client = activeClient
  activeServer = await createValedictorianHttpServer({
    client,
    host: '127.0.0.1',
    port: 0,
  })
  ;(window as Window & { valedictorianHttp?: unknown }).valedictorianHttp = {
    apiBaseUrl: activeServer.url,
    getBackendState: () => ({ origin: activeServer!.url, status: 'available' }),
    onBackendStateChanged: () => () => undefined,
    workspaceId: WORKSPACE_ID,
  }
  ;(window as Window & { connectors?: unknown }).connectors = {
    status: {
      reconnect: (input: { connectorInstanceId: string }) =>
        client.connectors.status.reconnect(input),
    },
  }
  return { client }
}

function createJobrightFixtureConnector(): AppJobConnector {
  return {
    definition: {
      id: JOBRIGHT_CONNECTOR_ID,
      version: JOBRIGHT_CONNECTOR_VERSION,
      capabilities: { supportsFiltering: false },
      auth: {
        modes: ['username_password'],
        requirements: [{
          id: 'jobright',
          label: 'Jobright username and password',
          mode: 'username_password',
          required: true,
        }],
      },
    },
    async validateAuth(input, runtime) {
      const result = await runtime.auth.refresh({
        id: 'jobright',
        mode: 'username_password',
        executionScopeId: input.executionScopeId,
      }, async () => ({ status: 'ready', sessionId: 'readd-session' }))
      return result.status === 'ready'
        ? { status: 'ready', reason: 'jobright_auth_ready' }
        : { status: 'failed', reason: 'auth_validation_failed' }
    },
    async refresh(input) {
      return {
        operationOutcome: null,
        status: 'completed',
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'caught_up',
            boundary: { earliestDate: input.coverage.start.slice(0, 10) },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'caught_up' },
        },
        observations: [],
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'jobright-readd@1' },
        coverage: input.coverage,
        stats: { observations: 0 },
        warnings: [],
      }
    },
  }
}

function openConnectorsOverview() {
  const appNavigation = within(
    screen.getByRole('complementary', { name: 'Application navigation' }),
  ).getByRole('navigation', { name: 'Application views' })
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Connectors' }))
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Overview' }))
  return appNavigation
}

function jobrightCreateInput(id: string) {
  return {
    id,
    connectorId: JOBRIGHT_CONNECTOR_ID,
    connectorVersion: JOBRIGHT_CONNECTOR_VERSION,
    displayName: 'Jobright internslist',
    enabled: true,
    auth: [{ id: 'jobright', label: 'Jobright credentials', mode: 'username_password' as const }],
    config: {},
    filters: {},
  }
}
