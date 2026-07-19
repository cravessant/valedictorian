import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  createSourcingFinding,
  createSourcingResult,
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
}

describe('show debug data setting', () => {
  it('keeps sensitive secret text absent from designated surfaces in both debug modes', async () => {
    const secretApiToken = 'plain-api-token-should-stay-hidden'
    const secretPassword = 'jobright-password-should-stay-hidden'
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    await profileApi.secrets.upsert({
      key: 'connector_jobright_credentials_debug',
      kind: 'password',
      label: 'Jobright username and password',
      value: JSON.stringify({
        username: 'demo@example.com',
        password: secretPassword,
      }),
    })
    await connectorsApi.create({
      id: 'secret-jobright',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Secret Jobright',
      enabled: true,
      auth: [{
        id: 'jobright',
        label: 'Jobright username and password',
        mode: 'username_password',
        secretKey: 'connector_jobright_credentials_debug',
      }],
      config: {},
      filters: {},
    })
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      hasMore: false,
      items: [{
        id: 'secret-run',
        connectorInstanceId: 'secret-jobright',
        executionScopeId: 'scope_secret_jobright',
        mode: 'manual',
        scheduleOccurrence: null,
        status: 'completed',
        coverage: { start: null, end: null },
        filterSignature: 'filters:{}',
        observationCount: 0,
        warningCount: 0,
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'caught_up',
          boundary: { earliestDate: '2026-07-01' },
        },
        pendingResolutionCount: 0,
        outcome: { kind: 'caught_up' },
        stats: {
          discovered: 1,
          password: secretPassword,
          apiToken: secretApiToken,
        },
        warnings: [],
        retryHints: {},
        startedAt: '2026-07-11T14:00:00.000Z',
        completedAt: '2026-07-11T14:00:01.000Z',
      }],
      limit: 20,
      offset: 0,
      total: 1,
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        sourcingLoader={() =>
          Promise.resolve(
            createSourcingResult([
              createSourcingFinding({
                workflowRunId: 'workflow-without-secret',
                mergeStatus: 'merged',
                mergedApplicationId: 'application-without-secret',
                mergedApplicationCompanyName: 'Acme',
                mergedApplicationRoleTitle: 'Intern',
              }),
            ]),
          )
        }
        settingsApi={createSettingsApi({ apiTokenConfigured: true })}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()
    expect(await screen.findByText('Secret Jobright')).toBeInTheDocument()
    expect(screen.queryByText(secretApiToken)).not.toBeInTheDocument()
    expect(screen.queryByText(secretPassword)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    expect(await screen.findByRole('table', { name: 'Opportunities' })).toBeInTheDocument()
    expect(screen.queryByText(secretApiToken)).not.toBeInTheDocument()
    expect(screen.queryByText(secretPassword)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Developer settings' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show debug data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))

    openConnectorRuns()
    expect(await screen.findByText('Carried connector cycle')).toBeInTheDocument()
    expect(screen.queryByText(secretApiToken)).not.toBeInTheDocument()
    expect(screen.queryByText(secretPassword)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    expect(await screen.findByText('workflow-without-secret')).toBeInTheDocument()
    expect(screen.queryByText(secretApiToken)).not.toBeInTheDocument()
    expect(screen.queryByText(secretPassword)).not.toBeInTheDocument()
    expect(Object.keys(profileApi.secrets)).not.toContain('reveal')
  })
})
