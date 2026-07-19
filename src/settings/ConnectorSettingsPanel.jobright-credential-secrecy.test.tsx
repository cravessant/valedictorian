import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createConnectorsApi,
  createProfileApi,
} from '../App.test-helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import type { ConnectorSettingsUiApi } from './connector-settings.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

function createUnavailableScheduleApi(): ConnectorScheduleUiApi {
  return {
    getCapabilities: vi.fn(async () => ({
      connectorScheduling: { available: false as const },
    })),
    getSchedule: vi.fn(async () => null),
    upsertSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
    pauseSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
    resumeSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
    deleteSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
  }
}

const configuredJobrightInstance = {
  id: 'jobright-default',
  connectorId: 'jobright.resolver',
  connectorVersion: '0.11.0',
  displayName: 'Jobright internslist',
  enabled: true,
  auth: [{
    id: 'jobright',
    mode: 'username_password' as const,
    label: 'Jobright username and password',
    configured: true,
  }],
  config: {},
  filters: {},
  earliestBackfillDate: '2026-07-02',
  createdAt: '2026-07-09T15:00:00.000Z',
  updatedAt: '2026-07-09T15:00:00.000Z',
}

async function openConnectorDetails(displayName = 'Jobright internslist') {
  const existing = screen.queryByRole('dialog', { name: `${displayName} details` })
  if (existing) return existing
  fireEvent.click(await screen.findByRole('button', {
    name: `View ${displayName} details`,
  }))
  return screen.findByRole('dialog', { name: `${displayName} details` })
}

async function openConnectorEditor(displayName = 'Jobright internslist') {
  const dialog = await openConnectorDetails(displayName)
  const edit = within(dialog).queryByRole('button', { name: 'Edit connector' })
  if (edit) fireEvent.click(edit)
  await within(dialog).findByRole('button', { name: 'Cancel editing' })
  return dialog
}

function renderPanel(
  connectorsApi: ConnectorSettingsUiApi,
  profileApi = createProfileApi(),
) {
  return render(
    <ConnectorSettingsPanel
      connectorsApi={connectorsApi}
      connectorScheduleApi={createUnavailableScheduleApi()}
      onRunSettled={vi.fn()}
      profileApi={profileApi}
      workspaceId="workspace-1"
    />,
  )
}

