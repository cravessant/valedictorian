import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDestructiveToastDedupe } from '@/components/ui/use-toast'
import {
  createConnectorsApi,
  createProfileApi,
} from '../App.test-helpers'
import { availableScheduleApi } from './connector-schedule.test-helpers'
import type { ConnectorSettingsInstance } from './connector-settings.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'
import { jobrightAuth, jobrightInstance } from './ConnectorSettingsPanel.test-helpers'

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
  clearDestructiveToastDedupe()
  sonnerToast.resetIds()
  sonnerToast.mockClear()
  sonnerToast.error.mockClear()
  sonnerToast.dismiss.mockClear()
  sonnerToast.success.mockClear()
})

function createdInstance(id: string): ConnectorSettingsInstance {
  return jobrightInstance({
    auth: jobrightAuth(false),
    earliestBackfillDate: null,
    enabled: false,
    filters: { country: 'US' },
    id,
  })
}

function deferredCreate() {
  let resolve!: (value: ConnectorSettingsInstance) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<ConnectorSettingsInstance>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ConnectorSettingsPanel create target ownership', () => {
  it('ignores a deferred create success after workspaceId switches', async () => {
    const pending = deferredCreate()
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [] })
    vi.mocked(connectorsApi.create).mockReturnValueOnce(pending.promise)

    const onConnectorChanged = vi.fn()
    const { rerender } = render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={availableScheduleApi()}
        onConnectorChanged={onConnectorChanged}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-a"
      />,
    )

    expect(await screen.findByRole('button', { name: 'Add Jobright connector' }))
      .toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add Jobright connector' }))
    await waitFor(() => expect(connectorsApi.create).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Adding...' })).toBeDisabled()

    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [] })
    rerender(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={availableScheduleApi()}
        onConnectorChanged={onConnectorChanged}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-b"
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Jobright connector' })).toBeEnabled()
    })

    await act(async () => {
      pending.resolve(createdInstance('stale-from-workspace-a'))
      await pending.promise
    })
    expect(onConnectorChanged).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/connector enabled/i)).not.toBeInTheDocument()
    expect(sonnerToast.error).not.toHaveBeenCalled()
    expect(screen.queryByText('Connector action failed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Jobright connector' })).toBeEnabled()
    expect(screen.getByLabelText('Empty connector instances')).toBeInTheDocument()
  })

  it('ignores a deferred create rejection after connectorsApi switches', async () => {
    const pending = deferredCreate()
    const oldApi = createConnectorsApi()
    const newApi = createConnectorsApi()
    vi.mocked(oldApi.list).mockResolvedValue({ items: [] })
    vi.mocked(newApi.list).mockResolvedValue({ items: [] })
    vi.mocked(oldApi.create).mockReturnValueOnce(pending.promise)

    const { rerender } = render(
      <ConnectorSettingsPanel
        connectorsApi={oldApi}
        connectorScheduleApi={availableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-a"
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await waitFor(() => expect(oldApi.create).toHaveBeenCalledTimes(1))

    rerender(
      <ConnectorSettingsPanel
        connectorsApi={newApi}
        connectorScheduleApi={availableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-a"
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Jobright connector' })).toBeEnabled()
    })

    await act(async () => {
      pending.reject(new Error('create dump /secret/path'))
      await pending.promise.catch(() => undefined)
    })

    expect(screen.queryByText(/could not|failed|dump|\/secret/i)).not.toBeInTheDocument()
    expect(sonnerToast.error).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Jobright connector' })).toBeEnabled()
    expect(newApi.create).not.toHaveBeenCalled()
  })

  it('ignores a deferred create settlement after unmount', async () => {
    const pending = deferredCreate()
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [] })
    vi.mocked(connectorsApi.create).mockReturnValueOnce(pending.promise)
    const onConnectorChanged = vi.fn()

    const { unmount } = render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={availableScheduleApi()}
        onConnectorChanged={onConnectorChanged}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-a"
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await waitFor(() => expect(connectorsApi.create).toHaveBeenCalledTimes(1))

    unmount()
    await act(async () => {
      pending.resolve(createdInstance('unmounted-create'))
      await pending.promise
    })

    expect(onConnectorChanged).not.toHaveBeenCalled()
    expect(sonnerToast.error).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/connector enabled/i)).not.toBeInTheDocument()
  })
})
