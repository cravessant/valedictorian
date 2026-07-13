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
  createConnectorStatusResult,
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  createSourcingResult,
  openSettingsPage
} from './App.test-helpers'

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

async function authenticateJobrightInSettings({
  connectorsApi,
  profileApi,
  email = 'demo@example.com',
  password = ' pass with spaces ',
}: {
  connectorsApi: ReturnType<typeof createConnectorsApi>
  profileApi: ReturnType<typeof createProfileApi>
  email?: string
  password?: string
}) {
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
}

describe('Jobright execution', () => {
  it('runs an authenticated Jobright connector from settings', async () => {
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

    const runButtonBeforeAuth = await screen.findByRole('button', { name: 'Run Jobright now' })
    expect(runButtonBeforeAuth).toBeDisabled()

    await authenticateJobrightInSettings({ connectorsApi, profileApi })

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    await waitFor(() => {
      expect(connectorsApi.runs.trigger).toHaveBeenCalledWith(expect.objectContaining({
        connectorInstanceId: 'jobright-default',
        mode: 'manual',
      }))
    })
    expect(await screen.findByText('Latest synchronization: Caught up')).toBeInTheDocument()
  })

  it('shows two persisted non-terminal progress snapshots before terminal connector counts', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const connectorStatusLoader = vi.fn(async () => createConnectorStatusResult([]))
    const sourcingLoader = vi.fn(async () => createSourcingResult([]))
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
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorStatusLoader={connectorStatusLoader}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        sourcingLoader={sourcingLoader}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await authenticateJobrightInSettings({ connectorsApi, profileApi })

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByRole('status', { name: 'Jobright internslist run progress' }))
      .toHaveTextContent('Checking newest')
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Jobright internslist run progress' }))
        .toHaveTextContent('Resolving links')
    }, { timeout: 2_000 })
    expect(screen.getByText('Live counts derived from current persisted lineage.')).toBeInTheDocument()
    expect(screen.getByText('Captured records: 20')).toBeInTheDocument()
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
    expect(screen.getByText('Frozen at terminal completion.')).toBeInTheDocument()
    expect(screen.getByText('Captured records: 8')).toBeInTheDocument()
    expect(screen.getByText('Sourcing findings added: 2')).toBeInTheDocument()
    expect(screen.getByText('Canonical duplicates: 1')).toBeInTheDocument()
    expect(screen.queryByText('Detail attempts: 3')).not.toBeInTheDocument()
    expect(screen.queryByText('Auth-required requests: 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Eligible: 8')).not.toBeInTheDocument()
    expect(screen.queryByText('Projected usable: 2')).not.toBeInTheDocument()
    expect(screen.queryByText('Retained for review: 6')).not.toBeInTheDocument()
    expect(screen.queryByText('Warnings: 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Failures: 2')).not.toBeInTheDocument()
    expect(screen.queryByText('auth_required')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(connectorStatusLoader).toHaveBeenCalledTimes(1)
      expect(sourcingLoader).toHaveBeenCalledTimes(1)
    })
  })

})
