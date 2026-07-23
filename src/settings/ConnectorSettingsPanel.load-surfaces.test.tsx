import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ValedictorianHttpError,
  ValedictorianProtocolError,
  ValedictorianTransportError,
  valedictorianFailureKindMessages,
} from '@sparxie/sdk'
import {
  createConnectorsApi,
  createConnectorsApiWithJobrightDescriptor,
  createProfileApi,
} from '../App.test-helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'
import { ApiTokenSettingsControls } from './ApiTokenSettingsControls'

afterEach(cleanup)

function createScheduleApi(overrides: Partial<ConnectorScheduleUiApi> = {}): ConnectorScheduleUiApi {
  return {
    getCapabilities: vi.fn(async () => ({
      connectorScheduling: {
        available: true as const,
        minimumIntervalMinutes: 15,
        supportedCadences: ['interval', 'daily', 'weekly'] as const,
        supportedTimezones: ['UTC'],
      },
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
    ...overrides,
  }
}

describe('ConnectorSettingsPanel list LoadFailureView surfaces', () => {
  it('settles an initial AbortError to empty non-error UI without a truthy load failure', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError'),
    )

    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    expect(await screen.findByLabelText('Empty connector instances')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading connector instances...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('renders AuthenticationFailure with Retry for typed connector list auth failures', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list)
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'authentication',
        message: 'connector list auth dump /secret',
        status: 401,
      }))
      .mockResolvedValueOnce({ items: [] })

    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'authentication-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.authentication)
    expect(alert).not.toHaveTextContent('/secret')

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(connectorsApi.list).toHaveBeenCalledTimes(2))
  })

  it('renders GlobalFailureAlert for typed connector list transport failures', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockRejectedValueOnce(new ValedictorianTransportError({
      cause: new Error('ECONNREFUSED /var/connectors/secret'),
    }))

    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'global-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.unavailable)
    expect(alert).not.toHaveTextContent('ECONNREFUSED')
  })

  it('renders scoped LoadFailureView for generic connector list failures', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'list dump /secret' }))

    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).toHaveTextContent('Connector state could not be loaded.')
    expect(alert).not.toHaveTextContent('/secret')
  })

  it('keeps previously loaded instances visible with LoadFailureView when same-workspace refresh fails', async () => {
    const connectorsApi = createConnectorsApiWithJobrightDescriptor()
    await connectorsApi.create({
      id: 'jobright-stale',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.15.0',
      displayName: 'Stale Jobright Instance',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        configured: true,
      }],
      config: {},
      filters: {},
    })

    const { rerender } = render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    expect(await screen.findByText('Stale Jobright Instance')).toBeInTheDocument()

    const failingApi = createConnectorsApiWithJobrightDescriptor()
    vi.mocked(failingApi.list).mockRejectedValue(new ValedictorianProtocolError({ message: 'refresh dump /secret' }))
    rerender(
      <ConnectorSettingsPanel
        connectorsApi={failingApi}
        connectorScheduleApi={createScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).not.toHaveTextContent('/secret')
    expect(screen.getByText('Stale Jobright Instance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText(/Connector actions are unavailable/i)).not.toBeInTheDocument()
  })

  it('clears workspace-A instances immediately when workspaceId changes and never restores them after B rejects', async () => {
    function deferredList() {
      let resolve!: (value: { items: unknown[] }) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<{ items: unknown[] }>((promiseResolve, promiseReject) => {
        resolve = promiseResolve
        reject = promiseReject
      })
      return { promise, resolve, reject }
    }

    const connectorsApi = createConnectorsApiWithJobrightDescriptor()
    await connectorsApi.create({
      id: 'jobright-workspace-a',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.15.0',
      displayName: 'Workspace A Jobright',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        configured: true,
      }],
      config: {},
      filters: {},
    })

    const pendingB = deferredList()
    const list = vi.fn()
      .mockResolvedValueOnce(await connectorsApi.list())
      .mockImplementationOnce(() => pendingB.promise)
    const stableApi = {
      ...connectorsApi,
      list,
      descriptors: connectorsApi.descriptors,
    }

    const { rerender } = render(
      <ConnectorSettingsPanel
        connectorsApi={stableApi as typeof connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-a"
      />,
    )

    expect(await screen.findByText('Workspace A Jobright')).toBeInTheDocument()

    rerender(
      <ConnectorSettingsPanel
        connectorsApi={stableApi as typeof connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-b"
      />,
    )

    expect(screen.queryByText('Workspace A Jobright')).not.toBeInTheDocument()
    expect(screen.getByText(/Loading connector instances/i)).toBeInTheDocument()

    pendingB.reject(new Error('workspace B dump /secret'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).not.toHaveTextContent('/secret')
    expect(screen.queryByText('Workspace A Jobright')).not.toBeInTheDocument()
  })
})

describe('ApiTokenSettingsControls form failure presentation', () => {
  it('keeps the draft and renders FormFailureAlert after save rejection', async () => {
    const onSettingsPatch = vi.fn(async () => {
      throw new ValedictorianHttpError({
        body: null,
        kind: 'unavailable',
        message: 'token dump /secret',
        status: 503,
      })
    })

    render(
      <ApiTokenSettingsControls
        apiTokenConfigured={false}
        onSettingsPatch={onSettingsPatch}
      />,
    )

    const input = screen.getByLabelText('API token')
    fireEvent.change(input, { target: { value: 'draft-token-value' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'form-failure')
    expect(alert).not.toHaveTextContent('/secret')
    expect(input).toHaveValue('draft-token-value')
    expect(document.activeElement).toBe(alert)
  })
})
