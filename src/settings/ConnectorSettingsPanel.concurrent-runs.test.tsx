import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDestructiveToastDedupe } from '@/components/ui/use-toast'
import {
  createConnectorsApi,
  createProfileApi,
} from '../App.test-helpers'
import { unavailableScheduleApi } from './connector-schedule.test-helpers'
import type { ConnectorSettingsInstance, ConnectorSettingsRun } from './connector-settings.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'
import { openConnectorEditor } from './ConnectorSettingsPanel.test-helpers'

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

function instanceFixture(overrides: {
  displayName?: string
  enabled?: boolean
  id?: string
} = {}) {
  return {
    id: overrides.id ?? 'jobright-default',
    connectorId: 'jobright.resolver',
    connectorVersion: '0.11.0',
    displayName: overrides.displayName ?? 'Jobright internslist',
    enabled: overrides.enabled ?? true,
    lifecycle: (overrides.enabled ?? true) ? 'enabled' : 'disabled',
    auth: [{
      id: 'jobright',
      mode: 'username_password' as const,
      label: 'Jobright username and password',
      configured: true,
    }],
    config: { discoveryCount: 100 },
    filters: { providerOwned: 'preserve-me' },
    earliestBackfillDate: '2026-07-02',
    createdAt: '2026-07-09T15:00:00.000Z',
    updatedAt: '2026-07-09T15:00:00.000Z',
  } satisfies ConnectorSettingsInstance
}

function createRun(
  connectorInstanceId: string,
  status: 'completed' | 'failed' | 'running' | 'queued',
): ConnectorSettingsRun {
  return {
    id: `run-${connectorInstanceId}-${status}`,
    connectorInstanceId,
    executionScopeId: `scope_${connectorInstanceId}`,
    mode: 'manual',
    scheduleOccurrence: null,
    status,
    filterSignature: 'filters:{}',
    observationCount: 0,
    warningCount: 0,
    warnings: [],
    newestFrontier: { state: 'caught_up' },
    historicalBackfill: {
      state: 'caught_up',
      boundary: { earliestDate: '2026-07-02' },
    },
    pendingResolutionCount: 0,
    outcome: { kind: 'caught_up' },
    startedAt: '2026-07-09T15:00:00.000Z',
    completedAt: status === 'running' || status === 'queued' ? null : '2026-07-09T15:01:00.000Z',
  }
}

describe('ConnectorSettingsPanel concurrent manual runs', () => {
  it('tracks overlapping A and B runs independently without clearing the other card', async () => {
    const connectorsApi = createConnectorsApi()
    const instanceA = instanceFixture({ id: 'jobright-a', displayName: 'Jobright A' })
    const instanceB = instanceFixture({ id: 'jobright-b', displayName: 'Jobright B' })
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceA, instanceB] })

    let resolveA!: (run: ConnectorSettingsRun) => void
    let rejectB!: (reason?: unknown) => void
    const pendingA = new Promise<ConnectorSettingsRun>((resolve) => {
      resolveA = resolve
    })
    const pendingB = new Promise<ConnectorSettingsRun>((_resolve, reject) => {
      rejectB = reject
    })
    vi.mocked(connectorsApi.runs.trigger)
      .mockImplementationOnce(() => pendingA)
      .mockImplementationOnce(() => pendingB)

    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={unavailableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const dialogA = await openConnectorEditor('Jobright A')
    fireEvent.click(within(dialogA).getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => {
      expect(within(dialogA).getByRole('button', { name: 'Running...' })).toBeDisabled()
    })

    fireEvent.click(within(dialogA).getByRole('button', { name: 'Close' }))
    const dialogB = await openConnectorEditor('Jobright B')
    fireEvent.click(within(dialogB).getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => {
      expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(2)
    })
    expect(within(dialogB).getByRole('button', { name: 'Running...' })).toBeDisabled()

    rejectB(new Error('B run dump /secret'))
    await waitFor(() => {
      expect(sonnerToast.error).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(within(dialogB).getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
    })
    expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/secret')

    fireEvent.click(within(dialogB).getByRole('button', { name: 'Close' }))
    const dialogAAgain = await openConnectorEditor('Jobright A')
    expect(within(dialogAAgain).getByRole('button', { name: 'Running...' })).toBeDisabled()

    await act(async () => {
      resolveA(createRun('jobright-a', 'completed'))
    })
    await waitFor(() => {
      expect(within(dialogAAgain).getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
    })
  })

  it('prevents duplicate in-flight runs for the same instance', async () => {
    const connectorsApi = createConnectorsApi()
    const instance = instanceFixture()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instance] })
    let resolveRun!: (run: ConnectorSettingsRun) => void
    const pending = new Promise<ConnectorSettingsRun>((resolve) => {
      resolveRun = resolve
    })
    vi.mocked(connectorsApi.runs.trigger).mockImplementation(() => pending)

    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={unavailableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const dialog = await openConnectorEditor('Jobright internslist')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Running...' })).toBeDisabled()
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Running...' }))
    expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRun(createRun(instance.id, 'completed'))
    })
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
    })
  })
})
