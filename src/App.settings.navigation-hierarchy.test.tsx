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

describe('navigation hierarchy', () => {
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

    const applicationsNav = within(sidebar).getByRole('button', { name: 'Applications' })
    expect(applicationsNav).toHaveClass('justify-start')
    expect(applicationsNav).not.toHaveClass('justify-center')
    expect(applicationsNav).toHaveAttribute('aria-current', 'page')
    expect(within(sidebar).getByRole('button', { name: 'Profile' })).not.toHaveAttribute(
      'aria-current',
      'page',
    )

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
    const overviewNav = within(appNavigation).getByRole('button', { name: 'Overview' })
    expect(overviewNav).toHaveClass('justify-start')
    expect(overviewNav).not.toHaveClass('justify-center')
    expect(overviewNav).toHaveAttribute(
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
    expect(within(appNavigation).queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument()
    expect(within(appNavigation).queryByRole('button', { name: 'Runs' })).not.toBeInTheDocument()
    const closedContent = document.getElementById(childrenId!)
    if (closedContent) {
      expect(closedContent).toHaveAttribute('data-slot', 'collapsible-content')
      expect(closedContent).toHaveAttribute('data-state', 'closed')
      expect(closedContent).toHaveAttribute('hidden')
    }

    fireEvent.click(connectorsToggle)

    expect(connectorsToggle).toHaveAttribute('aria-expanded', 'true')
    const children = document.getElementById(childrenId!)
    expect(children).toBeInTheDocument()
    expect(children).toHaveAttribute('data-slot', 'collapsible-content')
    expect(children).toHaveAttribute('data-state', 'open')
    expect(children).not.toHaveAttribute('hidden')
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

})
