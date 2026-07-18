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
  createConnectorsApiWithJobrightDescriptor as createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  lastCreatedConnectorInstanceId,
  openConnectorDetails,
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

const JOBRIGHT_TEST_FILTERS = {
  jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
}

async function seedRunnableJobright(connectorsApi: ReturnType<typeof createConnectorsApi>) {
  await connectorsApi.create({
    id: 'jobright-default',
    connectorId: 'jobright.resolver',
    connectorVersion: '0.13.0',
    displayName: 'Jobright internslist',
    enabled: true,
    auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'jobright-fixture' }],
    config: {},
    filters: JOBRIGHT_TEST_FILTERS,
  })
}


describe('connector-run progress and history', () => {
  it('keeps persisted active progress visible after navigating to Connector Runs', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    await seedRunnableJobright(connectorsApi)
    vi.mocked(connectorsApi.runs.trigger).mockReturnValueOnce(new Promise(() => {}))
    const activeRun = {
      id: 'connector-run-navigation',
      connectorInstanceId: 'jobright-default',
      executionScopeId: 'scope_jobright_default',
      mode: 'manual' as const,
      scheduleOccurrence: null,
      status: 'running' as const,
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      newestFrontier: { state: 'advancing' as const },
      historicalBackfill: {
        state: 'not_started' as const,
        boundary: { earliestDate: '2026-07-09' },
      },
      pendingResolutionCount: 0,
      outcome: { kind: 'in_progress' as const },
      warnings: [],
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: null,
    }
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      items: [activeRun],
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi({ showDebugData: true })}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    const instanceId = lastCreatedConnectorInstanceId(connectorsApi)
    await openConnectorDetails()
    fireEvent.click(await screen.findByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByRole('status', { name: 'Jobright internslist run progress' }))
      .toHaveTextContent('Checking newest')
    fireEvent.click(screen.getByRole('button', {
      name: 'View connector-run-navigation in Connector Runs',
    }))

    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()
    expect(screen.getAllByText('Checking newest').length).toBeGreaterThan(0)
    expect(screen.getByText('Checking the provider for newly published jobs.')).toBeInTheDocument()
    expect(connectorsApi.runs.list).toHaveBeenCalledWith({
      connectorInstanceId: instanceId,
      limit: 20,
      offset: 0,
    })
  })

  it('stops polling when persisted run state is terminal while trigger transport remains pending', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    await seedRunnableJobright(connectorsApi)
    vi.mocked(connectorsApi.runs.trigger).mockReturnValueOnce(new Promise(() => {}))
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      items: [{
        id: 'connector-run-terminal-poll',
        connectorInstanceId: 'jobright-default',
        executionScopeId: 'scope_jobright_default',
        mode: 'manual',
        scheduleOccurrence: null,
        status: 'completed',
        coverage: { start: '2026-07-09T15:00:00.000Z', end: '2026-07-09T16:00:00.000Z' },
        filterSignature: 'filters:{}',
        observationCount: 1,
        warningCount: 0,
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'caught_up',
          boundary: { earliestDate: '2026-07-09' },
        },
        pendingResolutionCount: 0,
        outcome: { kind: 'caught_up' },
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
        settingsApi={createSettingsApi({ showDebugData: true })}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    await openConnectorDetails()
    fireEvent.click(await screen.findByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByText('Latest synchronization: Caught up')).toBeInTheDocument()
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
    await seedRunnableJobright(connectorsApi)
    vi.mocked(connectorsApi.runs.trigger).mockRejectedValueOnce(
      new Error('sensitive session handle from connector failure'),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi({ showDebugData: true })}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    await openConnectorDetails()
    fireEvent.click(await screen.findByRole('button', { name: 'Run Jobright now' }))

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
          executionScopeId: 'scope_jobright_default',
          mode: 'manual',
          scheduleOccurrence: null,
          status: 'failed',
          coverage: {
            start: '2026-07-09T15:00:00.000Z',
            end: '2026-07-09T16:00:00.000Z',
          },
          filterSignature: 'filters:{}',
          observationCount: 8,
          warningCount: 1,
          newestFrontier: { state: 'not_started' },
          historicalBackfill: {
            state: 'not_started',
            boundary: { earliestDate: '2026-07-09' },
          },
          pendingResolutionCount: 0,
          outcome: {
            kind: 'action_required',
            operation: {
              kind: 'authentication_expired',
              executionScopeId: 'scope_jobright_default',
              requestRefresh: true,
            },
          },
          lifecycleCounts: {
            version: 'connector-run-lifecycle-counts/v1',
            source: 'frozen_terminal',
            scope: {
              kind: 'connector_run',
              connectorRunId: 'connector-run-history',
              executionScopeId: 'scope_jobright_default',
            },
            provider: {
              returnedRows: 12,
              validRecords: 8,
              invalidRecords: 0,
              sourceDuplicates: 4,
              capturedRecords: 8,
              occurrenceCount: 8,
              captureShortfall: 0,
              unclassifiedRows: 0,
              invariant: 'reconciled',
              gaps: [],
            },
            destination: {
              normalized: 2,
              resolvedEmployerOrAts: 1,
              resolvedThirdParty: 1,
              unresolved: 0,
              pending: 0,
              gateRejected: 0,
              unclassified: 0,
              invariant: 'reconciled',
            },
            sourcing: {
              findingsAdded: 1,
              canonicalDuplicates: 1,
              notFit: 0,
              rejected: 0,
              actionableReview: 0,
              unclassified: 0,
              invariant: 'reconciled',
            },
          },
          warnings: [
            {
              code: 'auth.required',
              label: 'sensitive raw warning label',
              message: 'sensitive session handle from run history',
              severity: 'blocked',
            },
          ],
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
        settingsApi={createSettingsApi({ showDebugData: true })}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()

    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()

    const runArticle = await screen.findByRole('article')
    expect(runArticle).toHaveAttribute('data-connector-run-id', 'connector-run-history')
    expect(runArticle).toHaveAttribute('id', 'connector-run-connector-run-history')
    expect(runArticle.querySelector('[data-slot="card"]')).not.toBeNull()
    expect(runArticle.querySelector('[data-slot="card-header"]')).not.toBeNull()
    expect(runArticle.querySelector('[data-slot="card-content"]')).not.toBeNull()
    expect(runArticle.querySelector('[data-slot="card-footer"]')).toBeNull()
    expect(runArticle.querySelector('[data-slot="card-action"]')).not.toBeNull()

    expect(
      within(runArticle).getByRole('heading', { level: 3, name: 'Jobright public jobs' }),
    ).toBeInTheDocument()
    expect(
      within(runArticle).getByText('Jobright public jobs').closest('[data-slot="card-title"]'),
    ).not.toBeNull()
    expect(
      within(runArticle).getByText('manual · 2026-07-09T16:00:00.000Z'),
    ).toHaveAttribute('data-slot', 'card-description')
    expect(screen.getByRole('status', { name: 'Connector synchronization state' }))
      .toHaveTextContent('Authentication required')
    expect(screen.queryByText('failed')).not.toBeInTheDocument()
    expect(screen.getAllByText('Authentication required')).toHaveLength(3)
    const syncBadge = within(runArticle).getAllByText('Authentication required')
      .find((node) => node.getAttribute('data-variant') === 'outline')
    const warningBadge = within(runArticle).getAllByText('Authentication required')
      .find((node) => node.getAttribute('data-variant') === 'secondary')
    expect(syncBadge).toHaveAttribute('data-slot', 'badge')
    expect(warningBadge).toHaveAttribute('data-slot', 'badge')
    expect(
      within(runArticle).getByText('Update and validate Jobright credentials, then run again.'),
    ).toBeInTheDocument()
    expect(within(runArticle).getByText('Provider returned rows: 12')).toBeInTheDocument()
    expect(within(runArticle).getByText('Capture lineages: 8')).toBeInTheDocument()
    expect(within(runArticle).getByText('Opportunities added: 1')).toBeInTheDocument()
    expect(within(runArticle).getByText('Canonical duplicates: 1')).toBeInTheDocument()
    expect(within(runArticle).queryByText('Detail attempts: 3')).not.toBeInTheDocument()
    expect(screen.queryByText('Projected usable: 2')).not.toBeInTheDocument()
    expect(screen.queryByText(/sensitive/i)).not.toBeInTheDocument()
    expect(runArticle).not.toHaveAttribute('aria-live')
  })

  it('keeps Card composition inside articles while preserving focus and live-region ownership', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    await seedRunnableJobright(connectorsApi)
    const runningRun = {
      id: 'connector-run-card-focus',
      connectorInstanceId: 'jobright-default',
      executionScopeId: 'scope_jobright_default',
      mode: 'manual' as const,
      scheduleOccurrence: null,
      status: 'running' as const,
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      newestFrontier: { state: 'advancing' as const },
      historicalBackfill: {
        state: 'not_started' as const,
        boundary: { earliestDate: '2026-07-09' },
      },
      pendingResolutionCount: 0,
      outcome: { kind: 'in_progress' as const },
      stats: { discovered: 4, stage: 'discovering' },
      warnings: [],
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: null,
    }
    const completedRun = {
      ...runningRun,
      id: 'connector-run-card-completed',
      status: 'completed' as const,
      observationCount: 1,
      newestFrontier: { state: 'caught_up' as const },
      historicalBackfill: {
        state: 'caught_up' as const,
        boundary: { earliestDate: '2026-07-09' },
      },
      outcome: { kind: 'caught_up' as const },
      stats: { stage: 'finalizing' },
      startedAt: '2026-07-09T15:00:00.000Z',
      completedAt: '2026-07-09T15:00:01.000Z',
    }
    vi.mocked(connectorsApi.runs.trigger).mockResolvedValueOnce(runningRun)
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      items: [runningRun, completedRun],
      total: 2,
      limit: 20,
      offset: 0,
      hasMore: false,
    })
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi({ showDebugData: true })}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    await openConnectorDetails()
    fireEvent.click(await screen.findByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByText('Latest synchronization: Checking newest')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', {
      name: 'View connector-run-card-focus in Connector Runs',
    }))

    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()

    const focusedArticle = await screen.findByRole('article', { current: true })
    expect(focusedArticle).toHaveAttribute('data-connector-run-id', 'connector-run-card-focus')
    expect(focusedArticle).toHaveAttribute('id', 'connector-run-connector-run-card-focus')
    expect(focusedArticle).toHaveAttribute('tabIndex', '-1')
    expect(focusedArticle).toHaveClass('rounded-md', 'ring-2', 'ring-primary')
    expect(focusedArticle).toHaveAttribute('aria-live', 'polite')
    expect(focusedArticle).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalled()
    expect(focusedArticle.querySelector('[data-slot="card"]')).not.toBeNull()
    expect(
      within(focusedArticle).getByRole('heading', { level: 3 }),
    ).toBeInTheDocument()
    expect(within(focusedArticle).getAllByText('Checking newest')
      .some((node) => node.getAttribute('data-slot') === 'badge')).toBe(true)
    expect(within(focusedArticle).getByText('Discovered jobs: 4')).toBeInTheDocument()

    const completedArticle = screen
      .getAllByRole('article')
      .find((article) => article.getAttribute('data-connector-run-id') === 'connector-run-card-completed')
    expect(completedArticle).toBeDefined()
    expect(completedArticle).not.toHaveAttribute('aria-current')
    expect(completedArticle).not.toHaveAttribute('aria-live')
    expect(completedArticle).not.toHaveAttribute('tabIndex')
    expect(completedArticle!.querySelector('[data-slot="card"]')).not.toBeNull()
    expect(within(completedArticle!).getAllByText('Caught up')
      .some((node) => node.getAttribute('data-slot') === 'badge')).toBe(true)
  })

  it('reconciles released lifecycle counts without opaque carried cycle stats', async () => {
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
        executionScopeId: 'scope_pancake_jobright',
        mode: 'manual',
        scheduleOccurrence: null,
        status: 'failed',
        filterSignature: 'filters:{}',
        observationCount: 0,
        warningCount: 1,
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'advancing',
          boundary: { earliestDate: '2026-07-01' },
        },
        pendingResolutionCount: 0,
        outcome: { kind: 'failed', reason: 'provider_schema_changed' },
        lifecycleCounts: {
          version: 'connector-run-lifecycle-counts/v1',
          source: 'frozen_terminal',
          scope: {
            kind: 'connector_run',
            connectorRunId: 'pancake-carried-50',
            executionScopeId: 'scope_pancake_jobright',
          },
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
            findingsAdded: 0,
            canonicalDuplicates: 0,
            notFit: 0,
            rejected: 0,
            actionableReview: 0,
            unclassified: 0,
            invariant: 'reconciled',
          },
        },
        warnings: [{
          code: 'jobright_raw_intake_unavailable',
          label: 'raw label',
          message: 'raw message',
          severity: 'blocked',
        }],
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
      settingsApi={createSettingsApi({ showDebugData: true })}
    />)
    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()

    expect(await screen.findByText('Stage-specific synchronization counts')).toBeInTheDocument()
    expect(screen.getByText('Provider returned rows: 0')).toBeInTheDocument()
    expect(screen.getByText('Capture lineages: 0')).toBeInTheDocument()
    expect(screen.getByText('Canonical duplicates: 0')).toBeInTheDocument()
    expect(screen.getByText('Opportunities added: 0')).toBeInTheDocument()
    expect(screen.queryByText('Carried connector cycle')).not.toBeInTheDocument()
    expect(screen.queryByText('Discovered jobs: 50')).not.toBeInTheDocument()
    expect(screen.queryByText('Discovery page requests: 3')).not.toBeInTheDocument()
    expect(screen.getAllByText('Failed')).toHaveLength(2)
    expect(screen.queryByText(/Technical status:/)).not.toBeInTheDocument()
    expect(screen.getByText('Provider stats gaps: missing provider valid.')).toBeInTheDocument()
    expect(screen.queryByText('Discovered: 50')).not.toBeInTheDocument()

    const explanation = screen.getByRole('button', { name: 'How these counts work' })
    expect(explanation).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(explanation)
    expect(explanation).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Provider returned rows are response rows, not a unique-job total/)).toBeInTheDocument()
    expect(screen.getByText(/Captures are intake events; Capture lineages are unique persisted provider-record histories/)).toBeInTheDocument()
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
        executionScopeId: 'scope_budget_jobright',
        mode: 'manual',
        scheduleOccurrence: null,
        status: 'skipped',
        filterSignature: 'filters:{}',
        observationCount: 0,
        warningCount: 0,
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'advancing',
          boundary: { earliestDate: '2026-07-01' },
        },
        pendingResolutionCount: 4,
        outcome: { kind: 'yielded', reason: 'invocation_budget' },
        lifecycleCounts: {
          version: 'connector-run-lifecycle-counts/v1',
          source: 'frozen_terminal',
          scope: {
            kind: 'connector_run',
            connectorRunId: 'budget-stop-reason-run',
            executionScopeId: 'scope_budget_jobright',
          },
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
            findingsAdded: 0,
            canonicalDuplicates: 0,
            notFit: 0,
            rejected: 0,
            actionableReview: 0,
            unclassified: 0,
            invariant: 'reconciled',
          },
        },
        warnings: [],
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
      settingsApi={createSettingsApi({ showDebugData: true })}
    />)
    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()

    expect(await screen.findByText('Provider returned rows: 0')).toBeInTheDocument()
    expect(screen.getByText('Capture lineages: 0')).toBeInTheDocument()
    expect(screen.getByText('Pending: 4')).toBeInTheDocument()
    expect(screen.queryByText('Carried connector cycle')).not.toBeInTheDocument()
    expect(screen.queryByText('Discovered jobs: 50')).not.toBeInTheDocument()
    expect(screen.queryByText('Detail attempts: 50')).not.toBeInTheDocument()
    expect(screen.queryByText('Request budget per run: 10')).not.toBeInTheDocument()
    expect(screen.queryByText('Request budget: 50 / 10')).not.toBeInTheDocument()
    expect(screen.queryByText(/Request budget: 50\s*\/\s*10/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Continuing later')).toHaveLength(2)
    expect(screen.queryByText(/Stop reason:/)).not.toBeInTheDocument()
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
        executionScopeId: 'scope_missing_budget_jobright',
        mode: 'manual',
        scheduleOccurrence: null,
        status: 'failed',
        filterSignature: 'filters:{}',
        observationCount: 0,
        warningCount: 0,
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'advancing',
          boundary: { earliestDate: '2026-07-01' },
        },
        pendingResolutionCount: 0,
        outcome: { kind: 'failed', reason: 'provider_schema_changed' },
        lifecycleCounts: {
          version: 'connector-run-lifecycle-counts/v1',
          source: 'frozen_terminal',
          scope: {
            kind: 'connector_run',
            connectorRunId: 'missing-budget-run',
            executionScopeId: 'scope_missing_budget_jobright',
          },
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
            findingsAdded: 0,
            canonicalDuplicates: 0,
            notFit: 0,
            rejected: 0,
            actionableReview: 0,
            unclassified: 0,
            invariant: 'reconciled',
          },
        },
        warnings: [],
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
      settingsApi={createSettingsApi({ showDebugData: true })}
    />)
    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()

    expect(await screen.findByText('Provider returned rows: 0')).toBeInTheDocument()
    expect(screen.getAllByText('Failed')).toHaveLength(2)
    expect(screen.queryByText('Detail attempts: 50')).not.toBeInTheDocument()
    expect(screen.queryByText(/Stop reason:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Request budget per run:/i)).not.toBeInTheDocument()
  })

})
