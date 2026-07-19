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

})