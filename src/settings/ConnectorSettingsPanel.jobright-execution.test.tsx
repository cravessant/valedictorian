import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDestructiveToastDedupe } from '@/components/ui/use-toast'
import {
  createConnectorsApi,
  createConnectorsApiWithJobrightDescriptor,
  createProfileApi,
  selectSoftwareEngineeringTaxonomy,
  stubCmdkEnvironment,
} from '../App.test-helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
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

beforeEach(() => {
  stubCmdkEnvironment()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  clearDestructiveToastDedupe()
  sonnerToast.resetIds()
  sonnerToast.mockClear()
  sonnerToast.error.mockClear()
  sonnerToast.dismiss.mockClear()
  sonnerToast.success.mockClear()
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

async function openConnectorEditor(displayName = 'Jobright internslist') {
  fireEvent.click(await screen.findByRole('button', {
    name: `View ${displayName} details`,
  }))
  const dialog = await screen.findByRole('dialog', { name: `${displayName} details` })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Edit connector' }))
  await within(dialog).findByRole('button', { name: 'Cancel editing' })
  return dialog
}

async function authenticateJobrightInPanel({
  connectorsApi,
  profileApi,
  email = 'demo@example.com',
  password = ' pass with spaces ',
}: {
  connectorsApi: ReturnType<typeof createConnectorsApiWithJobrightDescriptor>
  profileApi: ReturnType<typeof createProfileApi>
  email?: string
  password?: string
}) {
  await openConnectorEditor()
  const editButton = await screen.findByRole('button', {
    name: /^(Add credentials|Update credentials)$/,
  })
  fireEvent.click(editButton)
  fireEvent.change(await screen.findByLabelText('Jobright email'), {
    target: { value: email },
  })
  fireEvent.change(screen.getByLabelText('Jobright password'), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))
  await screen.findByText('Auth verified')
  expect(profileApi.secrets.upsert).toHaveBeenCalled()
  expect(connectorsApi.status.reconnect).toHaveBeenCalled()
  expect(screen.queryByDisplayValue(email)).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue(password)).not.toBeInTheDocument()
  await selectSoftwareEngineeringTaxonomy()
  fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
  fireEvent.click(screen.getByRole('button', { name: 'Save Jobright internslist connector settings' }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
  })
}

