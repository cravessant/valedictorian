import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDestructiveToastDedupe } from '@/components/ui/use-toast'
import App from '../App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  openConnectorEditor,
  openSettingsPage,
} from '../App.test-helpers'
import type { ConnectorSettingsRun } from './connector-settings.types'

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
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={createProfileApi()}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

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

    fireEvent.click(within(dialogB).getByRole('button', { name: 'Close' }))
    const dialogAAgain = await openConnectorDetailsOnly('Jobright A')
    expect(within(dialogAAgain).getByRole('button', { name: 'Running...' })).toBeDisabled()

    resolveA(createRun(instanceA.id, 'succeeded'))
    await waitFor(() => {
      expect(within(dialogAAgain).getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
    })
    expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/secret')
  })

  it('prevents duplicate in-flight runs for the same instance', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceFixture()] })

    let resolveFirst!: (run: ConnectorSettingsRun) => void
    const first = new Promise<ConnectorSettingsRun>((resolve) => {
      resolveFirst = resolve
    })
    vi.mocked(connectorsApi.runs.trigger).mockImplementationOnce(() => first)

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={createProfileApi()}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    const dialog = await openConnectorEditor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel editing' }))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(1))
    expect(within(dialog).getByRole('button', { name: 'Running...' })).toBeDisabled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Running...' }))
    expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(1)

    resolveFirst(createRun('jobright-default', 'succeeded'))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
    })
  })
})

async function openConnectorDetailsOnly(displayName: string) {
  const existing = screen.queryByRole('dialog', { name: `${displayName} details` })
  if (existing) return existing
  fireEvent.click(await screen.findByRole('button', {
    name: `View ${displayName} details`,
  }))
  return screen.findByRole('dialog', { name: `${displayName} details` })
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
