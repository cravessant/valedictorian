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
    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()
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
      version: 'connector-run-lifecycle-counts/v1',
      source,
      scope: { kind: 'connector_run', connectorRunId: 'connector-run-progress' },
      provider: {
        returnedRows: 0,
        validRecords: 0,
        invalidRecords: 0,
        sourceDuplicates: 0,
        capturedRecords: 0,
        occurrenceCount: 0,
        captureShortfall: 0,
        unclassifiedRows: 0,
        invariant: 'reported_stats_missing',
        gaps: [
          'missing_provider_returned',
          'missing_provider_valid',
          'missing_provider_invalid',
          'missing_source_duplicates',
        ],
      },
      destination: {
        normalized: 0,
        resolvedEmployerOrAts: 0,
        resolvedThirdParty: 0,
        unresolved: 0,
        pending: 0,
        gateRejected: 0,
        unclassified: 0,
        invariant: 'reconciled',
      },
      sourcing: {
        added: 0,
        queueDuplicate: 0,
        notFit: 0,
        rejected: 0,
        actionableReview: 0,
        unclassified: 0,
        invariant: 'reconciled',
      },
    })
    const progressRun = (stage: string, stats: Record<string, unknown>): ConnectorRun => ({
      id: 'connector-run-progress',
      connectorInstanceId: 'jobright-default',
      mode: 'manual',
      status: 'running',
      coverage: {
        start: '2026-07-09T15:00:00.000Z',
        end: '2026-07-09T16:00:00.000Z',
      },
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      stats: { stage, ...stats, lifecycleCounts: lifecycleCounts('live_current') },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: null,
    })
    vi.mocked(connectorsApi.runs.list)
      .mockResolvedValueOnce({
        items: [progressRun('authenticating', {
          discovered: 0,
          lastProgressAt: '2026-07-09T16:00:00.250Z',
        })],
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
      })
      .mockResolvedValueOnce({
        items: [progressRun('normalizing', {
          attempted: 3,
          discovered: 20,
          lastProgressAt: '2026-07-09T16:00:01.000Z',
          remainingTarget: 6,
          resolvedEmployerOrAts: 1,
          resolvedThirdParty: 1,
          unresolved: 1,
          wait: {
            maxDelayMs: 2_000,
            minDelayMs: 1_000,
            reason: 'jobright_resolution',
          },
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

    expect(await screen.findByText('Stage: Authenticating')).toBeInTheDocument()
    expect(await screen.findByText('Stage: Normalizing', {}, { timeout: 2_000 })).toBeInTheDocument()
    expect(screen.getByText('Live counts derived from current persisted lineage.')).toBeInTheDocument()
    expect(screen.getByText('Discovered jobs: 20')).toBeInTheDocument()
    expect(screen.getByText('Resolved employer / ATS: 1')).toBeInTheDocument()
    expect(screen.getByText('Resolved third-party: 1')).toBeInTheDocument()
    expect(screen.getByText('Remaining target: 6')).toBeInTheDocument()
    expect(screen.getByText('Waiting between bounded Jobright API requests.')).toBeInTheDocument()
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
        mode: 'manual',
        status: 'partial_success',
        coverage: {
          start: '2026-07-09T15:00:00.000Z',
          end: '2026-07-09T16:00:00.000Z',
        },
        filterSignature: 'filters:{}',
        observationCount: 8,
        warningCount: 1,
        stats: {
          attempted: 3,
          authRequired: 1,
          discovered: 12,
          eligible: 8,
          failures: 2,
          observations: 8,
          projectedUsable: 2,
          retainedForReview: 6,
          resolved: 2,
          resolvedEmployerOrAts: 1,
          resolvedThirdParty: 1,
          stage: 'finalizing',
          stopReason: 'source_exhausted',
          lifecycleCounts: lifecycleCounts('frozen_terminal'),
        },
        warnings: [],
        retryHints: {
          reason: 'auth_required',
        },
        startedAt: '2026-07-09T16:00:00.000Z',
        completedAt: '2026-07-09T16:00:02.000Z',
      })
    })

    expect(await screen.findByText('Latest run: partial_success')).toBeInTheDocument()
    expect(screen.getByText('Frozen at terminal completion.')).toBeInTheDocument()
    expect(screen.getByText('Discovered jobs: 12')).toBeInTheDocument()
    expect(screen.getByText('Detail attempts: 3')).toBeInTheDocument()
    expect(screen.getByText('Auth-required requests: 1')).toBeInTheDocument()
    expect(screen.queryByText('Eligible: 8')).not.toBeInTheDocument()
    expect(screen.queryByText('Projected usable: 2')).not.toBeInTheDocument()
    expect(screen.queryByText('Retained for review: 6')).not.toBeInTheDocument()
    expect(screen.getByText('Warnings: 1')).toBeInTheDocument()
    expect(screen.getByText('Failures: 2')).toBeInTheDocument()
    expect(screen.queryByText('auth_required')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(connectorStatusLoader).toHaveBeenCalledTimes(1)
      expect(sourcingLoader).toHaveBeenCalledTimes(1)
    })
  })

})