describe('ConnectorSettingsPanel Jobright execution progress', () => {
  it('shows two persisted non-terminal progress snapshots before terminal connector counts', async () => {
    const connectorsApi = createConnectorsApiWithJobrightDescriptor()
    const profileApi = createProfileApi()
    const onRunSettled = vi.fn()
    type ConnectorRun = Awaited<ReturnType<typeof connectorsApi.runs.trigger>>
    let resolveRun: ((run: ConnectorRun) => void) | undefined
    const pendingRun = new Promise<ConnectorRun>((resolve) => {
      resolveRun = resolve
    })
    vi.mocked(connectorsApi.runs.trigger).mockReturnValueOnce(pendingRun)
    const lifecycleCounts = (source: 'live_current' | 'frozen_terminal') => ({
      version: 'connector-run-lifecycle-counts/v1' as const,
      source,
      scope: {
        kind: 'connector_run' as const,
        connectorRunId: 'connector-run-progress',
        executionScopeId: 'scope_jobright_default' as const,
      },
      provider: {
        returnedRows: 20,
        validRecords: 20,
        invalidRecords: 0,
        sourceDuplicates: 0,
        capturedRecords: 20,
        occurrenceCount: 20,
        captureShortfall: 0,
        unclassifiedRows: 0,
        invariant: 'reconciled' as const,
        gaps: [] as [],
      },
      destination: {
        normalized: 2,
        resolvedEmployerOrAts: 1,
        resolvedThirdParty: 1,
        unresolved: 1,
        pending: 6,
        gateRejected: 0,
        unclassified: 0,
        invariant: 'reconciled' as const,
      },
      sourcing: {
        findingsAdded: 0,
        canonicalDuplicates: 0,
        notFit: 0,
        rejected: 0,
        actionableReview: 0,
        unclassified: 0,
        invariant: 'reconciled' as const,
      },
    })
    const progressRun = (overrides: Partial<ConnectorRun> = {}): ConnectorRun => ({
      id: 'connector-run-progress',
      connectorInstanceId: 'jobright-default',
      executionScopeId: 'scope_jobright_default',
      mode: 'manual',
      scheduleOccurrence: null,
      status: 'running',
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      newestFrontier: { state: 'advancing' },
      historicalBackfill: {
        state: 'not_started', boundary: { earliestDate: '2026-07-01' },
      },
      pendingResolutionCount: 0,
      outcome: { kind: 'in_progress' },
      lifecycleCounts: lifecycleCounts('live_current'),
      warnings: [],
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: null,
      ...overrides,
    })
    vi.mocked(connectorsApi.runs.list)
      .mockResolvedValueOnce({
        items: [progressRun({
          newestFrontier: { state: 'advancing' },
          pendingResolutionCount: 0,
          lifecycleCounts: {
            ...lifecycleCounts('live_current'),
            provider: {
              ...lifecycleCounts('live_current').provider,
              returnedRows: 0,
              validRecords: 0,
              capturedRecords: 0,
              occurrenceCount: 0,
            },
            destination: {
              ...lifecycleCounts('live_current').destination,
              normalized: 0,
              resolvedEmployerOrAts: 0,
              resolvedThirdParty: 0,
              unresolved: 0,
              pending: 0,
            },
          },
        })],
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
      })
      .mockResolvedValueOnce({
        items: [progressRun({
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'caught_up', boundary: { earliestDate: '2026-07-01' },
          },
          pendingResolutionCount: 6,
          lifecycleCounts: lifecycleCounts('live_current'),
        })],
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
      })

    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createUnavailableScheduleApi()}
        onRunSettled={onRunSettled}
        profileApi={profileApi}
        workspaceId="workspace-1"
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await waitFor(() => expect(connectorsApi.create).toHaveBeenCalled())
    await authenticateJobrightInPanel({ connectorsApi, profileApi })

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => {
      expect(connectorsApi.runs.trigger).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'manual',
      }))
    })

    expect(await screen.findByRole('status', { name: 'Jobright internslist run progress' }))
      .toHaveTextContent('Checking newest')
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Jobright internslist run progress' }))
        .toHaveTextContent('Resolving links')
    }, { timeout: 2_000 })
    expect(
      screen.queryByText('Live counts derived from current persisted lineage.'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Capture lineages: 20')).toBeInTheDocument()
    expect(screen.getByText('Resolved employer / ATS: 1')).toBeInTheDocument()
    expect(screen.getByText('Resolved third-party: 1')).toBeInTheDocument()
    expect(screen.getByText('Pending: 6')).toBeInTheDocument()
    expect(screen.queryByText('Remaining target: 6')).not.toBeInTheDocument()
    expect(screen.queryByText(/Waiting between bounded Jobright API requests/)).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Jobright internslist run progress' })).toHaveAttribute(
      'aria-live',
      'polite',
    )
    expect(screen.getByRole('button', { name: 'View connector-run-progress in Connector Runs' }))
      .toBeInTheDocument()

    await act(async () => {
      resolveRun?.({
        id: 'connector-run-progress',
        connectorInstanceId: 'jobright-default',
        executionScopeId: 'scope_jobright_default',
        mode: 'manual',
        scheduleOccurrence: null,
        status: 'completed',
        filterSignature: 'filters:{}',
        observationCount: 8,
        warningCount: 1,
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'source_exhausted', boundary: { earliestDate: '2026-07-01' },
        },
        pendingResolutionCount: 0,
        outcome: { kind: 'source_exhausted' },
        lifecycleCounts: {
          ...lifecycleCounts('frozen_terminal'),
          provider: {
            ...lifecycleCounts('frozen_terminal').provider,
            returnedRows: 12,
            validRecords: 8,
            capturedRecords: 8,
            occurrenceCount: 8,
            sourceDuplicates: 4,
          },
          destination: {
            ...lifecycleCounts('frozen_terminal').destination,
            pending: 0,
            unresolved: 0,
          },
          sourcing: {
            ...lifecycleCounts('frozen_terminal').sourcing,
            findingsAdded: 2,
            canonicalDuplicates: 1,
          },
        },
        warnings: [],
        startedAt: '2026-07-09T16:00:00.000Z',
        completedAt: '2026-07-09T16:00:02.000Z',
      })
    })

    expect(await screen.findByText('Latest synchronization: Provider history exhausted')).toBeInTheDocument()
    expect(screen.queryByText('Frozen at terminal completion.')).not.toBeInTheDocument()
    expect(screen.getByText('Capture lineages: 8')).toBeInTheDocument()
    expect(screen.getByText('Opportunities added: 2')).toBeInTheDocument()
    expect(screen.getByText('Canonical duplicates: 1')).toBeInTheDocument()
    expect(screen.queryByText('Detail attempts: 3')).not.toBeInTheDocument()
    expect(screen.queryByText('Auth-required requests: 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Eligible: 8')).not.toBeInTheDocument()
    expect(screen.queryByText('Projected usable: 2')).not.toBeInTheDocument()
    expect(screen.queryByText('Retained for review: 6')).not.toBeInTheDocument()
    expect(screen.queryByText('Warnings: 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Failures: 2')).not.toBeInTheDocument()
    expect(screen.queryByText('auth_required')).not.toBeInTheDocument()
    expect(onRunSettled).toHaveBeenCalled()
  })

  it('clears optimistic Starting when the public trigger is rejected before persistence', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
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
        filters: { country: 'US' },
        earliestBackfillDate: '2026-07-02',
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.runs.trigger).mockRejectedValueOnce(
      new Error('forced rejection'),
    )

    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createUnavailableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    await openConnectorEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    await waitFor(() => {
      expect(sonnerToast.error).toHaveBeenCalledWith(
        'Action failed',
        expect.objectContaining({
          description: 'Jobright run could not be completed.',
        }),
      )
    })
    expect(screen.queryByText('Latest synchronization: Starting')).not.toBeInTheDocument()
  })
})
