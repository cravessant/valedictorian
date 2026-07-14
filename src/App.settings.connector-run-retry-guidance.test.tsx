import {
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
  createSettingsApi
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

function failedSynchronization() {
  return {
    executionScopeId: 'scope_jobright_default',
    scheduleOccurrence: null,
    newestFrontier: { state: 'not_started' as const },
    historicalBackfill: {
      state: 'not_started' as const,
      boundary: { earliestDate: '2026-07-01' },
    },
    pendingResolutionCount: 0,
    outcome: { kind: 'failed' as const, reason: 'provider_schema_changed' },
  }
}


describe('connector-run retry guidance', () => {
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
          ...failedSynchronization(),
          mode: 'manual',
          status: 'failed',
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
          retryHints: null,
          startedAt: '2026-07-09T18:00:00.000Z',
          completedAt: '2026-07-09T18:00:01.000Z',
        },
        {
          id: 'connector-run-discovery-failed',
          connectorInstanceId: 'jobright-default',
          ...failedSynchronization(),
          mode: 'manual',
          status: 'failed',
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
          retryHints: null,
          startedAt: '2026-07-09T17:00:00.000Z',
          completedAt: '2026-07-09T17:00:01.000Z',
        },
        {
          id: 'connector-run-parser-changed',
          connectorInstanceId: 'jobright-default',
          ...failedSynchronization(),
          mode: 'manual',
          status: 'failed',
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
          retryHints: null,
          startedAt: '2026-07-09T16:00:00.000Z',
          completedAt: '2026-07-09T16:00:01.000Z',
        },
        {
          id: 'connector-run-zero-results',
          connectorInstanceId: 'jobright-default',
          ...failedSynchronization(),
          mode: 'manual',
          status: 'failed',
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
          retryHints: null,
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

  it('renders explicit Jobright discovery outcomes with operator guidance', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.12.0',
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
          id: 'connector-run-discovery-forbidden',
          connectorInstanceId: 'jobright-default',
          ...failedSynchronization(),
          mode: 'manual',
          status: 'failed',
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
              code: 'jobright_discovery_forbidden',
              label: 'raw sensitive forbidden label',
              message: 'cookie=secret Authorization: Bearer tok https://jobright.ai/api',
              severity: 'warning',
            },
          ],
          retryHints: null,
          startedAt: '2026-07-09T18:00:00.000Z',
          completedAt: '2026-07-09T18:00:01.000Z',
        },
        {
          id: 'connector-run-discovery-client-error',
          connectorInstanceId: 'jobright-default',
          ...failedSynchronization(),
          mode: 'manual',
          status: 'failed',
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
              code: 'jobright_discovery_http_client_error',
              label: 'raw sensitive client error label',
              message: 'HTTP 400 providerCode=PRIVATE_CODE body=leaked',
              severity: 'warning',
            },
          ],
          retryHints: null,
          startedAt: '2026-07-09T17:00:00.000Z',
          completedAt: '2026-07-09T17:00:01.000Z',
        },
        {
          id: 'connector-run-discovery-http-non-success',
          connectorInstanceId: 'jobright-default',
          ...failedSynchronization(),
          mode: 'manual',
          status: 'failed',
          coverage: {
            start: '2026-07-09T15:00:00.000Z',
            end: '2026-07-09T16:00:00.000Z',
          },
          filterSignature: 'filters:{}',
          observationCount: 0,
          warningCount: 1,
          stats: {},
          warnings: [
            {
              code: 'jobright_discovery_http_non_success',
              label: 'raw sensitive non-success label',
              message: 'HTTP 502 session=abc response body',
              severity: 'warning',
            },
          ],
          retryHints: null,
          startedAt: '2026-07-09T16:00:00.000Z',
          completedAt: '2026-07-09T16:00:01.000Z',
        },
        {
          id: 'connector-run-discovery-non-success',
          connectorInstanceId: 'jobright-default',
          ...failedSynchronization(),
          mode: 'manual',
          status: 'failed',
          coverage: {
            start: '2026-07-09T14:00:00.000Z',
            end: '2026-07-09T15:00:00.000Z',
          },
          filterSignature: 'filters:{}',
          observationCount: 0,
          warningCount: 1,
          stats: {},
          warnings: [
            {
              code: 'jobright_discovery_non_success',
              label: 'raw sensitive provider envelope label',
              message: 'provider message=do-not-show',
              severity: 'warning',
            },
          ],
          retryHints: null,
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

    expect(await screen.findByText('Jobright discovery forbidden')).toBeInTheDocument()
    expect(screen.getByText('Jobright discovery request error')).toBeInTheDocument()
    expect(screen.getByText('Jobright discovery non-success')).toBeInTheDocument()
    expect(screen.getByText('Jobright discovery rejected')).toBeInTheDocument()
    expect(screen.getByText(
      'Jobright denied discovery access. Review provider access policy and connector configuration, then run again.',
    )).toBeInTheDocument()
    expect(screen.getByText(
      'Jobright rejected the discovery request. Check the request contract and connector configuration, then run again.',
    )).toBeInTheDocument()
    expect(screen.getByText(
      'Jobright discovery returned a non-success response. Check provider availability and the request contract, then run again.',
    )).toBeInTheDocument()
    expect(screen.getByText(
      'Jobright discovery returned a provider non-success result. Check provider availability and access policy, then run again.',
    )).toBeInTheDocument()
    expect(screen.queryByText('Connector warning')).not.toBeInTheDocument()
    expect(screen.queryByText('Review the connector configuration and run again.')).not.toBeInTheDocument()
    expect(screen.queryByText('Retry the Jobright run later with backoff.')).not.toBeInTheDocument()
    expect(screen.queryByText(/raw sensitive|cookie=secret|Bearer tok|https:\/\/jobright\.ai|PRIVATE_CODE|session=abc|do-not-show/i))
      .not.toBeInTheDocument()
  })

  it('renders persisted cooldown timing separately from failure', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'retry-ui', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Retry fixture', enabled: true, auth: [], config: {}, filters: {},
    })
    const retryAt = '2026-07-11T12:01:00.000Z'
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      hasMore: false, limit: 20, offset: 0, total: 1,
      items: [{
        id: 'retry-not-due', connectorInstanceId: 'retry-ui', mode: 'manual', status: 'skipped',
        executionScopeId: 'scope_retry_ui', scheduleOccurrence: null,
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'advancing', boundary: { earliestDate: '2026-07-01' },
        },
        pendingResolutionCount: 0,
        outcome: {
          kind: 'cooling_down',
          operation: {
            kind: 'scope_rate_limited', executionScopeId: 'scope_retry_ui',
            retryAt, serverMinimumDelayMs: null,
          },
        },
        filterSignature: 'filters:{}',
        observationCount: 0, warningCount: 0, warnings: [],
        startedAt: '2026-07-11T12:00:30.000Z', completedAt: '2026-07-11T12:00:30.000Z',
      }],
    })

    render(<App applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
      connectorsApi={connectorsApi} settingsApi={createSettingsApi()} />)
    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()

    const status = await screen.findByRole('status', { name: 'Connector synchronization state' })
    expect(status).toHaveTextContent('Cooling down')
    expect(status).toHaveTextContent(`Next attempt ${new Date(retryAt).toLocaleString()}`)
    expect(status).not.toHaveTextContent(/failed|stuck/i)
  })

})
