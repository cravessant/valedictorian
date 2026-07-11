import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createConnectorStatusResult,
  createConnectorsApi,
  createListResult,
  createPolicyApi,
  createProfileApi,
  createSettingsApi,
  createSourcingResult,
  createWorkspaceApi,
  openSettingsPage,
} from './App.test-helpers'
import { defaultPolicyConfig } from 'sparxie'
import type { ConnectorsPreloadApi } from './ipc/connectors.preload'
import type { ProfilePreloadApi } from './ipc/profile.preload'
import { createStaticConnectorRegistry } from './modules/connectors/connector.registry'
import type { AppJobConnector } from './modules/connectors/connector.runner'
import { createLocalValedictorianClient } from './runtime/local-valedictorian-client'

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

  it('opens the application navigation as a narrow drawer without stacking it above content', async () => {
    mockNarrowViewport()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    const layout = screen.getByTestId('app-layout')

    expect(layout).toHaveClass('grid-cols-1', 'grid-rows-1')
    expect(layout).not.toHaveClass('grid-rows-[auto_1fr]')
    expect(screen.getByTestId('app-shell')).toHaveAttribute(
      'data-sidebar-state',
      'drawer-closed',
    )
    expect(
      screen.queryByRole('complementary', { name: 'Application navigation' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))

    const sidebar = screen.getByRole('complementary', { name: 'Application navigation' })
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'drawer-open')
    expect(sidebar).toHaveClass(
      'absolute',
      'left-0',
      'top-0',
      'z-40',
      'h-full',
      'w-[280px]',
      'max-w-[85vw]',
    )
    expect(screen.getByRole('button', { name: 'Close sidebar drawer' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar drawer' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute(
      'data-sidebar-state',
      'drawer-closed',
    )
    expect(
      screen.queryByRole('complementary', { name: 'Application navigation' }),
    ).not.toBeInTheDocument()
  })

  it('closes the narrow application drawer after changing views', async () => {
    mockNarrowViewport()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'action-queue')
    expect(screen.getByTestId('app-shell')).toHaveAttribute(
      'data-sidebar-state',
      'drawer-closed',
    )
    expect(
      screen.queryByRole('complementary', { name: 'Application navigation' }),
    ).not.toBeInTheDocument()
    expect(within(screen.getByRole('banner', { name: 'App chrome' })).getByText('Action Queue')).toBeInTheDocument()
  })

  it('opens a compact settings popover for important runtime controls', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()

    const settingsTrigger = screen.getByRole('button', { name: 'Settings' })

    expect(settingsTrigger).not.toHaveClass('border')
    expect(settingsTrigger).not.toHaveClass('border-border')
    expect(settingsTrigger).not.toHaveClass('bg-card/95')
    expect(settingsTrigger).not.toHaveClass('shadow-xl')
    expect(settingsTrigger).toHaveClass('hover:bg-accent', 'hover:text-accent-foreground')

    fireEvent.click(settingsTrigger)

    const dialog = screen.getByRole('dialog', { name: 'Settings' })

    expect(within(dialog).getByText('Valedictorian')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Use remote backend')).not.toBeChecked()
    expect(within(dialog).getByLabelText('Local API sharing')).not.toBeChecked()
    expect(within(dialog).queryByLabelText('Show advanced filters')).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Remote API URL')).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Open settings' })).toBeInTheDocument()
    expect(within(dialog).getByText('Backend changes apply after restart.')).toBeInTheDocument()
  })

  it('toggles settings from the compact popover', async () => {
    const settingsApi = createSettingsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    const dialog = screen.getByRole('dialog', { name: 'Settings' })

    fireEvent.click(within(dialog).getByLabelText('Local API sharing'))

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({ runtimeMode: 'local-shared' })
    })
    expect(within(dialog).getByText('local-shared')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByLabelText('Use remote backend'))

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({ runtimeMode: 'remote' })
    })
    expect(within(dialog).getByLabelText('Remote API URL')).not.toBeDisabled()
    expect(within(dialog).getByText('remote')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Local API sharing')).not.toBeChecked()

    fireEvent.change(within(dialog).getByLabelText('Remote API URL'), {
      target: { value: 'https://valedictorian.test' },
    })

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({
        remoteApiUrl: 'https://valedictorian.test',
      })
    })
    expect(within(dialog).getByDisplayValue('https://valedictorian.test')).toBeInTheDocument()

    expect(within(dialog).queryByLabelText('Show advanced filters')).not.toBeInTheDocument()
  })

  it('closes the compact settings popover', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('opens the full settings page from the compact popover and returns to the app', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to app' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Applications' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))

    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
  })

  it('opens the full settings page from the native Settings menu event', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent(window, new Event('valedictorian:open-settings'))

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'settings')
    })
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('uses the same app chrome shell for the settings view', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    const chrome = screen.getByRole('banner', { name: 'App chrome' })

    expect(within(chrome).getByText('Settings')).toBeInTheDocument()
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'settings')
    expect(screen.getByRole('complementary', { name: 'Settings navigation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to app' })).toBeInTheDocument()
  })

  it('renders grouped settings navigation and filters the sidebar search', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })

    expect(within(navigation).getByText('Personal')).toBeInTheDocument()
    expect(within(navigation).getByText('Integrations')).toBeInTheDocument()
    expect(within(navigation).getByText('Automation')).toBeInTheDocument()
    expect(within(navigation).getByText('Advanced')).toBeInTheDocument()

    fireEvent.change(within(navigation).getByLabelText('Search settings'), {
      target: { value: 'agent' },
    })

    expect(within(navigation).queryByRole('button', { name: 'General' })).not.toBeInTheDocument()
  })

  it('operates Jobright from the main Connectors page with responsive write-only controls', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()

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

    expect(await screen.findByRole('heading', { name: 'Operate connectors' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add Jobright connector' }))

    expect(await screen.findByText('jobright.resolver')).toBeInTheDocument()
    expect(screen.getByTestId('connector-auth-actions-jobright-default')).toHaveClass('flex-wrap')
    const runActions = screen.getByTestId('connector-run-actions-jobright-default')
    expect(runActions).toHaveClass('lg:grid-cols-2')
    expect(runActions).not.toHaveClass('md:grid-cols-[minmax(16rem,1fr)_12rem_auto_auto]')

    fireEvent.click(screen.getByRole('button', { name: 'Add credentials' }))
    const credentialForm = screen.getByTestId('connector-credential-form-jobright-default')
    expect(credentialForm).toHaveClass('lg:grid-cols-2')
    expect(credentialForm).not.toHaveClass(
      'md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto_auto]',
    )
    fireEvent.change(screen.getByLabelText('Jobright email'), {
      target: { value: 'main-page@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'main-page-fixture-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('main-page@example.test')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('main-page-fixture-password')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    await waitFor(() => {
      expect(connectorsApi.runs.trigger).toHaveBeenCalledWith(expect.objectContaining({
        connectorInstanceId: 'jobright-default',
        mode: 'manual',
        reason: 'settings_manual_refresh',
      }))
    })
    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View connector runs' }))

    expect(await screen.findByRole('heading', { name: 'Connector Runs' })).toBeInTheDocument()
    expect(
      screen.queryByRole('complementary', { name: 'Settings navigation' }),
    ).not.toBeInTheDocument()
  })

  it('creates, configures, and runs the current Jobright connector through Settings', async () => {
    const sqlitePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'settings-jobright-')), 'valedictorian.sqlite')
    const connector: AppJobConnector = {
      definition: {
        id: 'jobright.resolver',
        version: '0.6.0',
        capabilities: { supportsFiltering: false },
        auth: {
          modes: ['username_password'],
          requirements: [{
            id: 'jobright',
            label: 'Jobright username and password',
            mode: 'username_password',
            required: true,
          }],
        },
      },
      async validateAuth() {
        return { status: 'ready', reason: 'jobright_auth_ready' }
      },
      async refresh(input) {
        return {
          observations: [],
          nextCheckpoint: { checkpoint: {}, schemaVersion: 'jobright-test@1' },
          coverage: input.coverage,
          stats: { observations: 0 },
          warnings: [],
        }
      },
    }
    const client = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      secretCodec: {
        decrypt: (value) => value.replace(/^enc:/, ''),
        encrypt: (value) => `enc:${value}`,
      },
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-settings-jobright',
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([]))}
        connectorsApi={client.connectors as ConnectorsPreloadApi}
        profileApi={client.profile as ProfilePreloadApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(screen.getByLabelText('Jobright email'), {
      target: { value: 'settings@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'settings-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()
    await expect(client.connectors.list()).resolves.toMatchObject({
      items: [expect.objectContaining({ connectorVersion: '0.6.0' })],
    })
  })

  it('adds a Jobright connector instance from settings with default auth and filters', async () => {
    const connectorsApi = createConnectorsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))

    await waitFor(() => {
      expect(connectorsApi.create).toHaveBeenCalledWith({
        auth: [
          {
            id: 'jobright',
            label: 'Jobright username and password',
            mode: 'username_password',
          },
        ],
        config: {},
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        id: 'jobright-default',
      })
    })
    expect(await screen.findByText('jobright.resolver')).toBeInTheDocument()
    expect(screen.getByText('Auth required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add credentials' })).toBeInTheDocument()
    expect(screen.getByText('1 connector instance configured.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(screen.queryByText('Credentials stored')).not.toBeInTheDocument()
    expect(screen.queryByText(/login window/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Login to Jobright' })).not.toBeInTheDocument()
    expect(screen.queryByText('Auth verified')).not.toBeInTheDocument()
  })

  it('saves and validates Jobright credentials without revealing saved secrets', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()

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

    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: ' demo@example.com ' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: ' pass with spaces ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    await waitFor(() => {
      expect(profileApi.secrets.upsert).toHaveBeenCalledWith({
        key: 'connector_jobright_credentials_jobright_default',
        kind: 'password',
        label: 'Jobright username and password',
        value: JSON.stringify({
          username: 'demo@example.com',
          password: ' pass with spaces ',
        }),
      })
      expect(connectorsApi.update).toHaveBeenCalledWith({
        auth: [
          {
            id: 'jobright',
            label: 'Jobright username and password',
            mode: 'username_password',
            secretKey: 'connector_jobright_credentials_jobright_default',
          },
        ],
        connectorInstanceId: 'jobright-default',
      })
      expect(connectorsApi.status.reconnect).toHaveBeenCalledWith({
        connectorInstanceId: 'jobright-default',
      })
    })
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('demo@example.com')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(' pass with spaces ')).not.toBeInTheDocument()
    expect(screen.queryByText('demo@example.com')).not.toBeInTheDocument()
    expect(screen.queryByText(' pass with spaces ')).not.toBeInTheDocument()
    expect(Object.keys(profileApi.secrets)).not.toContain('reveal')
  })

  it('cancels credential editing without secret or validation calls', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()

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
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Credential update cancelled.')).toBeInTheDocument()
    expect(screen.getByText('Auth cancelled')).toBeInTheDocument()
    expect(profileApi.secrets.upsert).not.toHaveBeenCalled()
    expect(connectorsApi.update).not.toHaveBeenCalled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('keeps invalid empty credentials in the editor without secret calls', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()

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
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText(
      'Enter a Jobright email and password before validating.',
    )).toBeInTheDocument()
    expect(screen.getByLabelText('Jobright email')).toBeInTheDocument()
    expect(screen.getByLabelText('Jobright password')).toBeInTheDocument()
    expect(profileApi.secrets.upsert).not.toHaveBeenCalled()
    expect(connectorsApi.update).not.toHaveBeenCalled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('surfaces sanitized secure-storage upsert failures without secret content', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const secureStorageError = new Error('Secure storage is unavailable') as Error & { code: string }
    secureStorageError.code = 'secure_storage_unavailable'
    vi.mocked(profileApi.secrets.upsert).mockRejectedValueOnce(secureStorageError)

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
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'secret-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText(
      'Secure storage is unavailable. Enable platform encryption, then try again.',
    )).toBeInTheDocument()
    expect(screen.queryByDisplayValue('demo@example.com')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('secret-password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Jobright email')).not.toBeInTheDocument()
    expect(connectorsApi.update).not.toHaveBeenCalled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('auto-validates configured Jobright credentials on settings load', async () => {
    const connectorsApi = createConnectorsApi()
    let resolveReconnect: ((value: Awaited<ReturnType<typeof connectorsApi.status.reconnect>>) => void) | undefined
    const pendingReconnect = new Promise<Awaited<ReturnType<typeof connectorsApi.status.reconnect>>>((resolve) => {
      resolveReconnect = resolve
    })
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.status.reconnect).mockReturnValueOnce(pendingReconnect)

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    expect(await screen.findByText('Checking auth...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    await act(async () => {
      resolveReconnect?.({
        action: 'reconnect',
        connectorInstanceId: 'jobright-default',
        grants: [{
          id: 'jobright',
          mode: 'username_password',
          status: 'ready',
        }],
        message: 'Connector credentials are verified and ready.',
        reason: 'jobright_auth_ready',
        status: 'ready',
      })
    })

    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
    expect(connectorsApi.status.reconnect).toHaveBeenCalledWith({
      connectorInstanceId: 'jobright-default',
    })
  })

  it('does not auto-validate non-Jobright configured connectors on settings load', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'fixture-default',
        connectorId: 'fixture.jobs',
        connectorVersion: '0.0.0-fixture',
        displayName: 'Fixture jobs',
        enabled: true,
        auth: [{
          id: 'fixture-api',
          mode: 'api_key',
          label: 'Fixture API key',
          configured: true,
        }],
        config: {},
        filters: {},
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    expect(await screen.findByText('fixture.jobs')).toBeInTheDocument()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()
    expect(screen.queryByText('Checking auth...')).not.toBeInTheDocument()
  })

  it('keeps Jobright target and advanced settings off non-Jobright connector cards', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'fixture-default',
        connectorId: 'fixture.jobs',
        connectorVersion: '0.0.0-fixture',
        displayName: 'Fixture jobs',
        enabled: true,
        auth: [{
          id: 'fixture-api',
          mode: 'api_key',
          label: 'Fixture API key',
          configured: true,
        }],
        config: {},
        filters: {},
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    const fixtureCard = await screen.findByTestId('connector-instance-card-fixture-default')
    expect(within(fixtureCard).getByText('Fixture jobs')).toBeInTheDocument()
    expect(within(fixtureCard).getByText('fixture.jobs')).toBeInTheDocument()
    expect(within(fixtureCard).queryByLabelText('Useful results target')).not.toBeInTheDocument()
    expect(within(fixtureCard).queryByText('Advanced connector limits')).not.toBeInTheDocument()
    expect(within(fixtureCard).queryByRole('button', { name: 'Save Jobright settings' }))
      .not.toBeInTheDocument()
    expect(within(fixtureCard).queryByRole('button', { name: 'Run Jobright now' }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Jobright connector' })).toBeInTheDocument()
  })

  it('treats legacy Jobright browser_session auth as unconfigured API credentials', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    await connectorsApi.create({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.3.0',
      displayName: 'Jobright public jobs',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'browser_session',
        label: 'Jobright browser session',
        sessionKey: 'legacy-jobright-session',
      }],
      config: {},
      filters: {
        maxResolutionCount: 10,
        roleTerms: ['intern'],
      },
    })
    vi.mocked(connectorsApi.create).mockClear()
    vi.mocked(connectorsApi.update).mockClear()
    vi.mocked(connectorsApi.status.reconnect).mockClear()

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

    expect(await screen.findByText('jobright.resolver')).toBeInTheDocument()
    expect(screen.getByText('Auth required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add credentials' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validate' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: ' pass with spaces ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    await waitFor(() => {
      expect(profileApi.secrets.upsert).toHaveBeenCalled()
      expect(connectorsApi.update).toHaveBeenCalledWith({
        auth: [
          {
            id: 'jobright',
            label: 'Jobright username and password',
            mode: 'username_password',
            secretKey: 'connector_jobright_credentials_jobright_default',
          },
        ],
        connectorInstanceId: 'jobright-default',
      })
      expect(connectorsApi.status.reconnect).toHaveBeenCalledWith({
        connectorInstanceId: 'jobright-default',
      })
    })
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
  })

  it('ignores stale ready validation after a newer failed validation settles', async () => {
    const connectorsApi = createConnectorsApi()
    let resolveOlder: ((value: Awaited<ReturnType<typeof connectorsApi.status.reconnect>>) => void) | undefined
    let resolveNewer: ((value: Awaited<ReturnType<typeof connectorsApi.status.reconnect>>) => void) | undefined
    const olderReconnect = new Promise<Awaited<ReturnType<typeof connectorsApi.status.reconnect>>>((resolve) => {
      resolveOlder = resolve
    })
    const newerReconnect = new Promise<Awaited<ReturnType<typeof connectorsApi.status.reconnect>>>((resolve) => {
      resolveNewer = resolve
    })
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.status.reconnect)
      .mockReturnValueOnce(olderReconnect)
      .mockReturnValueOnce(newerReconnect)

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    expect(await screen.findByText('Checking auth...')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Validate' }))
    expect(await screen.findByText('Checking auth...')).toBeInTheDocument()

    await act(async () => {
      resolveNewer?.({
        action: 'reconnect',
        connectorInstanceId: 'jobright-default',
        grants: [{
          id: 'jobright',
          mode: 'username_password',
          reason: 'jobright_login_rejected',
          status: 'action_required',
        }],
        message: 'Connector credentials were rejected. Update email and password, then validate again.',
        reason: 'jobright_login_rejected',
        status: 'action_required',
      })
    })

    expect(await screen.findByText(
      'Connector credentials were rejected. Update email and password, then validate again.',
    )).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    await act(async () => {
      resolveOlder?.({
        action: 'reconnect',
        connectorInstanceId: 'jobright-default',
        grants: [{
          id: 'jobright',
          mode: 'username_password',
          status: 'ready',
        }],
        message: 'Connector credentials are verified and ready.',
        reason: 'jobright_auth_ready',
        status: 'ready',
      })
    })

    expect(screen.queryByText('Auth verified')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(screen.getByText(
      'Connector credentials were rejected. Update email and password, then validate again.',
    )).toBeInTheDocument()
  })

  it('ignores stale auto-validation after credential editing begins', async () => {
    const connectorsApi = createConnectorsApi()
    let resolveAutoValidate: ((value: Awaited<ReturnType<typeof connectorsApi.status.reconnect>>) => void) | undefined
    const autoValidate = new Promise<Awaited<ReturnType<typeof connectorsApi.status.reconnect>>>((resolve) => {
      resolveAutoValidate = resolve
    })
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.status.reconnect).mockReturnValueOnce(autoValidate)

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    expect(await screen.findByText('Checking auth...')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Update credentials' }))
    expect(await screen.findByLabelText('Jobright email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    await act(async () => {
      resolveAutoValidate?.({
        action: 'reconnect',
        connectorInstanceId: 'jobright-default',
        grants: [{
          id: 'jobright',
          mode: 'username_password',
          status: 'ready',
        }],
        message: 'Connector credentials are verified and ready.',
        reason: 'jobright_auth_ready',
        status: 'ready',
      })
    })

    expect(screen.queryByText('Auth verified')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Jobright email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('shows sanitized secure-storage failure when revalidation returns it', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.status.reconnect).mockResolvedValue({
      action: 'reconnect',
      connectorInstanceId: 'jobright-default',
      grants: [{
        id: 'jobright',
        mode: 'username_password',
        reason: 'secure_storage_unavailable',
        status: 'action_required',
      }],
      message: 'Secure storage is unavailable. Enable platform encryption, then try again.',
      reason: 'secure_storage_unavailable',
      status: 'failed',
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    expect(await screen.findByText(
      'Secure storage is unavailable. Enable platform encryption, then try again.',
    )).toBeInTheDocument()
    expect(screen.getByText('Auth failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(screen.queryByText(/sensitive/i)).not.toBeInTheDocument()
  })

  it('keeps failed validation non-ready and clears credential inputs', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.status.reconnect).mockResolvedValue({
      action: 'reconnect',
      connectorInstanceId: 'jobright-default',
      grants: [
        {
          id: 'jobright',
          mode: 'username_password',
          reason: 'jobright_login_rejected',
          status: 'action_required',
        },
      ],
      message: 'Connector credentials were rejected. Update email and password, then validate again.',
      reason: 'jobright_login_rejected',
      status: 'action_required',
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
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'wrong-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText(
      'Connector credentials were rejected. Update email and password, then validate again.',
    )).toBeInTheDocument()
    expect(screen.getByText('Auth required')).toBeInTheDocument()
    expect(screen.queryByText('Auth verified')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('demo@example.com')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('wrong-password')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

  it('saves Jobright filters from connector settings before refresh', async () => {
    const connectorsApi = createConnectorsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))

    fireEvent.change(await screen.findByLabelText('Role terms'), {
      target: { value: 'intern, backend' },
    })
    fireEvent.change(screen.getByLabelText('Useful results target'), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        config: {
          usefulTarget: 3,
        },
        connectorInstanceId: 'jobright-default',
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern', 'backend'],
        },
      })
    })
  })

  it('saves exact useful results target 500 as bounded backfill intent without migrating legacy resolution caps', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        secretKey: 'connector_jobright_credentials_jobright_default',
      }],
      config: {
        customKeep: 'preserve-me',
        discoveryCount: 25,
      },
      filters: {
        maxResolutionCount: 50,
        roleTerms: ['intern'],
      },
    })
    vi.mocked(connectorsApi.create).mockClear()
    vi.mocked(connectorsApi.update).mockClear()

    const firstRender = render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    const usefulTarget = await screen.findByLabelText('Useful results target')
    expect(usefulTarget).toHaveValue(100)
    expect(screen.getByText(/bounded backfill intent across runs/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Max links per refresh')).not.toBeInTheDocument()

    fireEvent.change(usefulTarget, { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        config: {
          customKeep: 'preserve-me',
          discoveryCount: 25,
          usefulTarget: 500,
        },
        connectorInstanceId: 'jobright-default',
        filters: {
          maxResolutionCount: 50,
          roleTerms: ['intern'],
        },
      })
    })
    expect(connectorsApi.update).not.toHaveBeenCalledWith(expect.objectContaining({
      config: {},
    }))

    firstRender.unmount()
    vi.mocked(connectorsApi.update).mockClear()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const reloadedNavigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(reloadedNavigation).getByRole('button', { name: 'Connectors' }))

    expect(await screen.findByLabelText('Useful results target')).toHaveValue(500)
    expect(screen.getByText(/Saved useful results target: 500/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Advanced connector limits'))
    expect(screen.getByLabelText('Discovery page size')).toHaveValue(25)
    expect(screen.getByLabelText('Requested detail-resolution attempts')).toHaveValue(50)
    expect(screen.getByText(/Requested detail-resolution attempts \(saved\): 50 \(legacy\)/i))
      .toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Role terms'), {
      target: { value: 'intern, backend' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        config: {
          customKeep: 'preserve-me',
          discoveryCount: 25,
          usefulTarget: 500,
        },
        connectorInstanceId: 'jobright-default',
        filters: {
          maxResolutionCount: 50,
          roleTerms: ['intern', 'backend'],
        },
      })
    })
  })

  it('blocks Run while connector settings draft is dirty without auto-saving', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {
          usefulTarget: 100,
        },
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
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
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Useful results target'), {
      target: { value: '250' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByText(
      'Save or discard your unsaved connector settings before running.',
    )).toBeInTheDocument()
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

  it('blocks Run and freezes connector settings while a save is still pending', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    let resolveUpdate: ((value: Awaited<ReturnType<typeof connectorsApi.update>>) => void) | undefined
    const pendingUpdate = new Promise<Awaited<ReturnType<typeof connectorsApi.update>>>((resolve) => {
      resolveUpdate = resolve
    })
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {
          usefulTarget: 100,
        },
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.update).mockReturnValueOnce(pendingUpdate)

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
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()

    const usefulTarget = screen.getByLabelText('Useful results target')
    fireEvent.change(usefulTarget, { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(screen.getByLabelText('Useful results target')).toBeDisabled()
    expect(screen.getByLabelText('Role terms')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Discard unsaved settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdate?.({
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {
          usefulTarget: 250,
        },
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:01:00.000Z',
      })
    })

    expect(await screen.findByRole('button', { name: 'Save Jobright settings' })).toBeEnabled()
    expect(screen.getByLabelText('Useful results target')).toBeEnabled()
    expect(screen.getByLabelText('Useful results target')).toHaveValue(250)
    expect(screen.getByText(/Saved useful results target: 250/i)).toBeInTheDocument()
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()
  })

  it('keeps concurrent Jobright saves frozen independently per instance card', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    type UpdatedInstance = Awaited<ReturnType<typeof connectorsApi.update>>
    let resolveUpdateA: ((value: UpdatedInstance) => void) | undefined
    let resolveUpdateB: ((value: UpdatedInstance) => void) | undefined
    const pendingUpdateA = new Promise<UpdatedInstance>((resolve) => {
      resolveUpdateA = resolve
    })
    const pendingUpdateB = new Promise<UpdatedInstance>((resolve) => {
      resolveUpdateB = resolve
    })
    const instanceA = {
      id: 'jobright-a',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Jobright Alpha',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password' as const,
        label: 'Jobright username and password',
        configured: true,
      }],
      config: {
        usefulTarget: 100,
      },
      filters: {
        maxResolutionCount: 10,
        roleTerms: ['intern'],
      },
      createdAt: '2026-07-09T15:00:00.000Z',
      updatedAt: '2026-07-09T15:00:00.000Z',
    }
    const instanceB = {
      ...instanceA,
      id: 'jobright-b',
      displayName: 'Jobright Beta',
    }
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [instanceA, instanceB],
    })
    vi.mocked(connectorsApi.update).mockImplementation(async (input) => {
      if (input.connectorInstanceId === 'jobright-a') {
        return pendingUpdateA
      }
      if (input.connectorInstanceId === 'jobright-b') {
        return pendingUpdateB
      }
      throw new Error(`Unexpected connector instance: ${input.connectorInstanceId}`)
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

    const cardA = await screen.findByTestId('connector-instance-card-jobright-a')
    const cardB = screen.getByTestId('connector-instance-card-jobright-b')
    expect(await within(cardA).findByText('Auth verified')).toBeInTheDocument()
    expect(await within(cardB).findByText('Auth verified')).toBeInTheDocument()

    fireEvent.change(within(cardA).getByLabelText('Useful results target'), {
      target: { value: '210' },
    })
    fireEvent.click(within(cardA).getByRole('button', { name: 'Save Jobright settings' }))
    fireEvent.change(within(cardB).getByLabelText('Useful results target'), {
      target: { value: '220' },
    })
    fireEvent.click(within(cardB).getByRole('button', { name: 'Save Jobright settings' }))

    expect(await within(cardA).findByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(await within(cardB).findByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(within(cardA).getByLabelText('Useful results target')).toBeDisabled()
    expect(within(cardB).getByLabelText('Useful results target')).toBeDisabled()
    expect(within(cardA).getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(within(cardB).getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    fireEvent.click(within(cardA).getByRole('button', { name: 'Run Jobright now' }))
    fireEvent.click(within(cardB).getByRole('button', { name: 'Run Jobright now' }))
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdateA?.({
        ...instanceA,
        config: { usefulTarget: 210 },
        updatedAt: '2026-07-09T15:01:00.000Z',
      })
    })

    expect(await within(cardA).findByRole('button', { name: 'Save Jobright settings' })).toBeEnabled()
    expect(within(cardA).getByLabelText('Useful results target')).toBeEnabled()
    expect(within(cardA).getByLabelText('Useful results target')).toHaveValue(210)
    expect(within(cardB).getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(within(cardB).getByLabelText('Useful results target')).toBeDisabled()
    expect(within(cardB).getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    fireEvent.click(within(cardB).getByRole('button', { name: 'Run Jobright now' }))
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdateB?.({
        ...instanceB,
        config: { usefulTarget: 220 },
        updatedAt: '2026-07-09T15:02:00.000Z',
      })
    })

    expect(await within(cardB).findByRole('button', { name: 'Save Jobright settings' })).toBeEnabled()
    expect(within(cardB).getByLabelText('Useful results target')).toBeEnabled()
    expect(within(cardB).getByLabelText('Useful results target')).toHaveValue(220)
    expect(within(cardA).getByLabelText('Useful results target')).toHaveValue(210)
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()
  })

  it('distinguishes saved, draft, and effective values for legacy resolution caps', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {
          maxResolutionCount: 50,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    expect(await screen.findByLabelText('Useful results target')).toHaveValue(100)
    expect(screen.getByText(/Saved useful results target: default 100/i)).toBeInTheDocument()
    expect(screen.getByText(/Requested detail-resolution attempts \(saved\): 50 \(legacy\)/i))
      .toBeInTheDocument()
    expect(screen.getByText(/Effective detail-resolution attempts: 10/i)).toBeInTheDocument()
    expect(screen.getByText(/host request budget 10/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Useful results target'), {
      target: { value: '200' },
    })
    expect(screen.getByText(/Unsaved draft useful results target: 200/i)).toBeInTheDocument()
    expect(screen.getByText(/Saved useful results target: default 100/i)).toBeInTheDocument()
  })

  it('exposes advanced discovery controls and rejects resolution attempts above the host budget', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {
          customKeep: 'still-here',
        },
        filters: {
          maxResolutionCount: 50,
          roleTerms: ['intern'],
        },
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.update).mockImplementation(async (input) => ({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        configured: true,
      }],
      config: input.config ?? { customKeep: 'still-here' },
      filters: input.filters ?? {
        maxResolutionCount: 50,
        roleTerms: ['intern'],
      },
      createdAt: '2026-07-09T15:00:00.000Z',
      updatedAt: '2026-07-09T15:01:00.000Z',
    }))

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    fireEvent.click(await screen.findByText('Advanced connector limits'))
    expect(screen.getByLabelText('Discovery page size')).toHaveValue(20)
    expect(screen.getByLabelText('Discovery page limit')).toHaveValue(40)
    expect(screen.getByLabelText('Discovery record limit')).toHaveValue(500)
    expect(screen.getByText(/Host request budget: effective 10 requests\/run/i)).toBeInTheDocument()
    expect(screen.getByText(/connector-supported maximum 25/i)).toBeInTheDocument()
    expect(screen.getByText(/takes precedence/i)).toBeInTheDocument()
    expect(screen.getByText(/Pacing: concurrency 1, 1–10 seconds between bounded requests/i))
      .toBeInTheDocument()
    expect(screen.getByLabelText('Requested detail-resolution attempts')).toHaveValue(50)
    expect(screen.getByText(/Saved value is labeled legacy/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Requested detail-resolution attempts'), {
      target: { value: '11' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))
    expect(await screen.findByText(
      'Requested detail-resolution attempts cannot exceed the effective host request budget of 10.',
    )).toBeInTheDocument()
    expect(connectorsApi.update).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Requested detail-resolution attempts'), {
      target: { value: '8' },
    })
    fireEvent.change(screen.getByLabelText('Discovery page size'), {
      target: { value: '30' },
    })
    fireEvent.change(screen.getByLabelText('Discovery page limit'), {
      target: { value: '12' },
    })
    fireEvent.change(screen.getByLabelText('Discovery record limit'), {
      target: { value: '200' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        config: {
          customKeep: 'still-here',
          discoveryCount: 30,
          maxDiscoveryPages: 12,
          maxDiscoveryRecords: 200,
          usefulTarget: 100,
        },
        connectorInstanceId: 'jobright-default',
        filters: {
          maxResolutionCount: 8,
          roleTerms: ['intern'],
        },
      })
    })
  })

  it('runs an authenticated Jobright connector from settings', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()

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

    const runButtonBeforeAuth = await screen.findByRole('button', { name: 'Run Jobright now' })
    expect(runButtonBeforeAuth).toBeDisabled()

    await authenticateJobrightInSettings({ connectorsApi, profileApi })

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    await waitFor(() => {
      expect(connectorsApi.runs.trigger).toHaveBeenCalledWith(expect.objectContaining({
        connectorInstanceId: 'jobright-default',
        mode: 'manual',
        reason: 'settings_manual_refresh',
      }))
    })
    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()
  })

  it('shows two persisted non-terminal progress snapshots before terminal connector counts', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const connectorStatusLoader = vi.fn(async () => createConnectorStatusResult([]))
    const sourcingLoader = vi.fn(async () => createSourcingResult([]))
    type ConnectorRun = Awaited<ReturnType<typeof connectorsApi.runs.trigger>>
    let resolveRun: ((run: ConnectorRun) => void) | undefined
    const pendingRun = new Promise<ConnectorRun>((resolve) => {
      resolveRun = resolve
    })
    vi.mocked(connectorsApi.runs.trigger).mockReturnValueOnce(pendingRun)
    const lifecycleCounts = (source: 'live_current' | 'frozen_terminal') => ({
      version: 'connector-run-lifecycle-counts/v1',
      source,
      scope: { kind: 'connector_run', connectorRunId: 'connector-run-progress' },
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
        gaps: [
          'missing_provider_returned',
          'missing_provider_valid',
          'missing_provider_invalid',
          'missing_source_duplicates',
        ],
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
    })
    const progressRun = (stage: string, stats: Record<string, unknown>): ConnectorRun => ({
      id: 'connector-run-progress',
      connectorInstanceId: 'jobright-default',
      mode: 'manual',
      status: 'running',
      coverage: {
        start: '2026-07-09T15:00:00.000Z',
        end: '2026-07-09T16:00:00.000Z',
      },
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      stats: { stage, ...stats, lifecycleCounts: lifecycleCounts('live_current') },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: null,
    })
    vi.mocked(connectorsApi.runs.list)
      .mockResolvedValueOnce({
        items: [progressRun('authenticating', {
          discovered: 0,
          lastProgressAt: '2026-07-09T16:00:00.250Z',
        })],
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
      })
      .mockResolvedValueOnce({
        items: [progressRun('normalizing', {
          attempted: 3,
          discovered: 20,
          lastProgressAt: '2026-07-09T16:00:01.000Z',
          remainingTarget: 6,
          resolvedEmployerOrAts: 1,
          resolvedThirdParty: 1,
          unresolved: 1,
          wait: {
            maxDelayMs: 2_000,
            minDelayMs: 1_000,
            reason: 'jobright_resolution',
          },
        })],
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
      })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorStatusLoader={connectorStatusLoader}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        sourcingLoader={sourcingLoader}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await authenticateJobrightInSettings({ connectorsApi, profileApi })

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByText('Stage: Authenticating')).toBeInTheDocument()
    expect(await screen.findByText('Stage: Normalizing', {}, { timeout: 2_000 })).toBeInTheDocument()
    expect(screen.getByText('Live counts derived from current persisted lineage.')).toBeInTheDocument()
    expect(screen.getByText('Discovered jobs: 20')).toBeInTheDocument()
    expect(screen.getByText('Resolved employer / ATS: 1')).toBeInTheDocument()
    expect(screen.getByText('Resolved third-party: 1')).toBeInTheDocument()
    expect(screen.getByText('Remaining target: 6')).toBeInTheDocument()
    expect(screen.getByText('Waiting between bounded Jobright API requests.')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Jobright internslist run progress' })).toHaveAttribute(
      'aria-live',
      'polite',
    )
    expect(screen.getByRole('button', { name: 'View connector-run-progress in Connector Runs' }))
      .toBeInTheDocument()

    await act(async () => {
      resolveRun?.({
        id: 'connector-run-progress',
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
          failures: 2,
          observations: 8,
          projectedUsable: 2,
          retainedForReview: 6,
          resolved: 2,
          resolvedEmployerOrAts: 1,
          resolvedThirdParty: 1,
          stage: 'finalizing',
          stopReason: 'source_exhausted',
          lifecycleCounts: lifecycleCounts('frozen_terminal'),
        },
        warnings: [],
        retryHints: {
          reason: 'auth_required',
        },
        startedAt: '2026-07-09T16:00:00.000Z',
        completedAt: '2026-07-09T16:00:02.000Z',
      })
    })

    expect(await screen.findByText('Latest run: partial_success')).toBeInTheDocument()
    expect(screen.getByText('Frozen at terminal completion.')).toBeInTheDocument()
    expect(screen.getByText('Discovered jobs: 12')).toBeInTheDocument()
    expect(screen.getByText('Detail attempts: 3')).toBeInTheDocument()
    expect(screen.getByText('Auth-required requests: 1')).toBeInTheDocument()
    expect(screen.queryByText('Eligible: 8')).not.toBeInTheDocument()
    expect(screen.queryByText('Projected usable: 2')).not.toBeInTheDocument()
    expect(screen.queryByText('Retained for review: 6')).not.toBeInTheDocument()
    expect(screen.getByText('Warnings: 1')).toBeInTheDocument()
    expect(screen.getByText('Failures: 2')).toBeInTheDocument()
    expect(screen.queryByText('auth_required')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(connectorStatusLoader).toHaveBeenCalledTimes(1)
      expect(sourcingLoader).toHaveBeenCalledTimes(1)
    })
  })

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

  it('renders and persists structured profile sections with compact reusable answers and secure values', async () => {
    const profileApi = createProfileApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.queryByText('Coming later')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Profile Basics' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Education' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Work Authorization' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Documents' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Cover letter path')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Private Identifiers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Voluntary Self-ID' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sensitive Details' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Reusable Application Answers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Secure Values' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Availability' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Kenny Lin' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kenny@example.com' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '555-0100' } })
    fireEvent.change(screen.getByLabelText('Phone device type'), { target: { value: 'Mobile' } })
    fireEvent.change(screen.getByLabelText('Address line 1'), {
      target: { value: '470 Mockingbird Lane' },
    })
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'English' } })
    expect(screen.getByRole('table', { name: 'Education' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add education' }))
    fireEvent.change(screen.getByLabelText('Education type'), {
      target: { value: 'College' },
    })
    fireEvent.change(screen.getByLabelText('School name'), {
      target: { value: 'University of Colorado Boulder' },
    })
    fireEvent.change(screen.getByLabelText('Degree'), { target: { value: 'BS Computer Science' } })
    fireEvent.change(screen.getByLabelText('Major'), { target: { value: 'Computer Science' } })
    fireEvent.change(screen.getByLabelText('Graduation date'), {
      target: { value: 'December 2027' },
    })
    fireEvent.change(screen.getByLabelText('Class standing'), { target: { value: 'Senior' } })
    fireEvent.change(screen.getByLabelText('Transcript path'), {
      target: { value: 'transcripts/Kenny_Lin_S26_Transcript.pdf' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save education' }))
    expect(await screen.findByText('University of Colorado Boulder')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add education' }))
    fireEvent.change(screen.getByLabelText('Education type'), {
      target: { value: 'Other' },
    })
    expect(screen.getByLabelText('Other education type')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Other education type'), {
      target: { value: 'Research fellowship' },
    })
    fireEvent.change(screen.getByLabelText('School name'), {
      target: { value: 'Open Source Lab' },
    })
    fireEvent.change(screen.getByLabelText('Education notes'), {
      target: { value: 'Maintainer fellowship.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save education' }))
    expect(await screen.findByText('Research fellowship')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Work authorization'), {
      target: { value: 'Authorized to work in the US.' },
    })
    fireEvent.change(screen.getByLabelText('Require sponsorship'), { target: { value: 'No' } })
    fireEvent.change(screen.getByLabelText('Require future sponsorship'), { target: { value: 'No' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Willing to relocate Yes' }))
    fireEvent.change(screen.getByLabelText('Relocation notes'), {
      target: { value: 'Open to NYC, Denver, or Bay Area roles.' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Willing to travel No' }))
    fireEvent.change(screen.getByLabelText('Travel notes'), {
      target: { value: 'Prefer under 25%.' },
    })
    fireEvent.change(screen.getByLabelText('Birth month'), { target: { value: '03' } })
    fireEvent.change(screen.getByLabelText('Birth day'), { target: { value: '16' } })
    fireEvent.change(screen.getByLabelText('Birth year'), { target: { value: '2004' } })
    fireEvent.change(screen.getByLabelText('Last 4 SSN'), { target: { value: '5125' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save private identifiers' }))

    await waitFor(() => {
      expect(profileApi.sensitive.update).toHaveBeenCalledWith({
        birthDay: '16',
        birthMonth: '03',
        birthYear: '2004',
        ssnLast4: '5125',
      })
    })

    expect(screen.getByRole('combobox', { name: 'Race/ethnicity' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Gender' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Disability status' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Veteran status' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Hispanic/Latino' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Race/ethnicity'), { target: { value: 'Asian' } })
    fireEvent.change(screen.getByLabelText('Gender'), { target: { value: 'Man' } })
    fireEvent.change(screen.getByLabelText('Disability status'), { target: { value: 'No' } })
    fireEvent.change(screen.getByLabelText('Veteran status'), {
      target: { value: 'Not a protected veteran' },
    })
    fireEvent.change(screen.getByLabelText('Hispanic/Latino'), { target: { value: 'No' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save voluntary self-ID' }))

    await waitFor(() => {
      expect(profileApi.sensitive.update).toHaveBeenCalledWith({
        disabilityStatus: 'No',
        gender: 'Man',
        hispanicLatino: 'No',
        raceEthnicity: 'Asian',
        veteranStatus: 'Not a protected veteran',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add answer' }))
    fireEvent.change(screen.getByLabelText('Answer name'), {
      target: { value: 'How I heard about the role' },
    })
    fireEvent.change(screen.getByLabelText('Question hint'), {
      target: { value: 'How did you hear about us?' },
    })
    fireEvent.change(screen.getByLabelText('Answer to use'), {
      target: { value: 'LinkedIn' },
    })
    fireEvent.click(screen.getByLabelText('Available to automation'))
    fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenLastCalledWith({
        answers: [
          {
            answer: 'LinkedIn',
            category: null,
            includeInAgentContext: true,
            key: 'how_i_heard_about_the_role',
            label: 'How I heard about the role',
            questionPattern: 'How did you hear about us?',
          },
        ],
        addressLine1: '470 Mockingbird Lane',
        education: [
          {
            classStanding: 'Senior',
            degree: 'BS Computer Science',
            educationType: 'College',
            graduationDate: 'December 2027',
            id: 'university_of_colorado_boulder',
            major: 'Computer Science',
            notes: null,
            satScore: null,
            school: 'University of Colorado Boulder',
            transcriptPath: 'transcripts/Kenny_Lin_S26_Transcript.pdf',
          },
          {
            classStanding: null,
            degree: null,
            educationType: 'Research fellowship',
            graduationDate: null,
            id: 'open_source_lab',
            major: null,
            notes: 'Maintainer fellowship.',
            satScore: null,
            school: 'Open Source Lab',
            transcriptPath: null,
          },
        ],
        email: 'kenny@example.com',
        fullName: 'Kenny Lin',
        language: 'English',
        phone: '555-0100',
        phoneDeviceType: 'Mobile',
        relocationNotes: 'Open to NYC, Denver, or Bay Area roles.',
        requireSponsorship: 'No',
        requireSponsorshipFuture: 'No',
        travelNotes: 'Prefer under 25%.',
        willingToRelocate: true,
        willingToTravel: false,
        workAuthorization: 'Authorized to work in the US.',
      })
    })
    expect(screen.getByRole('table', { name: 'Reusable Application Answers' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add secure value' }))
    fireEvent.change(screen.getByLabelText('Secure value name'), {
      target: { value: 'Greenhouse password' },
    })
    fireEvent.change(screen.getByLabelText('Secure value key'), {
      target: { value: 'greenhouse_password' },
    })
    fireEvent.change(screen.getByLabelText('Secure value'), {
      target: { value: 'correct horse battery staple' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save secure value' }))

    await waitFor(() => {
      expect(profileApi.secrets.upsert).toHaveBeenCalledWith({
        key: 'greenhouse_password',
        kind: 'password',
        label: 'Greenhouse password',
        value: 'correct horse battery staple',
      })
    })
    expect(screen.getByRole('table', { name: 'Secure Values' })).toBeInTheDocument()
    expect(screen.getByText('Greenhouse password')).toBeInTheDocument()
    expect(screen.getByText('••••••••')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('correct horse battery staple')).not.toBeInTheDocument()
  })

  it('shows profile save progress, success, and errors', async () => {
    const profileApi = createProfileApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    let resolveUpdate: (value: Awaited<ReturnType<typeof profileApi.update>>) => void = () => undefined
    vi.mocked(profileApi.update).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve
        }),
    )

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Kenny Lin' } })
    const profileBasics = screen.getByRole('region', { name: 'Profile Basics' })
    fireEvent.click(within(profileBasics).getByRole('button', { name: 'Save profile basics' }))

    expect(within(profileBasics).getByRole('button', { name: 'Saving...' })).toBeDisabled()

    resolveUpdate({
      ...await profileApi.get(),
      fullName: 'Kenny Lin',
    })

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()

    vi.mocked(profileApi.update).mockRejectedValueOnce(new Error('Disk is full'))
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Kenny Error' } })
    fireEvent.click(within(profileBasics).getByRole('button', { name: 'Save profile basics' }))

    expect(within(profileBasics).getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(await screen.findByText('Profile update failed')).toBeInTheDocument()
    expect(screen.getByText('Could not save profile. Disk is full')).toBeInTheDocument()
  })

  it('provides a visible save action for profile basics', async () => {
    const profileApi = createProfileApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    const profileBasics = screen.getByRole('region', { name: 'Profile Basics' })

    fireEvent.change(within(profileBasics).getByLabelText('Full name'), {
      target: { value: 'Kenny Lin' },
    })
    fireEvent.click(within(profileBasics).getByRole('button', { name: 'Save profile basics' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledWith(
        expect.objectContaining({ fullName: 'Kenny Lin' }),
      )
    })
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
  })

  it('shows work authorization save feedback as a toast', async () => {
    const profileApi = createProfileApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    const workAuthorization = screen.getByRole('region', { name: 'Work Authorization' })
    let resolveUpdate: (value: Awaited<ReturnType<typeof profileApi.update>>) => void = () => undefined
    vi.mocked(profileApi.update).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve
        }),
    )

    fireEvent.change(within(workAuthorization).getByLabelText('Work authorization'), {
      target: { value: 'Authorized to work in the US.' },
    })
    fireEvent.click(within(workAuthorization).getByRole('button', { name: 'Save work authorization' }))

    expect(within(workAuthorization).getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(within(workAuthorization).queryByRole('status')).not.toBeInTheDocument()

    resolveUpdate({
      ...await profileApi.get(),
      workAuthorization: 'Authorized to work in the US.',
    })

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
    expect(within(workAuthorization).getByRole('button', { name: 'Save work authorization' })).toBeEnabled()
  })

  it('lets users cancel profile add modals without saving drafts', async () => {
    const profileApi = createProfileApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add education' }))
    const educationDialog = await screen.findByRole('dialog', { name: 'Add education' })
    fireEvent.change(within(educationDialog).getByLabelText('School name'), {
      target: { value: 'Draft U' },
    })
    fireEvent.click(within(educationDialog).getByRole('button', { name: 'Cancel education' }))

    expect(screen.queryByLabelText('School name')).not.toBeInTheDocument()
    expect(screen.getByText('No education records yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add education' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add answer' }))
    const answerDialog = await screen.findByRole('dialog', { name: 'Add answer' })
    fireEvent.change(within(answerDialog).getByLabelText('Answer name'), {
      target: { value: 'Draft answer' },
    })
    fireEvent.click(within(answerDialog).getByRole('button', { name: 'Cancel answer' }))

    expect(screen.queryByLabelText('Answer name')).not.toBeInTheDocument()
    expect(screen.getByText('No reusable answers yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add answer' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add secure value' }))
    const secretDialog = await screen.findByRole('dialog', { name: 'Add secure value' })
    fireEvent.change(within(secretDialog).getByLabelText('Secure value name'), {
      target: { value: 'Draft secret' },
    })
    fireEvent.click(within(secretDialog).getByRole('button', { name: 'Cancel secure value' }))

    expect(screen.queryByLabelText('Secure value name')).not.toBeInTheDocument()
    expect(screen.getByText('No secure values yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add secure value' })).toBeInTheDocument()
    expect(profileApi.update).not.toHaveBeenCalled()
    expect(profileApi.secrets.upsert).not.toHaveBeenCalled()
  })

  it('lets users edit profile education, answers, and secure values from modals', async () => {
    const profileApi = createProfileApi()
    await profileApi.update({
      answers: [
        {
          answer: 'LinkedIn',
          category: null,
          includeInAgentContext: true,
          key: 'referral_source',
          label: 'Referral source',
          questionPattern: 'How did you hear about us?',
        },
      ],
      education: [
        {
          classStanding: null,
          degree: null,
          educationType: 'College',
          graduationDate: null,
          id: 'university_of_colorado_boulder',
          major: 'Computer Science',
          notes: null,
          satScore: null,
          school: 'University of Colorado Boulder',
          transcriptPath: null,
        },
      ],
    })
    await profileApi.secrets.upsert({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse password',
      value: 'correct horse battery staple',
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit education University of Colorado Boulder' }))
    const educationDialog = await screen.findByRole('dialog', { name: 'Edit education' })
    fireEvent.change(within(educationDialog).getByLabelText('Major'), {
      target: { value: 'Computer Science and Applied Math' },
    })
    fireEvent.click(within(educationDialog).getByRole('button', { name: 'Save education' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          education: [
            expect.objectContaining({
              major: 'Computer Science and Applied Math',
              school: 'University of Colorado Boulder',
            }),
          ],
        }),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit answer Referral source' }))
    const answerDialog = await screen.findByRole('dialog', { name: 'Edit answer' })
    fireEvent.change(within(answerDialog).getByLabelText('Answer to use'), {
      target: { value: 'Company careers page' },
    })
    fireEvent.click(within(answerDialog).getByRole('button', { name: 'Save answer' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          answers: [
            expect.objectContaining({
              answer: 'Company careers page',
              label: 'Referral source',
            }),
          ],
        }),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit secure value Greenhouse password' }))
    const secretDialog = await screen.findByRole('dialog', { name: 'Edit secure value' })
    fireEvent.change(within(secretDialog).getByLabelText('Secure value name'), {
      target: { value: 'Greenhouse login password' },
    })
    fireEvent.change(within(secretDialog).getByLabelText('Secure value'), {
      target: { value: 'new secure value' },
    })
    fireEvent.click(within(secretDialog).getByRole('button', { name: 'Save secure value' }))

    await waitFor(() => {
      expect(profileApi.secrets.upsert).toHaveBeenLastCalledWith({
        key: 'greenhouse_password',
        kind: 'password',
        label: 'Greenhouse login password',
        value: 'new secure value',
      })
    })
  })

  it('keeps work authorization controls in uniform settings rows', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={createProfileApi()}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    const workAuthorization = screen.getByRole('region', { name: 'Work Authorization' })
    const rows = Array.from(
      workAuthorization.querySelectorAll(':scope > div > label, :scope > div > [role="group"]'),
    )
    const expectedRowClasses = [
      'grid',
      'gap-2',
      'px-4',
      'py-3',
      'text-sm',
      'text-foreground',
      'md:grid-cols-[180px_1fr]',
      'md:items-center',
    ]

    expect(rows).toHaveLength(8)
    for (const row of rows) {
      expect(row).toHaveClass(...expectedRowClasses)
    }
    expect(workAuthorization.querySelector('fieldset')).not.toBeInTheDocument()
    expect(within(workAuthorization).getByRole('group', { name: 'Willing to relocate' })).toBeInTheDocument()
    expect(within(workAuthorization).getByRole('group', { name: 'Willing to travel' })).toBeInTheDocument()
  })

  it('renders complete policy controls and saves section drafts with toast feedback', async () => {
    const policyApi = createPolicyApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        policyApi={policyApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Policy' }))
    expect(await screen.findByRole('heading', { name: 'Policy' })).toBeInTheDocument()

    const settingsSidebar = screen.getByRole('complementary', { name: 'Settings navigation' })
    const settingsShell = settingsSidebar.parentElement
    expect(settingsShell).toHaveClass(
      'grid-cols-1',
      'grid-rows-1',
      'md:grid-cols-[280px_1fr]',
    )
    expect(settingsShell).not.toHaveClass('grid-rows-[auto_1fr]')
    expect(settingsSidebar).toHaveClass(
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
    expect(settingsSidebar).not.toHaveClass('h-auto', 'max-h-72', 'w-full', 'border-b')

    for (const sectionName of [
      'Action Queue decisions',
      'Manual review',
      'Evidence requirements',
      'Application gates',
      'Retry recovery',
      'Sourcing windows',
    ]) {
      expect(screen.getByRole('heading', { name: sectionName })).toBeInTheDocument()
    }

    for (const fieldName of [
      'Apply cutoff',
      'Stale lock hours',
      'Manual pickup delay',
      'Pickup window start',
      'Pickup window end',
      'Pickup window timezone',
      'Non-overridable evidence tags',
      'Manual review companies',
      'Explicit approval companies',
      'Allowed native platforms',
      'High-risk form builders',
      'Require employer-domain verification',
      'Require final review receipt',
      'Require second pass verification',
      'Captcha/security retries',
      'Platform error retries',
      'Login recovery required',
      'Sourcing timezone',
      'Overlap minutes',
      'Weekday cadence',
      'Overnight cadence',
      'Weekend cadence',
      'Minimum lookback',
      'Overnight start hour',
      'Overnight end hour',
    ]) {
      expect(screen.getByLabelText(fieldName)).toBeInTheDocument()
    }

    expect(screen.queryByRole('button', { name: 'Save policy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument()

    const queueDecisions = screen.getByRole('region', { name: 'Action Queue decisions' })
    const manualReview = screen.getByRole('region', { name: 'Manual review' })
    const queueSaveButton = within(queueDecisions).getByRole('button', {
      name: 'Save Action Queue decisions',
    })
    const manualReviewSaveButton = within(manualReview).getByRole('button', {
      name: 'Save manual review',
    })

    for (const [sectionName, saveLabel] of [
      ['Action Queue decisions', 'Save Action Queue decisions'],
      ['Manual review', 'Save manual review'],
      ['Evidence requirements', 'Save evidence requirements'],
      ['Application gates', 'Save application gates'],
      ['Retry recovery', 'Save retry recovery'],
      ['Sourcing windows', 'Save sourcing windows'],
    ] as const) {
      expect(
        within(screen.getByRole('region', { name: sectionName })).getByRole('button', {
          name: saveLabel,
        }),
      ).toBeDisabled()
    }

    fireEvent.change(screen.getByLabelText('Apply cutoff'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Manual pickup delay'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Explicit approval companies'), {
      target: { value: 'TikTok\nByteDance\nOpenAI' },
    })

    expect(policyApi.config.update).not.toHaveBeenCalled()
    expect(queueSaveButton).toBeEnabled()
    expect(manualReviewSaveButton).toBeEnabled()

    fireEvent.click(queueSaveButton)

    await waitFor(() => {
      expect(policyApi.config.update).toHaveBeenCalledTimes(1)
    })

    expect(vi.mocked(policyApi.config.update).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        actionQueue: expect.objectContaining({
          staleLockHours: defaultPolicyConfig.actionQueue.staleLockHours,
        }),
        scoring: expect.objectContaining({
          applyCutoff: 7,
        }),
      }),
    )
    expect(await screen.findByText('Action Queue decisions saved.')).toBeInTheDocument()
    expect(queueSaveButton).toBeDisabled()
    expect(manualReviewSaveButton).toBeEnabled()
    expect(screen.getByLabelText('Manual pickup delay')).toHaveValue(8)

    fireEvent.click(manualReviewSaveButton)

    await waitFor(() => {
      expect(policyApi.config.update).toHaveBeenCalledTimes(2)
    })

    expect(vi.mocked(policyApi.config.update).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        manualReview: expect.objectContaining({
          explicitApprovalCompanyPatterns: ['TikTok', 'ByteDance', 'OpenAI'],
          pickupDelayHours: 8,
        }),
      }),
    )
    expect(await screen.findByText('Manual review saved.')).toBeInTheDocument()
    expect(manualReviewSaveButton).toBeDisabled()
  })

  it('resets policy defaults and clears pending section saves', async () => {
    const policyApi = createPolicyApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        policyApi={policyApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Policy' }))
    expect(await screen.findByRole('heading', { name: 'Policy' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Apply cutoff'), { target: { value: '9' } })
    expect(screen.getByLabelText('Apply cutoff')).toHaveValue(9)

    expect(
      within(screen.getByRole('region', { name: 'Action Queue decisions' })).getByRole('button', {
        name: 'Save Action Queue decisions',
      }),
    ).toBeEnabled()
    expect(policyApi.config.update).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reset policy' }))

    await waitFor(() => {
      expect(policyApi.config.reset).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByLabelText('Apply cutoff')).toHaveValue(defaultPolicyConfig.scoring.applyCutoff)
    expect(
      within(screen.getByRole('region', { name: 'Action Queue decisions' })).getByRole('button', {
        name: 'Save Action Queue decisions',
      }),
    ).toBeDisabled()
    expect(await screen.findByText('Policy reset.')).toBeInTheDocument()
  })

})
