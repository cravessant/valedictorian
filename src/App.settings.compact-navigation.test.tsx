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
  createListResult,
  createSettingsApi,
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

describe('compact navigation', () => {
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

})
