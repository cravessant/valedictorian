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

  it('renders persisted not-due retry timing separately from failure', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'retry-ui', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Retry fixture', enabled: true, auth: [], config: {}, filters: {},
    })
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      hasMore: false, limit: 20, offset: 0, total: 1,
      items: [{
        id: 'retry-not-due', connectorInstanceId: 'retry-ui', mode: 'manual', status: 'skipped',
        coverage: { start: null, end: null }, filterSignature: 'filters:{}',
        observationCount: 0, warningCount: 0, stats: { skipped: true }, warnings: [],
        retryHints: {
          state: 'not_due', reason: 'rate_limit', attempt: 2, maxAttempts: 4,
          lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
          nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
        },
        startedAt: '2026-07-11T12:00:30.000Z', completedAt: '2026-07-11T12:00:30.000Z',
      }],
    })

    render(<App applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
      connectorsApi={connectorsApi} settingsApi={createSettingsApi()} />)
    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()

    expect(await screen.findByText(
      `Skipped — not due · Rate limited · Attempt 2 of 4 · Next attempt ${new Date('2026-07-11T12:01:00.000Z').toLocaleString()}`,
    )).toBeInTheDocument()
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument()
  })

})
