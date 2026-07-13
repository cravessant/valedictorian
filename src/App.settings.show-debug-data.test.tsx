import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
  openSettingsPage,
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
  it('exposes a labeled Developer settings Switch that persists showDebugData', async () => {
    const settingsApi = createSettingsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()

    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Developer settings' }))

    expect(screen.getByRole('heading', { name: 'Developer settings' })).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Show debug data' })
    expect(toggle).toHaveAttribute('data-state', 'unchecked')
    expect(toggle).not.toBeChecked()

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({ showDebugData: true })
    })
    expect(screen.getByRole('switch', { name: 'Show debug data' })).toHaveAttribute(
      'data-state',
      'checked',
    )
  })

  it('hides sourcing raw diagnostic ids by default and reveals them when enabled', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        sourcingLoader={() =>
          Promise.resolve(
            createSourcingResult([
              createSourcingFinding({
                id: 'finding-merged',
                companyName: 'Merged Co',
                workflowRunId: 'workflow-run-debug-1',
                mergeStatus: 'merged',
                mergedApplicationId: 'application-merged-debug',
                mergedApplicationCompanyName: 'Merged Co',
                mergedApplicationRoleTitle: 'Software Engineering Intern',
              }),
            ]),
          )
        }
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))

    const table = await screen.findByRole('table', { name: 'Sourcing findings' })
    expect(within(table).getByText('Merged Co - Software Engineering Intern')).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Open app Merged Co' })).toBeInTheDocument()
    expect(within(table).queryByText('workflow-run-debug-1')).not.toBeInTheDocument()
    expect(within(table).queryByText('application-merged-debug')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Developer settings' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show debug data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))

    const debugTable = await screen.findByRole('table', { name: 'Sourcing findings' })
    expect(within(debugTable).getByText('workflow-run-debug-1')).toBeInTheDocument()
    expect(within(debugTable).getByText('application-merged-debug')).toBeInTheDocument()
    expect(within(debugTable).getByText('Merged Co - Software Engineering Intern')).toBeInTheDocument()
    expect(within(debugTable).getByRole('button', { name: 'Open app Merged Co' })).toBeInTheDocument()
  })

  it('hides connector run advanced diagnostics by default and reveals them when enabled', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'debug-jobright',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Debug Jobright',
      enabled: true,
      auth: [],
      config: {},
      filters: {},
    })
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      hasMore: false,
      items: [{
        id: 'debug-carried-run',
        connectorInstanceId: 'debug-jobright',
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
            scope: { kind: 'connector_run', connectorRunId: 'debug-carried-run' },
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

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )
    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()

    expect(await screen.findByText('Needs action')).toBeInTheDocument()
    expect(screen.getByText('Unique jobs in this connector run')).toBeInTheDocument()
    expect(screen.getByText('Provider returned rows: 0')).toBeInTheDocument()
    expect(screen.queryByText('Frozen at terminal completion.')).not.toBeInTheDocument()
    expect(screen.queryByText('Carried connector cycle')).not.toBeInTheDocument()
    expect(screen.queryByText('Discovered jobs: 50')).not.toBeInTheDocument()
    expect(screen.queryByText('Provider stats gaps: missing provider valid.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'How these counts work' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Developer settings' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show debug data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))
    openConnectorRuns()

    expect(await screen.findByText('Frozen at terminal completion.')).toBeInTheDocument()
    expect(screen.getByText('Carried connector cycle')).toBeInTheDocument()
    expect(screen.getByText('Discovered jobs: 50')).toBeInTheDocument()
    expect(screen.getByText('Provider stats gaps: missing provider valid.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'How these counts work' })).toBeInTheDocument()
    expect(screen.getByText('Needs action')).toBeInTheDocument()
    expect(screen.getByText('Unique jobs in this connector run')).toBeInTheDocument()
  })

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
        mode: 'manual',
        status: 'completed',
        coverage: { start: null, end: null },
        filterSignature: 'filters:{}',
        observationCount: 0,
        warningCount: 0,
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
        settingsApi={createSettingsApi({ apiToken: secretApiToken })}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorRuns()
    expect(await screen.findByText('Secret Jobright')).toBeInTheDocument()
    expect(screen.queryByText(secretApiToken)).not.toBeInTheDocument()
    expect(screen.queryByText(secretPassword)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    expect(await screen.findByRole('table', { name: 'Sourcing findings' })).toBeInTheDocument()
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
