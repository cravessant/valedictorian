import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDestructiveToastDedupe } from '@/components/ui/use-toast'
import {
  createConnectorsApi,
  createConnectorsApiWithJobrightDescriptor,
  createProfileApi,
} from '../App.test-helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import type { ConnectorSettingsInstance, ConnectorSettingsRun } from './connector-settings.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'

const sonnerToast = vi.hoisted(() => {
  let nextId = 0
  const toastFn = vi.fn(() => `toast-default-${nextId++}`)
  return Object.assign(toastFn, {
    dismiss: vi.fn(),
    error: vi.fn(() => `toast-error-${nextId++}`),
    success: vi.fn(() => `toast-success-${nextId++}`),
    resetIds() {
      nextId = 0
    },
  })
})

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: sonnerToast,
}))

afterEach(cleanup)

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  clearDestructiveToastDedupe()
  sonnerToast.resetIds()
  sonnerToast.mockClear()
  sonnerToast.error.mockClear()
  sonnerToast.dismiss.mockClear()
  sonnerToast.success.mockClear()
})

function createScheduleApi(): ConnectorScheduleUiApi {
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
  }
}

function instanceFixture(id = 'jobright-1'): ConnectorSettingsInstance {
  return {
    id,
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
    config: { discoveryCount: 100 },
    filters: { country: 'US' },
    earliestBackfillDate: '2026-07-02',
    createdAt: '2026-07-09T15:00:00.000Z',
    updatedAt: '2026-07-09T15:00:00.000Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function openEditor(instanceId: string, displayName = 'Jobright internslist') {
  fireEvent.click(await screen.findByRole('button', {
    name: `View ${displayName} details`,
  }))
  const dialog = await screen.findByRole('dialog', { name: `${displayName} details` })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Edit connector' }))
  return screen.findByTestId(`connector-instance-card-${instanceId}`)
}

describe('ConnectorSettingsPanel save/remove/run target ownership', () => {
  it('ignores a deferred save success after workspaceId switches', async () => {
    const pending = deferred<ConnectorSettingsInstance>()
    const connectorsApi = createConnectorsApiWithJobrightDescriptor()
    const instance = instanceFixture()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instance] })
    vi.mocked(connectorsApi.update).mockReturnValueOnce(pending.promise)
    const onConnectorChanged = vi.fn()

    const { rerender } = render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onConnectorChanged={onConnectorChanged}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-a"
      />,
    )

    const card = await openEditor(instance.id)
    fireEvent.click(within(card).getByRole('switch', { name: 'Jobright connector enabled' }))
    fireEvent.click(within(card).getByRole('button', {
      name: 'Save Jobright internslist connector settings',
    }))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledTimes(1))

    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instance] })
    rerender(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onConnectorChanged={onConnectorChanged}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-b"
      />,
    )
    expect(await screen.findByRole('button', {
      name: 'View Jobright internslist details',
    })).toBeInTheDocument()

    await act(async () => {
      pending.resolve({ ...instance, enabled: false, id: 'stale-saved' })
      await pending.promise
    })

    expect(onConnectorChanged).not.toHaveBeenCalled()
    expect(screen.queryByTestId('connector-instance-summary-stale-saved')).not.toBeInTheDocument()
    expect(screen.queryByText('Connector settings could not be saved.')).not.toBeInTheDocument()
    expect(sonnerToast.error).not.toHaveBeenCalled()
  })

  it('ignores a deferred remove success after connectorsApi switches', async () => {
    const pending = deferred<void>()
    const oldApi = createConnectorsApiWithJobrightDescriptor()
    const newApi = createConnectorsApiWithJobrightDescriptor()
    const instance = instanceFixture()
    vi.mocked(oldApi.list).mockResolvedValue({ items: [instance] })
    vi.mocked(newApi.list).mockResolvedValue({ items: [instance] })
    vi.mocked(oldApi.remove).mockReturnValueOnce(pending.promise)
    const onConnectorChanged = vi.fn()

    const { rerender } = render(
      <ConnectorSettingsPanel
        connectorsApi={oldApi}
        connectorScheduleApi={createScheduleApi()}
        onConnectorChanged={onConnectorChanged}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-a"
      />,
    )

    const card = await openEditor(instance.id)
    fireEvent.click(within(card).getByRole('button', { name: 'Remove Jobright internslist' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove connector' }))
    await waitFor(() => expect(oldApi.remove).toHaveBeenCalledTimes(1))

    rerender(
      <ConnectorSettingsPanel
        connectorsApi={newApi}
        connectorScheduleApi={createScheduleApi()}
        onConnectorChanged={onConnectorChanged}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-a"
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId(`connector-instance-summary-${instance.id}`)).toBeInTheDocument()
    })

    await act(async () => {
      pending.resolve()
      await pending.promise
    })

    expect(onConnectorChanged).not.toHaveBeenCalled()
    expect(screen.getByTestId(`connector-instance-summary-${instance.id}`)).toBeInTheDocument()
    expect(screen.queryByText('Connector could not be removed.')).not.toBeInTheDocument()
  })

  it('ignores a deferred manual-run settlement after unmount', async () => {
    const pending = deferred<ConnectorSettingsRun>()
    const connectorsApi = createConnectorsApi()
    const instance = {
      ...instanceFixture('jobright-default'),
      filters: { providerOwned: 'preserve-me' },
    }
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instance] })
    vi.mocked(connectorsApi.runs.trigger).mockReturnValueOnce(pending.promise)
    const onRunSettled = vi.fn()

    const { unmount } = render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onRunSettled={onRunSettled}
        profileApi={createProfileApi()}
        workspaceId="workspace-a"
      />,
    )

    fireEvent.click(await screen.findByRole('button', {
      name: 'View Jobright internslist details',
    }))
    const dialog = await screen.findByRole('dialog', { name: 'Jobright internslist details' })
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(1))
    expect(within(dialog).getByRole('button', { name: 'Running...' })).toBeDisabled()

    unmount()
    await act(async () => {
      pending.resolve({
        id: 'run-stale',
        connectorInstanceId: instance.id,
        executionScopeId: 'scope_stale',
        mode: 'manual',
        scheduleOccurrence: null,
        status: 'succeeded',
        coverage: {
          start: '2026-07-09T15:00:00.000Z',
          end: '2026-07-09T16:00:00.000Z',
        },
        filterSignature: 'filters:{}',
        observationCount: 0,
        warningCount: 0,
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'caught_up',
          boundary: { earliestDate: '2026-07-02' },
        },
        pendingResolutionCount: 0,
        createdAt: '2026-07-09T15:00:00.000Z',
        startedAt: '2026-07-09T15:00:00.000Z',
        finishedAt: '2026-07-09T15:01:00.000Z',
      } as ConnectorSettingsRun)
      await pending.promise
    })

    expect(onRunSettled).toHaveBeenCalledTimes(1)
    expect(sonnerToast.error).not.toHaveBeenCalled()
  })

  it('ignores a deferred manual-run settlement after workspaceId switches', async () => {
    const pending = deferred<ConnectorSettingsRun>()
    const connectorsApi = createConnectorsApi()
    const instance = {
      ...instanceFixture('jobright-default'),
      filters: { providerOwned: 'preserve-me' },
    }
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instance] })
    vi.mocked(connectorsApi.runs.trigger).mockReturnValueOnce(pending.promise)
    const onRunSettled = vi.fn()

    const { rerender } = render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onRunSettled={onRunSettled}
        profileApi={createProfileApi()}
        workspaceId="workspace-a"
      />,
    )

    fireEvent.click(await screen.findByRole('button', {
      name: 'View Jobright internslist details',
    }))
    const dialog = await screen.findByRole('dialog', { name: 'Jobright internslist details' })
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(1))

    rerender(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createScheduleApi()}
        onRunSettled={onRunSettled}
        profileApi={createProfileApi()}
        workspaceId="workspace-b"
      />,
    )
    expect(await screen.findByRole('button', {
      name: 'View Jobright internslist details',
    })).toBeInTheDocument()

    await act(async () => {
      pending.resolve({
        id: 'run-stale',
        connectorInstanceId: instance.id,
        executionScopeId: 'scope_stale',
        mode: 'manual',
        scheduleOccurrence: null,
        status: 'succeeded',
        coverage: {
          start: '2026-07-09T15:00:00.000Z',
          end: '2026-07-09T16:00:00.000Z',
        },
        filterSignature: 'filters:{}',
        observationCount: 0,
        warningCount: 0,
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'caught_up',
          boundary: { earliestDate: '2026-07-02' },
        },
        pendingResolutionCount: 0,
        createdAt: '2026-07-09T15:00:00.000Z',
        startedAt: '2026-07-09T15:00:00.000Z',
        finishedAt: '2026-07-09T15:01:00.000Z',
      } as ConnectorSettingsRun)
      await pending.promise
    })

    expect(onRunSettled).not.toHaveBeenCalled()
    expect(sonnerToast.error).not.toHaveBeenCalled()
  })
})
