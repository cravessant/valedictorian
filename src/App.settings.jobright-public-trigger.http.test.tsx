import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createListResult,
  openConnectorEditor,
  createSettingsApi,
} from './App.test-helpers'
import {
  createDefaultLocalConnectorRegistry,
  createStaticConnectorRegistry,
} from './modules/connectors/connector.registry'
import type { AppJobConnector } from './modules/connectors/connector.runner'
import { JOBRIGHT_CONNECTOR_ID, JOBRIGHT_CONNECTOR_VERSION } from './modules/connectors/jobright.constants'
import {
  closeTestLocalValedictorianClient,
  createTestLocalValedictorianClient as createLocalValedictorianClient,
} from './runtime/local-valedictorian-client.test-harness'
import {
  createValedictorianHttpServer,
  type StartedValedictorianHttpServer,
} from './server/local-server'

const CLOCK = '2026-07-13T18:00:00.000Z'
const WORKSPACE_ID = 'workspace-public-trigger'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
  delete (window as Window & { connectors?: unknown }).connectors
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
  delete (window as Window & { profile?: unknown }).profile
  delete (window as Window & { workspace?: unknown }).workspace
  delete (window as Window & { valedictorianWindowChrome?: unknown }).valedictorianWindowChrome
  try {
    await activeServer?.close()
  } finally {
    activeServer = null
    if (activeClient) await closeTestLocalValedictorianClient(activeClient)
    activeClient = null
  }
})

let activeServer: StartedValedictorianHttpServer | null = null
let activeClient: Awaited<ReturnType<typeof createLocalValedictorianClient>> | null = null

describe('Jobright public trigger through default HTTP client', () => {
  it('persists a connector run when Run Jobright now uses the real Sparxie HTTP client', async () => {
    const { client } = await startFixtureServer()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    await openConnectorEditor()

    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(screen.getByLabelText('Jobright email'), {
      target: { value: 'public-trigger@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'public-trigger-fixture-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
    const runButton = screen.getByRole('button', { name: 'Run Jobright now' })
    await waitFor(() => expect(runButton).toBeEnabled())
    fireEvent.click(runButton)

    expect(await screen.findByText('Latest synchronization: Caught up')).toBeInTheDocument()
    expect(screen.queryByText('Jobright run could not be completed.')).not.toBeInTheDocument()
    expect(screen.queryByText('Latest synchronization: Starting')).not.toBeInTheDocument()

    const listed = await client.connectors.list()
    expect(listed.items).toHaveLength(1)
    const connectorInstanceId = listed.items[0]!.id
    await expect(client.connectors.runs.list({
      connectorInstanceId,
    })).resolves.toMatchObject({
      total: 1,
      items: [{
        connectorInstanceId,
        mode: 'manual',
        status: 'completed',
        coverage: {
          end: CLOCK,
        },
      }],
    })
  })
})

async function startFixtureServer() {
  const connector = createJobrightFixtureConnector()
  const client = await createLocalValedictorianClient({
    connectorRegistry: createStaticConnectorRegistry([connector]),
    now: () => new Date(CLOCK),
    secretCodec: {
      decrypt: (value) => value.replace(/^enc:/, ''),
      encrypt: (value) => `enc:${value}`,
    },
    seedDataMode: 'none',
    workspaceId: WORKSPACE_ID,
  })
  activeClient = client
  await client.connectors.create({
    id: 'jobright-default',
    connectorId: JOBRIGHT_CONNECTOR_ID,
    connectorVersion: JOBRIGHT_CONNECTOR_VERSION,
    displayName: 'Jobright internslist',
    enabled: true,
    auth: [{
      id: 'jobright',
      label: 'Jobright username and password',
      mode: 'username_password',
    }],
    config: {},
    filters: {
      jobTaxonomyList: [{
        taxonomyId: 'software-engineering',
        title: 'Software Engineering',
      }],
    },
  })
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
  // Reconnect remains IPC-only in production composition; expose the local status surface.
  ;(window as Window & { connectors?: unknown }).connectors = {
    status: {
      reconnect: (input: { connectorInstanceId: string }) =>
        client.connectors.status.reconnect(input),
    },
  }
  return { client }
}

function createJobrightFixtureConnector(): AppJobConnector {
  const released = createDefaultLocalConnectorRegistry().get(JOBRIGHT_CONNECTOR_ID)!
  const { dynamicOptions: _dynamicOptions, ...releasedDefinition } = released.definition
  void _dynamicOptions
  return {
    definition: releasedDefinition,
    async validateAuth(input, runtime) {
      const result = await runtime.auth.refresh({
        id: 'jobright',
        mode: 'username_password',
        executionScopeId: input.executionScopeId,
      }, async () => ({ status: 'ready', sessionId: 'public-trigger-session' }))
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
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'jobright-public-trigger@1' },
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
