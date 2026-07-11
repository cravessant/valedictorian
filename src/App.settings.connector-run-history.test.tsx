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
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  createWorkspaceApi,
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

function mockNarrowViewport() {
  const mediaQueryList = {
    matches: true,
    media: '(max-width: 767px)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList

  vi.stubGlobal('matchMedia', vi.fn(() => mediaQueryList))
}

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

describe('App settings and chrome', () => {
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
          retryHints: {
            reason: 'auth_required',
            sessionKey: 'sensitive-session-key',
          },
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
    expect(screen.getByText('partial_success')).toBeInTheDocument()
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
        status: 'partial_success',
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
    expect(screen.getByText('Technical status: partial success.')).toBeInTheDocument()
    expect(screen.getByText('Provider stats gaps: missing provider valid.')).toBeInTheDocument()
    expect(screen.queryByText('Discovered: 50')).not.toBeInTheDocument()

    const explanation = screen.getByRole('button', { name: 'How these counts work' })
    expect(explanation).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(explanation)
    expect(explanation).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Returned rows equal valid unique records plus invalid rows plus source duplicates/)).toBeInTheDocument()
  })

  it('makes request budget and stop reason explicit without relabeling carried discovery counts', async () => {
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
        status: 'partial_success',
        coverage: { start: null, end: null },
        filterSignature: 'filters:{}',
        observationCount: 0,
        warningCount: 0,
        stats: {
          attempted: 50,
          discovered: 50,
          discoveryPages: 3,
          maxRequestsPerRun: 10,
          providerReturned: 0,
          remainingTarget: 100,
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
    expect(screen.getByText('Request budget per run: 10')).toBeInTheDocument()
    expect(screen.queryByText('Request budget: 50 / 10')).not.toBeInTheDocument()
    expect(screen.queryByText(/Request budget: 50\s*\/\s*10/)).not.toBeInTheDocument()
    expect(screen.getByText('Stop reason: soft_batch_boundary')).toBeInTheDocument()
    expect(screen.getByText('Paused at a finite batch boundary')).toBeInTheDocument()
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
        status: 'partial_success',
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

  it('renders actionable Jobright failure and retry guidance', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [],
      config: {},
      filters: {},
    })
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      hasMore: false,
      items: [
        {
          id: 'connector-run-auth-failed',
          connectorInstanceId: 'jobright-default',
          mode: 'manual',
          status: 'partial_success',
          coverage: {
            start: '2026-07-09T17:00:00.000Z',
            end: '2026-07-09T18:00:00.000Z',
          },
          filterSignature: 'filters:{}',
          observationCount: 0,
          warningCount: 1,
          stats: {},
          warnings: [
            {
              code: 'jobright_auth_failed',
              label: 'raw sensitive label',
              message: 'raw sensitive auth failure details',
              severity: 'blocked',
            },
          ],
          retryHints: {
            recommended: false,
            source: 'jobright',
          },
          startedAt: '2026-07-09T18:00:00.000Z',
          completedAt: '2026-07-09T18:00:01.000Z',
        },
        {
          id: 'connector-run-discovery-failed',
          connectorInstanceId: 'jobright-default',
          mode: 'manual',
          status: 'partial_success',
          coverage: {
            start: '2026-07-09T16:00:00.000Z',
            end: '2026-07-09T17:00:00.000Z',
          },
          filterSignature: 'filters:{}',
          observationCount: 0,
          warningCount: 1,
          stats: {},
          warnings: [
            {
              code: 'jobright_discovery_failed',
              label: 'raw sensitive label',
              message: 'raw sensitive discovery failure details',
              severity: 'warning',
            },
          ],
          retryHints: {
            recommended: false,
            source: 'jobright',
          },
          startedAt: '2026-07-09T17:00:00.000Z',
          completedAt: '2026-07-09T17:00:01.000Z',
        },
        {
          id: 'connector-run-parser-changed',
          connectorInstanceId: 'jobright-default',
          mode: 'manual',
          status: 'partial_success',
          coverage: {
            start: '2026-07-09T15:00:00.000Z',
            end: '2026-07-09T16:00:00.000Z',
          },
          filterSignature: 'filters:{}',
          observationCount: 0,
          warningCount: 1,
          stats: { parserChanged: 1 },
          warnings: [
            {
              code: 'jobright_parser_changed',
              label: 'raw sensitive label',
              message: 'raw sensitive response details',
              severity: 'warning',
            },
          ],
          retryHints: {
            actions: ['update_jobright_parser'],
            parserChanged: 1,
            recommended: true,
            source: 'jobright',
          },
          startedAt: '2026-07-09T16:00:00.000Z',
          completedAt: '2026-07-09T16:00:01.000Z',
        },
        {
          id: 'connector-run-zero-results',
          connectorInstanceId: 'jobright-default',
          mode: 'manual',
          status: 'partial_success',
          coverage: {
            start: '2026-07-09T14:00:00.000Z',
            end: '2026-07-09T15:00:00.000Z',
          },
          filterSignature: 'filters:{}',
          observationCount: 1,
          warningCount: 1,
          stats: { attempted: 1, resolved: 0 },
          warnings: [
            {
              code: 'jobright_zero_useful_results',
              label: 'raw sensitive label',
              message: 'raw sensitive URL details',
              severity: 'warning',
            },
          ],
          retryHints: {
            actions: ['review_jobright_results'],
            recommended: true,
            source: 'jobright',
          },
          startedAt: '2026-07-09T15:00:00.000Z',
          completedAt: '2026-07-09T15:00:01.000Z',
        },
      ],
      limit: 20,
      offset: 0,
      total: 4,
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

    expect(await screen.findByText('Jobright authentication failed')).toBeInTheDocument()
    expect(screen.getByText('Jobright discovery failed')).toBeInTheDocument()
    expect(screen.getByText(
      'Jobright authentication failed. Validate credentials and retry the run.',
    )).toBeInTheDocument()
    expect(screen.getByText(
      'Jobright discovery failed. Review API availability and connector configuration, then run again.',
    )).toBeInTheDocument()
    expect(screen.getByText('Jobright API changed')).toBeInTheDocument()
    expect(screen.getByText('No usable Jobright URLs')).toBeInTheDocument()
    expect(screen.getByText('Update the Jobright API parser, then run again.')).toBeInTheDocument()
    expect(screen.getByText(
      'Review unresolved Jobright results and URL normalization, then run again.',
    )).toBeInTheDocument()
    expect(screen.queryByText(/raw sensitive/i)).not.toBeInTheDocument()
  })

  it('keeps settings navigation responsive without squeezing the content column', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    const shell = navigation.parentElement

    expect(shell).toHaveClass(
      'grid-cols-1',
      'grid-rows-1',
      'md:grid-cols-[280px_1fr]',
    )
    expect(shell).not.toHaveClass('grid-rows-[auto_1fr]')
    expect(navigation).toHaveClass(
      'absolute',
      'left-0',
      'top-0',
      'z-40',
      'h-full',
      'w-[280px]',
      'max-w-[85vw]',
      'border-r',
      'md:static',
      'md:h-[calc(100vh-3rem)]',
      'md:max-w-none',
    )
    expect(navigation).not.toHaveClass('h-auto', 'max-h-72', 'w-full', 'border-b')
  })

  it('opens settings navigation as the same narrow drawer and closes it after panel changes', async () => {
    mockNarrowViewport()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'settings')
    expect(screen.getByTestId('app-shell')).toHaveAttribute(
      'data-sidebar-state',
      'drawer-closed',
    )
    expect(
      screen.queryByRole('complementary', { name: 'Settings navigation' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))

    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    expect(navigation).toHaveClass(
      'absolute',
      'left-0',
      'top-0',
      'z-40',
      'h-full',
      'w-[280px]',
      'max-w-[85vw]',
    )

    fireEvent.click(within(navigation).getByRole('button', { name: 'Appearance' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute(
      'data-sidebar-state',
      'drawer-closed',
    )
    expect(
      screen.queryByRole('complementary', { name: 'Settings navigation' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
  })

  it('renders functional settings panels and coming-later sidebar items', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi()}
      />,
    )

    await openSettingsPage()

    const settingsSidebar = screen.getByRole('complementary', { name: 'Settings navigation' })
    const settingsNavigation = within(settingsSidebar).getByRole('navigation', {
      name: 'Settings sections',
    })
    expect(
      within(settingsNavigation)
        .getAllByRole('button')
        .slice(0, 3)
        .map((button) => button.textContent),
    ).toEqual(['Profile', 'General', 'Appearance'])

    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Local desktop' })).toBeInTheDocument()
    expect(screen.getByLabelText('Show advanced filters')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Configuration' }))

    expect(screen.getByLabelText('Remote API URL')).toBeInTheDocument()
    expect(screen.getByLabelText('Local API host')).toBeInTheDocument()
    expect(screen.getByLabelText('Local API port')).toBeInTheDocument()
    expect(screen.getByLabelText('API token')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Data' }))

    expect(screen.getByRole('heading', { name: 'Data' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('Workspace path')).toHaveValue('/Users/keni/Job Search')
    })
    expect(screen.getByLabelText('SQLite path')).toHaveValue('/Users/keni/Job Search/.valedictorian/valedictorian.sqlite')
    expect(screen.getByRole('button', { name: 'Choose workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reveal workspace' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Agent access' }))

    expect(screen.getByText('Local API is available in local-shared mode.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'VALEDICTORIAN_API_URL=http://127.0.0.1:4317 valedictorian-cli --json workspaces list',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/applications list --workspace workspace-1/)).toBeInTheDocument()
    expect(screen.getByText(/Tailscale/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))

    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByLabelText('Show advanced filters')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))

    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Full name')).toBeInTheDocument()
  })

  it('persists full-page settings changes and marks backend changes for restart', async () => {
    const settingsApi = createSettingsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()

    fireEvent.click(screen.getByRole('radio', { name: 'Remote' }))

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({ runtimeMode: 'remote' })
    })
    expect(screen.getByText('Restart required')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Show advanced filters'))

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({ showAdvancedFilters: true })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))

    expect(await screen.findByLabelText('Status')).toBeInTheDocument()
  })

})
