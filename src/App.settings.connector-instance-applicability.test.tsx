import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  openSettingsPage
} from './App.test-helpers'
import type { ConnectorsPreloadApi } from './ipc/connectors.preload'
import type { ProfilePreloadApi } from './ipc/profile.preload'
import { createStaticConnectorRegistry } from './modules/connectors/connector.registry'
import type { AppJobConnector } from './modules/connectors/connector.runner'
import { createLocalValedictorianClient } from './runtime/local-valedictorian-client'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
  delete (window as Window & { profile?: unknown }).profile
  delete (window as Window & { workspace?: unknown }).workspace
  delete (window as Window & { valedictorianWindowChrome?: unknown }).valedictorianWindowChrome
})

function openConnectorsOverview() {
  const appNavigation = within(
    screen.getByRole('complementary', { name: 'Application navigation' }),
  ).getByRole('navigation', { name: 'Application views' })
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Connectors' }))
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Overview' }))
  return appNavigation
}

describe('connector instance applicability', () => {
  it('operates Jobright from the main Connectors page with responsive write-only controls', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()

    expect(await screen.findByRole('heading', { name: 'Operate connectors' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add Jobright connector' }))

    expect(await screen.findByText('jobright.resolver')).toBeInTheDocument()
    expect(screen.getByTestId('connector-auth-actions-jobright-default')).toHaveClass('flex-wrap')
    const runActions = screen.getByTestId('connector-run-actions-jobright-default')
    expect(runActions).toHaveClass('lg:grid-cols-2')
    expect(runActions).not.toHaveClass('md:grid-cols-[minmax(16rem,1fr)_12rem_auto_auto]')

    fireEvent.click(screen.getByRole('button', { name: 'Add credentials' }))
    const credentialForm = screen.getByTestId('connector-credential-form-jobright-default')
    expect(credentialForm).toHaveClass('lg:grid-cols-2')
    expect(credentialForm).not.toHaveClass(
      'md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto_auto]',
    )
    fireEvent.change(screen.getByLabelText('Jobright email'), {
      target: { value: 'main-page@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'main-page-fixture-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('main-page@example.test')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('main-page-fixture-password')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    await waitFor(() => {
      expect(connectorsApi.runs.trigger).toHaveBeenCalledWith(expect.objectContaining({
        connectorInstanceId: 'jobright-default',
        mode: 'manual',
        reason: 'settings_manual_refresh',
      }))
    })
    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View connector runs' }))

    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()
    expect(
      screen.queryByRole('complementary', { name: 'Settings navigation' }),
    ).not.toBeInTheDocument()
  })

  it('creates, configures, and runs the current Jobright connector through Settings', async () => {
    const sqlitePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'settings-jobright-')), 'valedictorian.sqlite')
    const connector: AppJobConnector = {
      definition: {
        id: 'jobright.resolver',
        version: '0.8.0',
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
      async validateAuth() {
        return { status: 'ready', reason: 'jobright_auth_ready' }
      },
      async refresh(input) {
        return {
          observations: [],
          nextCheckpoint: { checkpoint: {}, schemaVersion: 'jobright-test@1' },
          coverage: input.coverage,
          stats: { observations: 0 },
          warnings: [],
        }
      },
    }
    const client = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      secretCodec: {
        decrypt: (value) => value.replace(/^enc:/, ''),
        encrypt: (value) => `enc:${value}`,
      },
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-settings-jobright',
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([]))}
        connectorsApi={client.connectors as ConnectorsPreloadApi}
        profileApi={client.profile as ProfilePreloadApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(screen.getByLabelText('Jobright email'), {
      target: { value: 'settings@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'settings-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()
    await expect(client.connectors.list()).resolves.toMatchObject({
      items: [expect.objectContaining({ connectorVersion: '0.8.0' })],
    })
  })

  it('adds a Jobright connector instance from settings with default auth and filters', async () => {
    const connectorsApi = createConnectorsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))

    await waitFor(() => {
      expect(connectorsApi.create).toHaveBeenCalledWith({
        auth: [
          {
            id: 'jobright',
            label: 'Jobright username and password',
            mode: 'username_password',
          },
        ],
        config: {},
        connectorId: 'jobright.resolver',
        connectorVersion: '0.8.0',
        displayName: 'Jobright internslist',
        enabled: true,
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        id: 'jobright-default',
      })
    })
    expect(await screen.findByText('jobright.resolver')).toBeInTheDocument()
    expect(screen.getByText('Auth required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add credentials' })).toBeInTheDocument()
    expect(screen.getByText('1 connector instance configured.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(screen.queryByText('Credentials stored')).not.toBeInTheDocument()
    expect(screen.queryByText(/login window/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Login to Jobright' })).not.toBeInTheDocument()
    expect(screen.queryByText('Auth verified')).not.toBeInTheDocument()
  })

  it('does not auto-validate non-Jobright configured connectors on settings load', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'fixture-default',
        connectorId: 'fixture.jobs',
        connectorVersion: '0.0.0-fixture',
        displayName: 'Fixture jobs',
        enabled: true,
        auth: [{
          id: 'fixture-api',
          mode: 'api_key',
          label: 'Fixture API key',
          configured: true,
        }],
        config: {},
        filters: {},
        earliestBackfillDate: '2026-07-02',
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    expect(await screen.findByText('fixture.jobs')).toBeInTheDocument()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()
    expect(screen.queryByText('Checking auth...')).not.toBeInTheDocument()
  })

  it('keeps Jobright target and advanced settings off non-Jobright connector cards', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'fixture-default',
        connectorId: 'fixture.jobs',
        connectorVersion: '0.0.0-fixture',
        displayName: 'Fixture jobs',
        enabled: true,
        auth: [{
          id: 'fixture-api',
          mode: 'api_key',
          label: 'Fixture API key',
          configured: true,
        }],
        config: {},
        filters: {},
        earliestBackfillDate: '2026-07-02',
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    const fixtureCard = await screen.findByTestId('connector-instance-card-fixture-default')
    expect(within(fixtureCard).getByText('Fixture jobs')).toBeInTheDocument()
    expect(within(fixtureCard).getByText('fixture.jobs')).toBeInTheDocument()
    expect(within(fixtureCard).queryByLabelText('Useful results target')).not.toBeInTheDocument()
    expect(within(fixtureCard).queryByText('Advanced connector limits')).not.toBeInTheDocument()
    expect(within(fixtureCard).queryByRole('button', { name: 'Save Jobright settings' }))
      .not.toBeInTheDocument()
    expect(within(fixtureCard).queryByRole('button', { name: 'Run Jobright now' }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Jobright connector' })).toBeInTheDocument()
  })

  it('treats legacy Jobright browser_session auth as unconfigured API credentials', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    await connectorsApi.create({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.3.0',
      displayName: 'Jobright public jobs',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'browser_session',
        label: 'Jobright browser session',
        sessionKey: 'legacy-jobright-session',
      }],
      config: {},
      filters: {
        maxResolutionCount: 10,
        roleTerms: ['intern'],
      },
    })
    vi.mocked(connectorsApi.create).mockClear()
    vi.mocked(connectorsApi.update).mockClear()
    vi.mocked(connectorsApi.status.reconnect).mockClear()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    expect(await screen.findByText('jobright.resolver')).toBeInTheDocument()
    expect(screen.getByText('Auth required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add credentials' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validate' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: ' pass with spaces ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    await waitFor(() => {
      expect(profileApi.secrets.upsert).toHaveBeenCalled()
      expect(connectorsApi.update).toHaveBeenCalledWith({
        auth: [
          {
            id: 'jobright',
            label: 'Jobright username and password',
            mode: 'username_password',
            secretKey: 'connector_jobright_credentials_jobright_default',
          },
        ],
        connectorInstanceId: 'jobright-default',
      })
      expect(connectorsApi.status.reconnect).toHaveBeenCalledWith({
        connectorInstanceId: 'jobright-default',
      })
    })
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
  })

})
