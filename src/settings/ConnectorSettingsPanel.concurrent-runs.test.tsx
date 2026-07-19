import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDestructiveToastDedupe } from '@/components/ui/use-toast'
import {
  createConnectorsApi,
  createProfileApi,
} from '../App.test-helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import type { ConnectorSettingsRun } from './connector-settings.types'
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

async function openConnectorEditor(displayName: string) {
  fireEvent.click(await screen.findByRole('button', {
    name: `View ${displayName} details`,
  }))
  const dialog = await screen.findByRole('dialog', { name: `${displayName} details` })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Edit connector' }))
  await within(dialog).findByRole('button', { name: 'Cancel editing' })
  return dialog
}

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
  }
}

function createRun(
  connectorInstanceId: string,
  status: 'succeeded' | 'failed' | 'running' | 'queued',
): ConnectorSettingsRun {
  return {
    id: `run-${connectorInstanceId}-${status}`,
    connectorInstanceId,
    executionScopeId: `scope_${connectorInstanceId}`,
    mode: 'manual',
    scheduleOccurrence: null,
    status,
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
    outcome: { kind: 'caught_up' as const },
    createdAt: '2026-07-09T15:00:00.000Z',
    updatedAt: '2026-07-09T15:00:00.000Z',
    startedAt: '2026-07-09T15:00:00.000Z',
    finishedAt: status === 'running' || status === 'queued' ? null : '2026-07-09T15:01:00.000Z',
  } as ConnectorSettingsRun
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
        connectorScheduleApi={createUnavailableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const dialogA = await openConnectorEditor('Jobright A')
    fireEvent.click(within(dialogA).getByRole('button', { name: 'Cancel editing' }))
    fireEvent.click(within(dialogA).getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => {
      expect(within(dialogA).getByRole('button', { name: 'Running...' })).toBeDisabled()
    })

    fireEvent.click(within(dialogA).getByRole('button', { name: 'Close' }))
    const dialogB = await openConnectorEditor('Jobright B')
    fireEvent.click(within(dialogB).getByRole('button', { name: 'Cancel editing' }))
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
      resolveA(createRun('jobright-a', 'succeeded'))
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
        connectorScheduleApi={createUnavailableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const dialog = await openConnectorEditor('Jobright internslist')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel editing' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Running...' })).toBeDisabled()
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Running...' }))
    expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRun(createRun(instance.id, 'succeeded'))
    })
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
    })
  })
})
