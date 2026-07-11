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
}

describe('App settings and chrome', () => {
  it('renders the home page inside a left app sidebar with settings at the bottom', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    const sidebar = screen.getByRole('complementary', { name: 'Application navigation' })
    const shell = sidebar.parentElement

    expect(shell).toHaveClass(
      'grid-cols-1',
      'grid-rows-1',
      'md:grid-cols-[280px_1fr]',
    )
    expect(shell).not.toHaveClass('grid-rows-[auto_1fr]')
    expect(shell).toHaveClass('h-[calc(100vh-3rem)]')
    expect(sidebar).toHaveClass('absolute', 'left-0', 'top-0', 'z-40', 'border-r')
    expect(sidebar).toHaveClass(
      'h-full',
      'w-[280px]',
      'max-w-[85vw]',
      'md:static',
      'md:h-[calc(100vh-3rem)]',
      'md:max-w-none',
    )
    expect(sidebar).not.toHaveClass('h-auto', 'max-h-72', 'w-full', 'border-b')
    expect(sidebar).not.toHaveClass('min-h-[calc(100vh-3rem)]')
    expect(within(sidebar).getByRole('button', { name: 'Applications' })).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: 'Settings' })).toBeInTheDocument()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  it('opens a top-level profile page from the app sidebar shortcut', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={createProfileApi()}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    const sidebar = screen.getByRole('complementary', { name: 'Application navigation' })
    const appNavigation = within(sidebar).getByRole('navigation', { name: 'Application views' })
    expect(
      within(appNavigation).getAllByRole('button').map((button) => button.textContent),
    ).toEqual(['Profile', 'Applications', 'Action Queue', 'Sourcing', 'Connectors'])

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Profile' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'profile')
    expect(
      within(screen.getByRole('banner', { name: 'App chrome' })).getByText('Profile'),
    ).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Application navigation' })).toBeInTheDocument()
    expect(
      screen.queryByRole('complementary', { name: 'Settings navigation' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('nests Connectors Overview under a one-level Connectors group', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorStatusLoader={() => Promise.resolve(createConnectorStatusResult([]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    const appNavigation = within(
      screen.getByRole('complementary', { name: 'Application navigation' }),
    ).getByRole('navigation', { name: 'Application views' })

    expect(
      within(appNavigation).getAllByRole('button').map((button) => button.textContent),
    ).toEqual(['Profile', 'Applications', 'Action Queue', 'Sourcing', 'Connectors'])

    fireEvent.click(within(appNavigation).getByRole('button', { name: 'Connectors' }))

    expect(
      within(appNavigation).getAllByRole('button').map((button) => button.textContent),
    ).toEqual([
      'Profile',
      'Applications',
      'Action Queue',
      'Sourcing',
      'Connectors',
      'Overview',
      'Runs',
    ])

    fireEvent.click(within(appNavigation).getByRole('button', { name: 'Overview' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'connectors')
    expect(
      within(screen.getByRole('banner', { name: 'App chrome' })).getByText('Connectors'),
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Connectors' })).toBeInTheDocument()
    expect(within(appNavigation).getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(appNavigation).getByRole('button', { name: 'Runs' })).not.toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      screen.queryByRole('complementary', { name: 'Settings navigation' }),
    ).not.toBeInTheDocument()
  })

  it('exposes Connectors disclosure semantics with Overview then Runs keyboard order', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorStatusLoader={() => Promise.resolve(createConnectorStatusResult([]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    const appNavigation = within(
      screen.getByRole('complementary', { name: 'Application navigation' }),
    ).getByRole('navigation', { name: 'Application views' })
    const connectorsToggle = within(appNavigation).getByRole('button', { name: 'Connectors' })

    expect(connectorsToggle).toHaveAttribute('aria-expanded', 'false')
    expect(connectorsToggle).toHaveAttribute('aria-controls')
    const childrenId = connectorsToggle.getAttribute('aria-controls')
    expect(childrenId).toBeTruthy()
    expect(document.getElementById(childrenId!)).not.toBeInTheDocument()

    fireEvent.click(connectorsToggle)

    expect(connectorsToggle).toHaveAttribute('aria-expanded', 'true')
    const children = document.getElementById(childrenId!)
    expect(children).toBeInTheDocument()
    expect(connectorsToggle).toHaveAttribute('aria-controls', childrenId)

    const overview = within(appNavigation).getByRole('button', { name: 'Overview' })
    const runs = within(appNavigation).getByRole('button', { name: 'Runs' })
    expect(children!.contains(overview)).toBe(true)
    expect(children!.contains(runs)).toBe(true)

    const buttons = within(appNavigation).getAllByRole('button')
    const connectorsIndex = buttons.indexOf(connectorsToggle)
    expect(buttons[connectorsIndex + 1]).toBe(overview)
    expect(buttons[connectorsIndex + 2]).toBe(runs)

    fireEvent.click(overview)
    expect(connectorsToggle).toHaveAttribute('aria-expanded', 'true')
    expect(overview).toHaveAttribute('aria-current', 'page')
  })

  it('opens Connector Runs from Connectors → Runs without leaving the app sidebar', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        sourcingLoader={() => Promise.resolve(createSourcingResult([]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    const appNavigation = within(
      screen.getByRole('complementary', { name: 'Application navigation' }),
    ).getByRole('navigation', { name: 'Application views' })

    fireEvent.click(within(appNavigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(within(appNavigation).getByRole('button', { name: 'Runs' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'connector-runs')
    expect(
      within(screen.getByRole('banner', { name: 'App chrome' })).getByText('Connector Runs'),
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()
    expect(within(appNavigation).getByRole('button', { name: 'Runs' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(appNavigation).getByRole('button', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      screen.queryByRole('complementary', { name: 'Settings navigation' }),
    ).not.toBeInTheDocument()

    fireEvent.click(within(appNavigation).getByRole('button', { name: 'Sourcing' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'sourcing')
    expect(
      within(screen.getByRole('banner', { name: 'App chrome' })).getByText('Sourcing'),
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Sourcing' })).toBeInTheDocument()
  })

  it('navigates run-specific actions to Connector Runs and focuses the supplied run', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const focusedRun = {
      id: 'connector-run-focus',
      connectorInstanceId: 'jobright-default',
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

    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()
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
      mode: 'manual' as const,
      status: 'running' as const,
      coverage: { start: '2026-07-09T15:00:00.000Z', end: '2026-07-09T16:00:00.000Z' },
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      stats: { discovered: 1, stage: 'discovering' },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: null,
    }
    let listCalls = 0
    vi.mocked(connectorsApi.runs.trigger).mockResolvedValueOnce(runningRun)
    vi.mocked(connectorsApi.runs.list).mockImplementation(async () => {
      listCalls += 1
      if (listCalls <= 2) {
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
          stats: { discovered: 12, stage: 'normalizing' },
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
    expect(await screen.findByText('Latest run: running')).toBeInTheDocument()

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

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100)
    })
    vi.useRealTimers()

    expect(await screen.findByText('Discovered jobs: 12')).toBeInTheDocument()
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
    await authenticateJobrightInSettings({ connectorsApi, profileApi })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: 'View connector-run-page-two in Connector Runs',
    }))

    const focusedArticle = await screen.findByRole('article', { current: true })
    expect(focusedArticle).toHaveAttribute('data-connector-run-id', 'connector-run-page-two')
    expect(focusedArticle).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalled()
    expect(connectorsApi.runs.list).toHaveBeenCalledWith(expect.objectContaining({
      connectorInstanceId: 'jobright-default',
      offset: pageSize,
    }))
  })

  it('shows a clear not-found state when a supplied connector run id is missing', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const recentRun = {
      id: 'connector-run-present',
      connectorInstanceId: 'jobright-default',
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
    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()

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
    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()

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
    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()

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

  it('keeps Settings free of connector run history ownership', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    const settingsNavigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    expect(within(settingsNavigation).queryByRole('button', { name: 'Sourcing runs' }))
      .not.toBeInTheDocument()
    expect(within(settingsNavigation).queryByRole('button', { name: 'Connector Runs' }))
      .not.toBeInTheDocument()
    expect(within(settingsNavigation).getByText('Automation')).toBeInTheDocument()
    expect(within(settingsNavigation).getByRole('button', { name: 'Policy' })).toBeInTheDocument()

    fireEvent.click(within(settingsNavigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'View connector runs' }))

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'connector-runs')
    })
    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()
    expect(
      screen.queryByRole('complementary', { name: 'Settings navigation' }),
    ).not.toBeInTheDocument()
  })

  it('keeps nested Connectors navigation usable in collapsed, hover, and narrow drawer modes', async () => {
    mockNarrowViewport()
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    })

    const { unmount } = render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'drawer-closed')

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    const narrowNav = within(
      screen.getByRole('complementary', { name: 'Application navigation' }),
    ).getByRole('navigation', { name: 'Application views' })
    fireEvent.click(within(narrowNav).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(within(narrowNav).getByRole('button', { name: 'Runs' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'connector-runs')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'drawer-closed')
    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()

    unmount()
    vi.unstubAllGlobals()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi({ sidebarCollapsed: true })}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'collapsed')

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Show sidebar temporarily' }))
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'hover')

    const hoverNav = within(
      screen.getByRole('complementary', { name: 'Application navigation' }),
    ).getByRole('navigation', { name: 'Application views' })
    fireEvent.click(within(hoverNav).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(within(hoverNav).getByRole('button', { name: 'Overview' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'connectors')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'collapsed')
    expect(await screen.findByRole('heading', { name: 'Connectors' })).toBeInTheDocument()
  })

  it('renders custom app chrome around the home view', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    const chrome = screen.getByRole('banner', { name: 'App chrome' })
    const sidebarToggle = within(chrome).getByRole('button', { name: 'Collapse sidebar' })

    expect(chrome).toHaveClass('app-drag')
    expect(chrome).toHaveClass('pl-[4.75rem]')
    expect(chrome).not.toHaveClass('pl-24')
    expect(sidebarToggle).toHaveClass('app-no-drag')
    expect(sidebarToggle).toHaveClass('h-7', 'w-7')
    expect(within(chrome).getByText('Applications')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Forward' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
  })

  it('removes the traffic-light inset from app chrome in fullscreen', async () => {
    Object.defineProperty(window, 'valedictorianWindowChrome', {
      configurable: true,
      value: {
        getState: vi.fn().mockResolvedValue({ isFullScreen: true }),
        onStateChanged: vi.fn(() => () => undefined),
      },
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    const chrome = screen.getByRole('banner', { name: 'App chrome' })

    await waitFor(() => {
      expect(chrome).toHaveClass('pl-3')
    })
    expect(chrome).not.toHaveClass('pl-[4.75rem]')
  })

  it('collapses the sidebar from the topbar and persists the pinned state', async () => {
    const settingsApi = createSettingsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({ sidebarCollapsed: true })
    })
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'collapsed')
    expect(screen.queryByRole('complementary', { name: 'Application navigation' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('keeps the applications table in the content column when the sidebar is collapsed', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi({ sidebarCollapsed: true })}
      />,
    )

    const table = await screen.findByRole('table', { name: 'Applications' })
    const main = table.closest('main')

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'collapsed')
    expect(screen.queryByRole('complementary', { name: 'Application navigation' })).not.toBeInTheDocument()
    expect(main).toHaveClass('md:col-start-2')
  })

  it('temporarily expands a collapsed sidebar on hover and hides it on mouse leave', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi({ sidebarCollapsed: true })}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'collapsed')
    expect(screen.queryByRole('complementary', { name: 'Application navigation' })).not.toBeInTheDocument()

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Show sidebar temporarily' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'hover')
    expect(screen.getByRole('complementary', { name: 'Application navigation' })).toBeInTheDocument()

    fireEvent.mouseLeave(screen.getByRole('complementary', { name: 'Application navigation' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'collapsed')
    expect(screen.queryByRole('complementary', { name: 'Application navigation' })).not.toBeInTheDocument()
  })

  it('pins a hover-expanded sidebar open from the topbar toggle', async () => {
    const settingsApi = createSettingsApi({ sidebarCollapsed: true })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Show sidebar temporarily' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({ sidebarCollapsed: false })
    })
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'expanded')
    expect(screen.getByRole('complementary', { name: 'Application navigation' })).toBeInTheDocument()
  })

})
