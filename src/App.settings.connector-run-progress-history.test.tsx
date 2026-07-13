import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
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

function openConnectorRuns() {
  const appNavigation = within(
    screen.getByRole('complementary', { name: 'Application navigation' }),
  ).getByRole('navigation', { name: 'Application views' })
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Connectors' }))
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Runs' }))
  return appNavigation
}


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

describe('connector-run progress and history', () => {
  it('keeps persisted active progress visible after navigating to Connector Runs', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.runs.trigger).mockReturnValueOnce(new Promise(() => {}))
    const activeRun = {
      id: 'connector-run-navigation',
      connectorInstanceId: 'jobright-default',
      mode: 'manual',
      status: 'running',
      coverage: { start: '2026-07-09T15:00:00.000Z', end: '2026-07-09T16:00:00.000Z' },
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      stats: {
        attempted: 3,
        discovered: 20,
        lastProgressAt: '2026-07-09T16:00:01.000Z',
        stage: 'normalizing',
      },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: null,
    }
    vi.mocked(connectorsApi.runs.list)
      .mockResolvedValue({
        items: [activeRun],
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      })
      .mockResolvedValueOnce({
        items: [{ ...activeRun, stats: { discovered: 0, stage: 'authenticating' } }],
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
      })

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
    await authenticateJobrightInSettings({ connectorsApi, profileApi })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByText('Stage: Authenticating')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: 'View connector-run-navigation in Connector Runs',
    }))

    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()
    expect(await screen.findByText('Stage: Normalizing')).toBeInTheDocument()
    expect(screen.getByText('Discovered jobs: 20')).toBeInTheDocument()
    expect(connectorsApi.runs.list).toHaveBeenCalledWith({
      connectorInstanceId: 'jobright-default',
      limit: 20,
      offset: 0,
    })
  })

  it('stops polling when persisted run state is terminal while trigger transport remains pending', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.runs.trigger).mockReturnValueOnce(new Promise(() => {}))
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      items: [{
        id: 'connector-run-terminal-poll',
        connectorInstanceId: 'jobright-default',
        mode: 'manual',
        status: 'completed',
        coverage: { start: '2026-07-09T15:00:00.000Z', end: '2026-07-09T16:00:00.000Z' },
        filterSignature: 'filters:{}',
        observationCount: 1,
        warningCount: 0,
        stats: { completed: true, stage: 'finalizing' },
        warnings: [],
        retryHints: null,
        startedAt: '2026-07-09T16:00:00.000Z',
        completedAt: '2026-07-09T16:00:01.000Z',
      }],
      total: 1,
      limit: 1,
      offset: 0,
      hasMore: false,
    })

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
    await authenticateJobrightInSettings({ connectorsApi, profileApi })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Running...' })).toBeDisabled()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650))
    })
    expect(connectorsApi.runs.list).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Running...' })).toBeDisabled()
  })

  it('renders a sanitized error when a settings connector run rejects', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.runs.trigger).mockRejectedValueOnce(
      new Error('sensitive session handle from connector failure'),
    )

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
    await authenticateJobrightInSettings({ connectorsApi, profileApi })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByText('Jobright run could not be completed.')).toBeInTheDocument()
    expect(screen.queryByText(/sensitive session handle/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
  })

  it('renders sanitized connector run history with retry guidance', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.3.1',
      displayName: 'Jobright public jobs',
      enabled: true,
      auth: [],
      config: {},
      filters: {},
    })
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      hasMore: false,
      items: [
        {
          id: 'connector-run-history',
          connectorInstanceId: 'jobright-default',
          mode: 'manual',
          status: 'failed',
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
            projectedUsable: 2,
            resolved: 2,
          },
          warnings: [
            {
              code: 'auth.required',
              label: 'sensitive raw warning label',
              message: 'sensitive session handle from run history',
              severity: 'blocked',
            },
          ],
          retryHints: null,
          startedAt: '2026-07-09T16:00:00.000Z',
          completedAt: '2026-07-09T16:00:02.000Z',
        },
      ],
      limit: 20,
      offset: 0,
      total: 1,
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()

    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()
    expect(await screen.findByText('Jobright public jobs')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('Authentication required')).toBeInTheDocument()
    expect(screen.getByText('Update and validate Jobright credentials, then run again.')).toBeInTheDocument()
    expect(screen.getByText('Detail attempts: 3')).toBeInTheDocument()
    expect(screen.queryByText('Projected usable: 2')).not.toBeInTheDocument()
    expect(screen.queryByText(/sensitive/i)).not.toBeInTheDocument()
  })

  it('labels per-run zero intake separately from carried cycle counts and explains the arithmetic accessibly', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'pancake-jobright',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Pancake Jobright',
      enabled: true,
      auth: [],
      config: {},
      filters: {},
    })
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      hasMore: false,
      items: [{
        id: 'pancake-carried-50',
        connectorInstanceId: 'pancake-jobright',
        mode: 'manual',
        status: 'failed',
        coverage: { start: null, end: null },
        filterSignature: 'filters:{}',
        observationCount: 0,
        warningCount: 1,
        stats: {
          discovered: 50,
          discoveryPages: 3,
          providerReturned: 0,
          stopReason: 'failed',
          lifecycleCounts: {
            version: 'connector-run-lifecycle-counts/v1',
            source: 'frozen_terminal',
            scope: { kind: 'connector_run', connectorRunId: 'pancake-carried-50' },
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
              gaps: ['missing_provider_valid'],
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
          },
        },
        warnings: [{
          code: 'jobright_raw_intake_unavailable',
          label: 'raw label',
          message: 'raw message',
          severity: 'blocked',
        }],
        retryHints: { stopReason: 'failed' },
        startedAt: '2026-07-11T14:00:00.000Z',
        completedAt: '2026-07-11T14:00:01.000Z',
      }],
      limit: 20,
      offset: 0,
      total: 1,
    })

    render(<App
      applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
      connectorsApi={connectorsApi}
      settingsApi={createSettingsApi()}
    />)
    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()

    expect(await screen.findByText('Unique jobs in this connector run')).toBeInTheDocument()
    expect(screen.getByText('Provider returned rows: 0')).toBeInTheDocument()
    expect(screen.getByText('Captured records: 0')).toBeInTheDocument()
    expect(screen.getByText('Carried connector cycle')).toBeInTheDocument()
    expect(screen.getByText('Discovered jobs: 50')).toBeInTheDocument()
    expect(screen.getByText('Discovery page requests: 3')).toBeInTheDocument()
    expect(screen.getByText('Needs action')).toBeInTheDocument()
    expect(screen.queryByText(/Technical status:/)).not.toBeInTheDocument()
    expect(screen.getByText('Provider stats gaps: missing provider valid.')).toBeInTheDocument()
    expect(screen.queryByText('Discovered: 50')).not.toBeInTheDocument()

    const explanation = screen.getByRole('button', { name: 'How these counts work' })
    expect(explanation).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(explanation)
    expect(explanation).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Returned rows equal valid unique records plus invalid rows plus source duplicates/)).toBeInTheDocument()
  })

  it('omits stale request-budget metrics while preserving provider progress', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'budget-jobright',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Budget Jobright',
      enabled: true,
      auth: [],
      config: {},
      filters: {},
    })
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      hasMore: false,
      items: [{
        id: 'budget-stop-reason-run',
        connectorInstanceId: 'budget-jobright',
        mode: 'manual',
        status: 'completed',
        coverage: { start: null, end: null },
        filterSignature: 'filters:{}',
        observationCount: 0,
        warningCount: 0,
        stats: {
          attempted: 50,
          discovered: 50,
          discoveryPages: 3,
          providerReturned: 0,
          pendingResolution: 100,
          stopReason: 'soft_batch_boundary',
          lifecycleCounts: {
            version: 'connector-run-lifecycle-counts/v1',
            source: 'frozen_terminal',
            scope: { kind: 'connector_run', connectorRunId: 'budget-stop-reason-run' },
            provider: {
              returnedRows: 0,
              validRecords: 0,
              invalidRecords: 0,
              sourceDuplicates: 0,
              capturedRecords: 0,
              occurrenceCount: 0,
              captureShortfall: 0,
              unclassifiedRows: 0,
              invariant: 'reconciled',
              gaps: [],
            },
            destination: {
              normalized: 0,
              resolvedEmployerOrAts: 0,
              resolvedThirdParty: 0,
              unresolved: 0,
              pending: 4,
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
          },
        },
        warnings: [],
        retryHints: { stopReason: 'soft_batch_boundary' },
        startedAt: '2026-07-11T14:00:00.000Z',
        completedAt: '2026-07-11T14:00:01.000Z',
      }],
      limit: 20,
      offset: 0,
      total: 1,
    })

    render(<App
      applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
      connectorsApi={connectorsApi}
      settingsApi={createSettingsApi()}
    />)
    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()

    expect(await screen.findByText('Provider returned rows: 0')).toBeInTheDocument()
    expect(screen.getByText('Captured records: 0')).toBeInTheDocument()
    expect(screen.getByText('Carried connector cycle')).toBeInTheDocument()
    expect(screen.getByText('Discovered jobs: 50')).toBeInTheDocument()
    expect(screen.getByText('Detail attempts: 50')).toBeInTheDocument()
    expect(screen.queryByText('Request budget per run: 10')).not.toBeInTheDocument()
    expect(screen.queryByText('Request budget: 50 / 10')).not.toBeInTheDocument()
    expect(screen.queryByText(/Request budget: 50\s*\/\s*10/)).not.toBeInTheDocument()
    expect(screen.getByText('Stop reason: soft_batch_boundary')).toBeInTheDocument()
    expect(screen.queryByText('Discovered: 50')).not.toBeInTheDocument()
  })

  it('omits request budget label when run stats lack budget provenance', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'missing-budget-jobright',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Missing Budget Jobright',
      enabled: true,
      auth: [],
      config: {},
      filters: {},
    })
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      hasMore: false,
      items: [{
        id: 'missing-budget-run',
        connectorInstanceId: 'missing-budget-jobright',
        mode: 'manual',
        status: 'failed',
        coverage: { start: null, end: null },
        filterSignature: 'filters:{}',
        observationCount: 0,
        warningCount: 0,
        stats: {
          attempted: 50,
          discovered: 50,
          stopReason: 'soft_batch_boundary',
          lifecycleCounts: {
            version: 'connector-run-lifecycle-counts/v1',
            source: 'frozen_terminal',
            scope: { kind: 'connector_run', connectorRunId: 'missing-budget-run' },
            provider: {
              returnedRows: 0,
              validRecords: 0,
              invalidRecords: 0,
              sourceDuplicates: 0,
              capturedRecords: 0,
              occurrenceCount: 0,
              captureShortfall: 0,
              unclassifiedRows: 0,
              invariant: 'reconciled',
              gaps: [],
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
          },
        },
        warnings: [],
        retryHints: { stopReason: 'soft_batch_boundary' },
        startedAt: '2026-07-11T14:00:00.000Z',
        completedAt: '2026-07-11T14:00:01.000Z',
      }],
      limit: 20,
      offset: 0,
      total: 1,
    })

    render(<App
      applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
      connectorsApi={connectorsApi}
      settingsApi={createSettingsApi()}
    />)
    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()

    expect(await screen.findByText('Detail attempts: 50')).toBeInTheDocument()
    expect(screen.getByText('Stop reason: soft_batch_boundary')).toBeInTheDocument()
    expect(screen.queryByText(/Request budget per run:/i)).not.toBeInTheDocument()
  })

})