describe('ConnectorSettingsPanel Jobright credential secrecy', () => {
  it('cancels credential editing without secret or validation calls', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()

    renderPanel(connectorsApi, profileApi)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await openConnectorEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Credential update cancelled.')).toBeInTheDocument()
    expect(screen.queryByText('Auth cancelled')).not.toBeInTheDocument()
    expect(screen.getByText('Auth required')).toBeInTheDocument()
    expect(profileApi.secrets.upsert).not.toHaveBeenCalled()
    expect(connectorsApi.update).not.toHaveBeenCalled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('preserves verified auth status when credential editing is opened and cancelled', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [configuredJobrightInstance],
    })
    vi.mocked(connectorsApi.status.reconnect).mockResolvedValue({
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

    renderPanel(connectorsApi, profileApi)

    await openConnectorEditor()
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Update credentials' }))
    expect(await screen.findByLabelText('Jobright email')).toBeInTheDocument()
    expect(screen.getByText('Auth verified')).toBeInTheDocument()
    expect(screen.queryByText('Auth cancelled')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Jobright email'), {
      target: { value: 'other@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Credential update cancelled.')).toBeInTheDocument()
    expect(screen.getByText('Auth verified')).toBeInTheDocument()
    expect(screen.queryByText('Auth cancelled')).not.toBeInTheDocument()
    expect(profileApi.secrets.upsert).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    expect(screen.queryByText('Credential update cancelled.')).not.toBeInTheDocument()
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
  })

  it('keeps invalid empty credentials in the editor without secret calls', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()

    renderPanel(connectorsApi, profileApi)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await openConnectorEditor()
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

    renderPanel(connectorsApi, profileApi)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await openConnectorEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'secret-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText(
      'Credentials were not saved because secure storage is unavailable. Enable platform encryption, then try again.',
    )).toBeInTheDocument()
    expect(screen.queryByText('Jobright credential setup incomplete')).not.toBeInTheDocument()
    expect(screen.getAllByText(
      'Credentials were not saved because secure storage is unavailable. Enable platform encryption, then try again.',
    )).toHaveLength(1)
    expect(screen.queryByDisplayValue('demo@example.com')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('secret-password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Jobright email')).not.toBeInTheDocument()
    expect(connectorsApi.update).not.toHaveBeenCalled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('reports that credentials were saved when validation could not start', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.status.reconnect).mockRejectedValueOnce(
      new Error('Connector status actions are unavailable for demo@example.com secret-password.'),
    )

    renderPanel(connectorsApi, profileApi)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await openConnectorEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'secret-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText(
      'Credentials were saved and linked, but validation could not start because the connector service is unavailable. Restart the app, then select Validate.',
    )).toBeInTheDocument()
    expect(screen.queryByText('Jobright credential setup incomplete')).not.toBeInTheDocument()
    expect(profileApi.secrets.upsert).toHaveBeenCalledOnce()
    expect(connectorsApi.update).toHaveBeenCalledOnce()
    expect(screen.queryByText('demo@example.com')).not.toBeInTheDocument()
    expect(screen.queryByText('secret-password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Jobright email')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('auto-validates configured Jobright credentials on settings load', async () => {
    const connectorsApi = createConnectorsApi()
    let resolveReconnect: ((value: Awaited<ReturnType<typeof connectorsApi.status.reconnect>>) => void) | undefined
    const pendingReconnect = new Promise<Awaited<ReturnType<typeof connectorsApi.status.reconnect>>>((resolve) => {
      resolveReconnect = resolve
    })
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [configuredJobrightInstance],
    })
    vi.mocked(connectorsApi.status.reconnect).mockReturnValueOnce(pendingReconnect)

    renderPanel(connectorsApi)

    await openConnectorDetails()

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
      items: [configuredJobrightInstance],
    })
    vi.mocked(connectorsApi.status.reconnect)
      .mockReturnValueOnce(olderReconnect)
      .mockReturnValueOnce(newerReconnect)

    renderPanel(connectorsApi)

    await openConnectorEditor()
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
      items: [configuredJobrightInstance],
    })
    vi.mocked(connectorsApi.status.reconnect).mockReturnValueOnce(autoValidate)

    renderPanel(connectorsApi)

    await openConnectorEditor()
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

  it('shows sanitized secure-storage failure when revalidation returns it', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [configuredJobrightInstance],
    })
    vi.mocked(connectorsApi.status.reconnect).mockResolvedValue({
      action: 'reconnect',
      connectorInstanceId: 'jobright-default',
      grants: [{
        id: 'jobright',
        mode: 'username_password',
        reason: 'secure_storage_unavailable',
        status: 'action_required',
      }],
      message: 'Secure storage is unavailable. Enable platform encryption, then try again.',
      reason: 'secure_storage_unavailable',
      status: 'failed',
    })

    renderPanel(connectorsApi)
    await openConnectorEditor()

    expect(await screen.findByText(
      'Secure storage is unavailable. Enable platform encryption, then try again.',
    )).toBeInTheDocument()
    expect(screen.getByText('Auth failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(screen.queryByText(/sensitive/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Update credentials' }))
    expect(screen.getByText('Auth failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Credential update cancelled.')).toBeInTheDocument()
    expect(screen.getByText('Auth failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('keeps failed validation non-ready and clears credential inputs', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.status.reconnect).mockResolvedValue({
      action: 'reconnect',
      connectorInstanceId: 'jobright-default',
      grants: [
        {
          id: 'jobright',
          mode: 'username_password',
          reason: 'jobright_login_rejected',
          status: 'action_required',
        },
      ],
      message: 'Connector credentials were rejected. Update email and password, then validate again.',
      reason: 'jobright_login_rejected',
      status: 'action_required',
    })

    renderPanel(connectorsApi, profileApi)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await openConnectorEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'wrong-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText(
      'Connector credentials were rejected. Update email and password, then validate again.',
    )).toBeInTheDocument()
    expect(screen.getByText('Auth required')).toBeInTheDocument()
    expect(screen.queryByText('Auth verified')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('demo@example.com')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('wrong-password')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })
})
