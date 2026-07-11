import {
  act,
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

function mockNarrowViewport() {
  const mediaQueryList = {
    matches: true,
    media: '(max-width: 767px)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList

  vi.stubGlobal('matchMedia', vi.fn(() => mediaQueryList))
}

function openConnectorsOverview() {
  const appNavigation = within(
    screen.getByRole('complementary', { name: 'Application navigation' }),
  ).getByRole('navigation', { name: 'Application views' })
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Connectors' }))
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Overview' }))
  return appNavigation
}

describe('App settings and chrome', () => {
  it('opens the application navigation as a narrow drawer without stacking it above content', async () => {
    mockNarrowViewport()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    const layout = screen.getByTestId('app-layout')

    expect(layout).toHaveClass('grid-cols-1', 'grid-rows-1')
    expect(layout).not.toHaveClass('grid-rows-[auto_1fr]')
    expect(screen.getByTestId('app-shell')).toHaveAttribute(
      'data-sidebar-state',
      'drawer-closed',
    )
    expect(
      screen.queryByRole('complementary', { name: 'Application navigation' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))

    const sidebar = screen.getByRole('complementary', { name: 'Application navigation' })
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'drawer-open')
    expect(sidebar).toHaveClass(
      'absolute',
      'left-0',
      'top-0',
      'z-40',
      'h-full',
      'w-[280px]',
      'max-w-[85vw]',
    )
    expect(screen.getByRole('button', { name: 'Close sidebar drawer' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar drawer' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute(
      'data-sidebar-state',
      'drawer-closed',
    )
    expect(
      screen.queryByRole('complementary', { name: 'Application navigation' }),
    ).not.toBeInTheDocument()
  })

  it('closes the narrow application drawer after changing views', async () => {
    mockNarrowViewport()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'action-queue')
    expect(screen.getByTestId('app-shell')).toHaveAttribute(
      'data-sidebar-state',
      'drawer-closed',
    )
    expect(
      screen.queryByRole('complementary', { name: 'Application navigation' }),
    ).not.toBeInTheDocument()
    expect(within(screen.getByRole('banner', { name: 'App chrome' })).getByText('Action Queue')).toBeInTheDocument()
  })

  it('opens a compact settings popover for important runtime controls', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()

    const settingsTrigger = screen.getByRole('button', { name: 'Settings' })

    expect(settingsTrigger).not.toHaveClass('border')
    expect(settingsTrigger).not.toHaveClass('border-border')
    expect(settingsTrigger).not.toHaveClass('bg-card/95')
    expect(settingsTrigger).not.toHaveClass('shadow-xl')
    expect(settingsTrigger).toHaveClass('hover:bg-accent', 'hover:text-accent-foreground')

    fireEvent.click(settingsTrigger)

    const dialog = screen.getByRole('dialog', { name: 'Settings' })

    expect(within(dialog).getByText('Valedictorian')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Use remote backend')).not.toBeChecked()
    expect(within(dialog).getByLabelText('Local API sharing')).not.toBeChecked()
    expect(within(dialog).queryByLabelText('Show advanced filters')).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Remote API URL')).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Open settings' })).toBeInTheDocument()
    expect(within(dialog).getByText('Backend changes apply after restart.')).toBeInTheDocument()
  })

  it('toggles settings from the compact popover', async () => {
    const settingsApi = createSettingsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    const dialog = screen.getByRole('dialog', { name: 'Settings' })

    fireEvent.click(within(dialog).getByLabelText('Local API sharing'))

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({ runtimeMode: 'local-shared' })
    })
    expect(within(dialog).getByText('local-shared')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByLabelText('Use remote backend'))

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({ runtimeMode: 'remote' })
    })
    expect(within(dialog).getByLabelText('Remote API URL')).not.toBeDisabled()
    expect(within(dialog).getByText('remote')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Local API sharing')).not.toBeChecked()

    fireEvent.change(within(dialog).getByLabelText('Remote API URL'), {
      target: { value: 'https://valedictorian.test' },
    })

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({
        remoteApiUrl: 'https://valedictorian.test',
      })
    })
    expect(within(dialog).getByDisplayValue('https://valedictorian.test')).toBeInTheDocument()

    expect(within(dialog).queryByLabelText('Show advanced filters')).not.toBeInTheDocument()
  })

  it('closes the compact settings popover', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('opens the full settings page from the compact popover and returns to the app', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to app' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Applications' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))

    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
  })

  it('opens the full settings page from the native Settings menu event', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent(window, new Event('valedictorian:open-settings'))

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'settings')
    })
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('uses the same app chrome shell for the settings view', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    const chrome = screen.getByRole('banner', { name: 'App chrome' })

    expect(within(chrome).getByText('Settings')).toBeInTheDocument()
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'settings')
    expect(screen.getByRole('complementary', { name: 'Settings navigation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to app' })).toBeInTheDocument()
  })

  it('renders grouped settings navigation and filters the sidebar search', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })

    expect(within(navigation).getByText('Personal')).toBeInTheDocument()
    expect(within(navigation).getByText('Integrations')).toBeInTheDocument()
    expect(within(navigation).getByText('Automation')).toBeInTheDocument()
    expect(within(navigation).getByText('Advanced')).toBeInTheDocument()

    fireEvent.change(within(navigation).getByLabelText('Search settings'), {
      target: { value: 'agent' },
    })

    expect(within(navigation).queryByRole('button', { name: 'General' })).not.toBeInTheDocument()
  })

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
        version: '0.7.0',
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
      items: [expect.objectContaining({ connectorVersion: '0.7.0' })],
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
        connectorVersion: '0.7.0',
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

  it('saves and validates Jobright credentials without revealing saved secrets', async () => {
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

    await openSettingsPage()

    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: ' demo@example.com ' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: ' pass with spaces ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    await waitFor(() => {
      expect(profileApi.secrets.upsert).toHaveBeenCalledWith({
        key: 'connector_jobright_credentials_jobright_default',
        kind: 'password',
        label: 'Jobright username and password',
        value: JSON.stringify({
          username: 'demo@example.com',
          password: ' pass with spaces ',
        }),
      })
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
    expect(screen.queryByDisplayValue('demo@example.com')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(' pass with spaces ')).not.toBeInTheDocument()
    expect(screen.queryByText('demo@example.com')).not.toBeInTheDocument()
    expect(screen.queryByText(' pass with spaces ')).not.toBeInTheDocument()
    expect(Object.keys(profileApi.secrets)).not.toContain('reveal')
  })

  it('cancels credential editing without secret or validation calls', async () => {
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

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Credential update cancelled.')).toBeInTheDocument()
    expect(screen.getByText('Auth cancelled')).toBeInTheDocument()
    expect(profileApi.secrets.upsert).not.toHaveBeenCalled()
    expect(connectorsApi.update).not.toHaveBeenCalled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('keeps invalid empty credentials in the editor without secret calls', async () => {
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

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText(
      'Enter a Jobright email and password before validating.',
    )).toBeInTheDocument()
    expect(screen.getByLabelText('Jobright email')).toBeInTheDocument()
    expect(screen.getByLabelText('Jobright password')).toBeInTheDocument()
    expect(profileApi.secrets.upsert).not.toHaveBeenCalled()
    expect(connectorsApi.update).not.toHaveBeenCalled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('surfaces sanitized secure-storage upsert failures without secret content', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const secureStorageError = new Error('Secure storage is unavailable') as Error & { code: string }
    secureStorageError.code = 'secure_storage_unavailable'
    vi.mocked(profileApi.secrets.upsert).mockRejectedValueOnce(secureStorageError)

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
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'secret-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText(
      'Secure storage is unavailable. Enable platform encryption, then try again.',
    )).toBeInTheDocument()
    expect(screen.queryByDisplayValue('demo@example.com')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('secret-password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Jobright email')).not.toBeInTheDocument()
    expect(connectorsApi.update).not.toHaveBeenCalled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('auto-validates configured Jobright credentials on settings load', async () => {
    const connectorsApi = createConnectorsApi()
    let resolveReconnect: ((value: Awaited<ReturnType<typeof connectorsApi.status.reconnect>>) => void) | undefined
    const pendingReconnect = new Promise<Awaited<ReturnType<typeof connectorsApi.status.reconnect>>>((resolve) => {
      resolveReconnect = resolve
    })
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.7.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.status.reconnect).mockReturnValueOnce(pendingReconnect)

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

    expect(await screen.findByText('Checking auth...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    await act(async () => {
      resolveReconnect?.({
        action: 'reconnect',
        connectorInstanceId: 'jobright-default',
        grants: [{
          id: 'jobright',
          mode: 'username_password',
          status: 'ready',
        }],
        message: 'Connector credentials are verified and ready.',
        reason: 'jobright_auth_ready',
        status: 'ready',
      })
    })

    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
    expect(connectorsApi.status.reconnect).toHaveBeenCalledWith({
      connectorInstanceId: 'jobright-default',
    })
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

  it('ignores stale ready validation after a newer failed validation settles', async () => {
    const connectorsApi = createConnectorsApi()
    let resolveOlder: ((value: Awaited<ReturnType<typeof connectorsApi.status.reconnect>>) => void) | undefined
    let resolveNewer: ((value: Awaited<ReturnType<typeof connectorsApi.status.reconnect>>) => void) | undefined
    const olderReconnect = new Promise<Awaited<ReturnType<typeof connectorsApi.status.reconnect>>>((resolve) => {
      resolveOlder = resolve
    })
    const newerReconnect = new Promise<Awaited<ReturnType<typeof connectorsApi.status.reconnect>>>((resolve) => {
      resolveNewer = resolve
    })
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.7.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.status.reconnect)
      .mockReturnValueOnce(olderReconnect)
      .mockReturnValueOnce(newerReconnect)

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
    expect(await screen.findByText('Checking auth...')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Validate' }))
    expect(await screen.findByText('Checking auth...')).toBeInTheDocument()

    await act(async () => {
      resolveNewer?.({
        action: 'reconnect',
        connectorInstanceId: 'jobright-default',
        grants: [{
          id: 'jobright',
          mode: 'username_password',
          reason: 'jobright_login_rejected',
          status: 'action_required',
        }],
        message: 'Connector credentials were rejected. Update email and password, then validate again.',
        reason: 'jobright_login_rejected',
        status: 'action_required',
      })
    })

    expect(await screen.findByText(
      'Connector credentials were rejected. Update email and password, then validate again.',
    )).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    await act(async () => {
      resolveOlder?.({
        action: 'reconnect',
        connectorInstanceId: 'jobright-default',
        grants: [{
          id: 'jobright',
          mode: 'username_password',
          status: 'ready',
        }],
        message: 'Connector credentials are verified and ready.',
        reason: 'jobright_auth_ready',
        status: 'ready',
      })
    })

    expect(screen.queryByText('Auth verified')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(screen.getByText(
      'Connector credentials were rejected. Update email and password, then validate again.',
    )).toBeInTheDocument()
  })

  it('ignores stale auto-validation after credential editing begins', async () => {
    const connectorsApi = createConnectorsApi()
    let resolveAutoValidate: ((value: Awaited<ReturnType<typeof connectorsApi.status.reconnect>>) => void) | undefined
    const autoValidate = new Promise<Awaited<ReturnType<typeof connectorsApi.status.reconnect>>>((resolve) => {
      resolveAutoValidate = resolve
    })
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.7.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.status.reconnect).mockReturnValueOnce(autoValidate)

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
    expect(await screen.findByText('Checking auth...')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Update credentials' }))
    expect(await screen.findByLabelText('Jobright email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    await act(async () => {
      resolveAutoValidate?.({
        action: 'reconnect',
        connectorInstanceId: 'jobright-default',
        grants: [{
          id: 'jobright',
          mode: 'username_password',
          status: 'ready',
        }],
        message: 'Connector credentials are verified and ready.',
        reason: 'jobright_auth_ready',
        status: 'ready',
      })
    })

    expect(screen.queryByText('Auth verified')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Jobright email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

})
