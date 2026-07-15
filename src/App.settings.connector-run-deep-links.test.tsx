import {
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
  createConnectorsApiWithJobrightDescriptor as createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  lastCreatedConnectorInstanceId,
  selectSoftwareEngineeringTaxonomy,
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

function openConnectorsOverview() {
  const appNavigation = within(
    screen.getByRole('complementary', { name: 'Application navigation' }),
  ).getByRole('navigation', { name: 'Application views' })
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Connectors' }))
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Overview' }))
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
  await selectSoftwareEngineeringTaxonomy()
  fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
  fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
  })
}

function continuousSynchronization(status: 'completed' | 'running') {
  return {
    executionScopeId: 'scope_jobright_default',
    scheduleOccurrence: null,
    newestFrontier: { state: status === 'running' ? 'advancing' as const : 'caught_up' as const },
    historicalBackfill: {
      state: 'not_started' as const,
      boundary: { earliestDate: '2026-07-01' },
    },
    pendingResolutionCount: 0,
    outcome: status === 'running'
      ? { kind: 'in_progress' as const }
      : { kind: 'caught_up' as const },
  }
}

describe('connector-run deep links', () => {
  it('navigates run-specific actions to Connector Runs and focuses the supplied run', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const focusedRun = {
      id: 'connector-run-focus',
      connectorInstanceId: 'jobright-default',
      ...continuousSynchronization('completed'),
      mode: 'manual' as const,
      status: 'completed' as const,
      coverage: { start: '2026-07-09T15:00:00.000Z', end: '2026-07-09T16:00:00.000Z' },
      filterSignature: 'filters:{}',
      observationCount: 1,
      warningCount: 0,
      stats: { stage: 'finalizing' },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
    }
    const otherRun = {
      ...focusedRun,
      id: 'connector-run-other',
      startedAt: '2026-07-09T15:00:00.000Z',
      completedAt: '2026-07-09T15:00:01.000Z',
    }
    vi.mocked(connectorsApi.runs.trigger).mockResolvedValueOnce(focusedRun)
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      items: [focusedRun, otherRun],
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
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    const appNavigation = within(
      screen.getByRole('complementary', { name: 'Application navigation' }),
    ).getByRole('navigation', { name: 'Application views' })
    fireEvent.click(within(appNavigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(within(appNavigation).getByRole('button', { name: 'Overview' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await authenticateJobrightInSettings({ connectorsApi, profileApi })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByText('Latest synchronization: Caught up')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View connector runs' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: 'View connector-run-focus in Connector Runs',
    }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'connector-runs')
    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()
    expect(
      screen.queryByRole('complementary', { name: 'Settings navigation' }),
    ).not.toBeInTheDocument()

    const focusedArticle = await screen.findByRole('article', { current: true })
    expect(focusedArticle).toHaveAttribute('data-connector-run-id', 'connector-run-focus')
    expect(focusedArticle).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('focuses a supplied connector run only once across polling updates', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const runningRun = {
      id: 'connector-run-poll-focus',
      connectorInstanceId: 'jobright-default',
      ...continuousSynchronization('running'),
      mode: 'manual' as const,
      status: 'running' as const,
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      warnings: [],
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: null,
    }
    let listCalls = 0
    let releaseProgressUpdate = false
    vi.mocked(connectorsApi.runs.trigger).mockResolvedValueOnce(runningRun)
    vi.mocked(connectorsApi.runs.list).mockImplementation(async () => {
      listCalls += 1
      if (!releaseProgressUpdate) {
        return {
          items: [runningRun],
          total: 1,
          limit: 20,
          offset: 0,
          hasMore: false,
        }
      }
      return {
        items: [{
          ...runningRun,
          observationCount: 4,
          pendingResolutionCount: 12,
          newestFrontier: { state: 'caught_up' as const },
          historicalBackfill: {
            state: 'caught_up' as const,
            boundary: { earliestDate: '2026-07-01' },
          },
        }],
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      }
    })
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await authenticateJobrightInSettings({ connectorsApi, profileApi })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    expect(await screen.findByText('Latest synchronization: Checking newest')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: 'View connector-run-poll-focus in Connector Runs',
    }))

    const focusedArticle = await screen.findByRole('article', { current: true })
    expect(focusedArticle).toHaveAttribute('data-connector-run-id', 'connector-run-poll-focus')
    expect(focusedArticle).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    const focusCallsAfterLanding = scrollIntoView.mock.calls.length

    const elsewhere = document.createElement('button')
    elsewhere.textContent = 'elsewhere'
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    expect(elsewhere).toHaveFocus()

    releaseProgressUpdate = true
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Connector synchronization state' }))
        .toHaveTextContent('Resolving links')
      expect(screen.getByRole('status', { name: 'Connector synchronization state' }))
        .toHaveTextContent('Pending link resolution: 12')
    }, { timeout: 2_500 })
    expect(scrollIntoView).toHaveBeenCalledTimes(focusCallsAfterLanding)
    expect(elsewhere).toHaveFocus()
    expect(screen.getByRole('article', { current: true })).toHaveAttribute(
      'data-connector-run-id',
      'connector-run-poll-focus',
    )

    elsewhere.remove()
  })

  it('finds a supplied connector run on a later page and focuses it', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const pageSize = 20
    const olderFocusedRun = {
      id: 'connector-run-page-two',
      connectorInstanceId: 'jobright-default',
      ...continuousSynchronization('completed'),
      mode: 'manual' as const,
      status: 'completed' as const,
      coverage: { start: '2026-07-08T15:00:00.000Z', end: '2026-07-08T16:00:00.000Z' },
      filterSignature: 'filters:{}',
      observationCount: 2,
      warningCount: 0,
      stats: { stage: 'finalizing' },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
    }
    const recentRuns = Array.from({ length: pageSize }, (_, index) => ({
      ...olderFocusedRun,
      id: `connector-run-recent-${index}`,
      startedAt: `2026-07-09T${String(10 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z`,
      completedAt: `2026-07-09T${String(10 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:01.000Z`,
    }))
    vi.mocked(connectorsApi.runs.trigger).mockResolvedValueOnce(olderFocusedRun)
    vi.mocked(connectorsApi.runs.list).mockImplementation(async (input) => {
      const offset = input.offset ?? 0
      const limit = input.limit ?? pageSize
      if (limit === 1) {
        return {
          items: [olderFocusedRun],
          total: pageSize + 1,
          limit: 1,
          offset: 0,
          hasMore: true,
        }
      }
      if (offset === 0) {
        return {
          items: recentRuns.slice(0, limit),
          total: pageSize + 1,
          limit,
          offset: 0,
          hasMore: true,
        }
      }
      if (offset === pageSize) {
        return {
          items: [olderFocusedRun],
          total: pageSize + 1,
          limit,
          offset: pageSize,
          hasMore: false,
        }
      }
      return {
        items: [],
        total: pageSize + 1,
        limit,
        offset,
        hasMore: false,
      }
    })
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await waitFor(() => expect(connectorsApi.create).toHaveBeenCalled())
    const instanceId = lastCreatedConnectorInstanceId(connectorsApi)
    await authenticateJobrightInSettings({ connectorsApi, profileApi })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    expect(await screen.findByText('Latest synchronization: Caught up')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: 'View connector-run-page-two in Connector Runs',
    }))

    const focusedArticle = await screen.findByRole('article', { current: true })
    expect(focusedArticle).toHaveAttribute('data-connector-run-id', 'connector-run-page-two')
    expect(focusedArticle).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalled()
    expect(connectorsApi.runs.list).toHaveBeenCalledWith(expect.objectContaining({
      connectorInstanceId: instanceId,
      offset: pageSize,
    }))
  })

  it('shows a clear not-found state when a supplied connector run id is missing', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const recentRun = {
      id: 'connector-run-present',
      connectorInstanceId: 'jobright-default',
      ...continuousSynchronization('completed'),
      mode: 'manual' as const,
      status: 'completed' as const,
      coverage: { start: '2026-07-09T15:00:00.000Z', end: '2026-07-09T16:00:00.000Z' },
      filterSignature: 'filters:{}',
      observationCount: 1,
      warningCount: 0,
      stats: { stage: 'finalizing' },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
    }
    const missingRun = {
      ...recentRun,
      id: 'connector-run-missing',
    }
    vi.mocked(connectorsApi.runs.trigger).mockResolvedValueOnce(missingRun)
    vi.mocked(connectorsApi.runs.list).mockImplementation(async (input) => {
      if ((input.limit ?? 20) === 1) {
        return {
          items: [missingRun],
          total: 1,
          limit: 1,
          offset: 0,
          hasMore: false,
        }
      }
      return {
        items: [recentRun],
        total: 1,
        limit: input.limit ?? 20,
        offset: input.offset ?? 0,
        hasMore: false,
      }
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await authenticateJobrightInSettings({ connectorsApi, profileApi })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    expect(await screen.findByText('Latest synchronization: Caught up')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: 'View connector-run-missing in Connector Runs',
    }))

    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be found/i)
    expect(screen.queryByRole('article', { current: true })).not.toBeInTheDocument()
    expect(screen.getByText('Jobright internslist')).toBeInTheDocument()
  })

  it('reports search-limit-reached instead of not-found when more history remains past the cap', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const pageSize = 20
    const maxFocusPages = 25
    const deepRun = {
      id: 'connector-run-beyond-cap',
      connectorInstanceId: 'jobright-default',
      ...continuousSynchronization('completed'),
      mode: 'manual' as const,
      status: 'completed' as const,
      coverage: { start: '2026-06-01T15:00:00.000Z', end: '2026-06-01T16:00:00.000Z' },
      filterSignature: 'filters:{}',
      observationCount: 1,
      warningCount: 0,
      stats: { stage: 'finalizing' },
      warnings: [],
      retryHints: null,
      startedAt: '2026-06-01T16:00:00.000Z',
      completedAt: '2026-06-01T16:00:01.000Z',
    }
    const pageZeroRuns = Array.from({ length: pageSize }, (_, index) => ({
      ...deepRun,
      id: `connector-run-cap-recent-${index}`,
      startedAt: `2026-07-09T${String(10 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z`,
      completedAt: `2026-07-09T${String(10 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:01.000Z`,
    }))
    vi.mocked(connectorsApi.runs.trigger).mockResolvedValueOnce(deepRun)
    vi.mocked(connectorsApi.runs.list).mockImplementation(async (input) => {
      const offset = input.offset ?? 0
      const limit = input.limit ?? pageSize
      if (limit === 1) {
        return {
          items: [deepRun],
          total: pageSize * (maxFocusPages + 5),
          limit: 1,
          offset: 0,
          hasMore: true,
        }
      }
      return {
        items: offset === 0
          ? pageZeroRuns
          : Array.from({ length: pageSize }, (_, index) => ({
            ...deepRun,
            id: `connector-run-cap-page-${offset}-${index}`,
            startedAt: `2026-07-08T10:${String(index).padStart(2, '0')}:00.000Z`,
            completedAt: `2026-07-08T10:${String(index).padStart(2, '0')}:01.000Z`,
          })),
        total: pageSize * (maxFocusPages + 5),
        limit,
        offset,
        hasMore: true,
      }
    })
    HTMLElement.prototype.scrollIntoView = vi.fn()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await authenticateJobrightInSettings({ connectorsApi, profileApi })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    expect(await screen.findByText('Latest synchronization: Caught up')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: 'View connector-run-beyond-cap in Connector Runs',
    }))

    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()
    const limitMessage = await screen.findByRole('status', {
      name: /recent-history window/i,
    })
    expect(limitMessage).toHaveTextContent(/not located within the searched recent-history window/i)
    expect(limitMessage).toHaveTextContent(/more history/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/could not be found/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Connector run not found' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { current: true })).not.toBeInTheDocument()
    for (const article of screen.getAllByRole('article')) {
      expect(article).not.toHaveAttribute('aria-current')
      expect(article).not.toHaveClass('ring-2')
    }

    const historyListCalls = vi.mocked(connectorsApi.runs.list).mock.calls.filter(([input]) =>
      (input.limit ?? pageSize) === pageSize)
    expect(historyListCalls).toHaveLength(maxFocusPages)
    expect(historyListCalls.map(([input]) => input.offset ?? 0)).toEqual(
      Array.from({ length: maxFocusPages }, (_, index) => index * pageSize),
    )
    expect(connectorsApi.runs.list).not.toHaveBeenCalledWith(expect.objectContaining({
      limit: pageSize,
      offset: maxFocusPages * pageSize,
    }))
  })

  it('clears stale connector run focus when navigating to Connectors → Runs', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const focusedRun = {
      id: 'connector-run-stale-focus',
      connectorInstanceId: 'jobright-default',
      ...continuousSynchronization('completed'),
      mode: 'manual' as const,
      status: 'completed' as const,
      coverage: { start: '2026-07-09T15:00:00.000Z', end: '2026-07-09T16:00:00.000Z' },
      filterSignature: 'filters:{}',
      observationCount: 1,
      warningCount: 0,
      stats: { stage: 'finalizing' },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
    }
    vi.mocked(connectorsApi.runs.trigger).mockResolvedValueOnce(focusedRun)
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      items: [focusedRun],
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    })
    HTMLElement.prototype.scrollIntoView = vi.fn()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await authenticateJobrightInSettings({ connectorsApi, profileApi })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    expect(await screen.findByText('Latest synchronization: Caught up')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: 'View connector-run-stale-focus in Connector Runs',
    }))

    expect(await screen.findByRole('article', { current: true })).toHaveAttribute(
      'data-connector-run-id',
      'connector-run-stale-focus',
    )

    const appNavigation = within(
      screen.getByRole('complementary', { name: 'Application navigation' }),
    ).getByRole('navigation', { name: 'Application views' })
    fireEvent.click(within(appNavigation).getByRole('button', { name: 'Runs' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'connector-runs')
    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { current: true })).not.toBeInTheDocument()
    expect(screen.getByRole('article')).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('article')).not.toHaveClass('ring-2')
  })

})
