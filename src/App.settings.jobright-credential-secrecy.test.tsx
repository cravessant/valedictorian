import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  lastCreatedConnectorInstanceId,
  openSettingsPage
} from './App.test-helpers'
import { jobrightSecretKeyForInstance } from './settings/connector-settings.helpers'

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

describe('Jobright credential secrecy', () => {
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
    await waitFor(() => expect(connectorsApi.create).toHaveBeenCalled())
    const instanceId = lastCreatedConnectorInstanceId(connectorsApi)
    const secretKey = jobrightSecretKeyForInstance(instanceId)

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
        key: secretKey,
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
            secretKey,
          },
        ],
        connectorInstanceId: instanceId,
      })
      expect(connectorsApi.status.reconnect).toHaveBeenCalledWith({
        connectorInstanceId: instanceId,
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

    const saveAndValidate = screen.getByRole('button', { name: 'Save and validate' })
    expect(saveAndValidate).toBeDisabled()
    fireEvent.click(saveAndValidate)
    expect(screen.getByText(
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
        connectorVersion: '0.11.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {},
        earliestBackfillDate: '2026-07-02',
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
        connectorVersion: '0.11.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {},
        earliestBackfillDate: '2026-07-02',
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
        connectorVersion: '0.11.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {},
        earliestBackfillDate: '2026-07-02',
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
