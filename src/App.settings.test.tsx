import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createListResult,
  createPolicyApi,
  createProfileApi,
  createSettingsApi,
  createWorkspaceApi,
  openSettingsPage,
} from './App.test-helpers'
import { defaultPolicyConfig } from 'sparxie'

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
    ).toEqual(['Profile', 'Applications', 'Action Queue', 'Sourcing'])

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
    expect(within(navigation).getByRole('button', { name: 'Agent access' })).toBeInTheDocument()
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
