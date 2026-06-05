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
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type {
  ApplicationListItem,
  ApplicationListQuery,
  ApplicationListResult,
} from './modules/applications/application.types'
import {
  defaultAppSettings,
  type AppSettings,
  type AppSettingsPatch,
} from './settings/app-settings'

afterEach(() => {
  cleanup()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { settings?: unknown }).settings
})

describe('App', () => {
  it('renders an accessible loading surface while applications load', () => {
    render(<App applicationLoader={() => new Promise(() => undefined)} />)

    expect(
      screen.getByRole('status', { name: 'Applications loading' }),
    ).toHaveTextContent('Loading applications...')
  })

  it('renders application rows from the configured loader', async () => {
    const result = createListResult([createApplication()])

    render(<App applicationLoader={() => Promise.resolve(result)} />)

    expect(
      screen.queryByRole('tablist', { name: 'Application views' }),
    ).not.toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Applications' })

    expect(within(table).getByText('Astranis Space Technologies')).toBeInTheDocument()
    expect(
      within(table).getByText('Software Engineer- Backend Intern (Fall 2026)'),
    ).toBeInTheDocument()
    expect(within(table).getByText('needs_user_info')).toBeInTheDocument()
    expect(within(table).getByText('8/10')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'official' })).toHaveAttribute(
      'href',
      'https://jobs.example.test/remediated/f60a3102c158cd7c',
    )
  })

  it('renders the virtualized table without lifecycle warnings', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      render(<App applicationLoader={() => Promise.resolve(createListResult([createApplication()]))} />)

      expect(await screen.findByText('Astranis Space Technologies')).toBeInTheDocument()

      expect(
        consoleError.mock.calls.some((call) => call.join(' ').includes('flushSync was called')),
      ).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('renders application rows from the paginated preload API', async () => {
    const result = createListResult([createApplication({ primaryLink: null, notes: null })])

    ;(window as Window & { applications?: { list: () => Promise<ApplicationListResult> } })
      .applications = {
      list: () => Promise.resolve(result),
    }

    render(<App />)

    expect(await screen.findByText('Astranis Space Technologies')).toBeInTheDocument()
  })

  it('keeps advanced filters collapsed behind search by default', async () => {
    const queries: ApplicationListQuery[] = []

    render(
      <App
        applicationLoader={(query) => {
          queries.push(query)
          return Promise.resolve(createListResult([createApplication()]))
        }}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    expect(screen.getByLabelText('Search')).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sort')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'astranis' } })

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        search: 'astranis',
        limit: 50,
        offset: 0,
      })
    })
  })

  it('renders the home page inside a left app sidebar with settings at the bottom', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    const sidebar = screen.getByRole('complementary', { name: 'Application navigation' })
    const shell = sidebar.parentElement

    expect(shell).toHaveClass('grid-cols-[280px_1fr]')
    expect(sidebar).toHaveClass('border-r')
    expect(within(sidebar).getByRole('button', { name: 'Applications' })).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: 'Settings' })).toBeInTheDocument()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  it('renders custom app chrome around the home view', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    const chrome = screen.getByRole('banner', { name: 'App chrome' })
    const sidebarToggle = within(chrome).getByRole('button', { name: 'Collapse sidebar' })

    expect(chrome).toHaveClass('app-drag')
    expect(chrome).toHaveClass('pl-20')
    expect(chrome).not.toHaveClass('pl-24')
    expect(sidebarToggle).toHaveClass('app-no-drag')
    expect(sidebarToggle).toHaveClass('h-8', 'w-8')
    expect(within(chrome).getByText('Applications')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Forward' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
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
    expect(main).toHaveClass('col-start-2')
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

    expect(within(dialog).getByText('Job App')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Use remote backend')).not.toBeChecked()
    expect(within(dialog).getByLabelText('Local API sharing')).not.toBeChecked()
    expect(within(dialog).getByLabelText('Show advanced filters')).not.toBeChecked()
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
      target: { value: 'https://job-app.test' },
    })

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({
        remoteApiUrl: 'https://job-app.test',
      })
    })
    expect(within(dialog).getByDisplayValue('https://job-app.test')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByLabelText('Show advanced filters'))

    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({ showAdvancedFilters: true })
    })
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
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

  it('keeps settings navigation in a real left sidebar layout', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    const shell = navigation.parentElement

    expect(shell).toHaveClass('grid-cols-[280px_1fr]')
    expect(navigation).toHaveClass('border-r')
    expect(navigation).not.toHaveClass('border-b')
  })

  it('renders functional settings panels and coming-later sidebar items', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Local desktop' })).toBeInTheDocument()
    expect(screen.getByLabelText('Show advanced filters')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Configuration' }))

    expect(screen.getByLabelText('Remote API URL')).toBeInTheDocument()
    expect(screen.getByLabelText('Local API host')).toBeInTheDocument()
    expect(screen.getByLabelText('Local API port')).toBeInTheDocument()
    expect(screen.getByLabelText('API token')).toBeInTheDocument()
    expect(screen.getByLabelText('SQLite path')).toHaveValue('Managed by Electron userData')

    fireEvent.click(screen.getByRole('button', { name: 'Agent access' }))

    expect(screen.getByText('Local API is available in local-shared mode.')).toBeInTheDocument()
    expect(screen.getByText(/JOB_APP_API_URL=http:\/\/127\.0\.0\.1:4317/)).toBeInTheDocument()
    expect(screen.getByText(/Tailscale/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))

    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByLabelText('Show advanced filters')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))

    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByText('Coming later')).toBeInTheDocument()
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

  it('keeps the current table visible while refreshed rows are loading', async () => {
    let loadCount = 0

    render(
      <App
        applicationLoader={() => {
          loadCount += 1

          return loadCount === 1
            ? Promise.resolve(createListResult([createApplication()]))
            : new Promise(() => undefined)
        }}
      />,
    )

    expect(await screen.findByText('Astranis Space Technologies')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'backend' } })

    await waitFor(() => {
      expect(loadCount).toBe(2)
    })

    expect(
      screen.queryByRole('status', { name: 'Applications loading' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.getByText('Astranis Space Technologies')).toBeInTheDocument()
  })

  it('reloads rows with expanded human filter controls', async () => {
    const queries: ApplicationListQuery[] = []

    render(
      <App
        applicationLoader={(query) => {
          queries.push(query)
          return Promise.resolve(createListResult([createApplication()]))
        }}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }))
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'needs_user_info' },
    })
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'company_asc' } })

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        status: 'needs_user_info',
        sort: 'company_asc',
        limit: 50,
        offset: 0,
      })
    })
  })

  it('passes created and updated date ranges from the toolbar', async () => {
    const queries: ApplicationListQuery[] = []

    render(
      <App
        applicationLoader={(query) => {
          queries.push(query)
          return Promise.resolve(createListResult([createApplication()]))
        }}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }))
    fireEvent.change(screen.getByLabelText('Created from'), {
      target: { value: '2026-06-01' },
    })
    fireEvent.change(screen.getByLabelText('Created to'), {
      target: { value: '2026-06-02' },
    })
    fireEvent.change(screen.getByLabelText('Updated from'), {
      target: { value: '2026-06-03' },
    })
    fireEvent.change(screen.getByLabelText('Updated to'), {
      target: { value: '2026-06-04' },
    })

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        createdFrom: '2026-06-01T00:00:00.000Z',
        createdTo: '2026-06-02T23:59:59.999Z',
        updatedFrom: '2026-06-03T00:00:00.000Z',
        updatedTo: '2026-06-04T23:59:59.999Z',
      })
    })
  })

  it('places reset in a separate expanded filter action row', async () => {
    render(<App applicationLoader={() => Promise.resolve(createListResult([createApplication()]))} />)

    await screen.findByRole('table', { name: 'Applications' })

    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }))

    const actions = screen.getByRole('group', { name: 'Filter actions' })

    expect(
      within(actions).getByRole('button', { name: 'Reset filters' }),
    ).toBeInTheDocument()
  })

  it('clears filters with reset', async () => {
    const queries: ApplicationListQuery[] = []

    render(
      <App
        applicationLoader={(query) => {
          queries.push(query)
          return Promise.resolve(createListResult([createApplication()]))
        }}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'astranis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }))
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'needs_user_info' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))

    await waitFor(() => {
      expect(queries.at(-1)).toEqual({
        limit: 50,
        offset: 0,
        sort: 'priority_desc',
      })
    })
  })

  it('pages through application results', async () => {
    const queries: ApplicationListQuery[] = []

    render(
      <App
        applicationLoader={(query) => {
          queries.push(query)
          return Promise.resolve({
            ...createListResult([createApplication()]),
            total: 80,
            offset: query.offset ?? 0,
            hasMore: (query.offset ?? 0) + 50 < 80,
          })
        }}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({ offset: 50, limit: 50 })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({ offset: 0, limit: 50 })
    })
  })

  it('reloads rows when sortable table headers are clicked', async () => {
    const queries: ApplicationListQuery[] = []

    render(
      <App
        applicationLoader={(query) => {
          queries.push(query)
          return Promise.resolve(createListResult([createApplication()]))
        }}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Sort by company' }))

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        sort: 'company_asc',
        limit: 50,
        offset: 0,
      })
    })
  })

  it('hides optional columns from the table without reloading rows', async () => {
    const queries: ApplicationListQuery[] = []

    render(
      <App
        applicationLoader={(query) => {
          queries.push(query)
          return Promise.resolve(createListResult([createApplication()]))
        }}
      />,
    )

    const table = await screen.findByRole('table', { name: 'Applications' })
    const initialQueryCount = queries.length

    expect(within(table).getByText('LinkedIn')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Source column' }))

    expect(within(table).queryByText('LinkedIn')).not.toBeInTheDocument()
    expect(queries).toHaveLength(initialQueryCount)
  })

  it('tracks selected rows locally', async () => {
    render(<App applicationLoader={() => Promise.resolve(createListResult([createApplication()]))} />)

    await screen.findByRole('table', { name: 'Applications' })

    expect(screen.getByText('0 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Astranis Space Technologies' }))

    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('virtualizes rows inside the current page and reveals later rows on scroll', async () => {
    const applications = Array.from({ length: 80 }, (_, index) =>
      createApplication({
        id: `application-${index}`,
        companyName: `Company ${index}`,
        roleTitle: `Role ${index}`,
        primaryLink: null,
      }),
    )

    render(<App applicationLoader={() => Promise.resolve(createListResult(applications))} />)

    const viewport = await screen.findByRole('region', {
      name: 'Applications table viewport',
    })
    const table = screen.getByRole('table', { name: 'Applications' })

    expect(within(table).getByText('Company 0')).toBeInTheDocument()
    expect(within(table).queryByText('Company 40')).not.toBeInTheDocument()

    fireEvent.scroll(viewport, {
      target: {
        scrollTop: 40 * 54,
      },
    })

    await waitFor(() => {
      expect(within(table).getByText('Company 40')).toBeInTheDocument()
    })
  })
})

function createApplication(
  overrides: Partial<ApplicationListItem> = {},
): ApplicationListItem {
  return {
    id: 'application-1',
    companyName: 'Astranis Space Technologies',
    roleTitle: 'Software Engineer- Backend Intern (Fall 2026)',
    sourceName: 'LinkedIn',
    status: 'needs_user_info',
    term: 'Fall 2026 internship',
    location: 'San Francisco, CA / Onsite',
    workMode: 'onsite',
    hasApplied: false,
    currentPriorityScore: 8,
    currentPriorityBand: 'high',
    primaryLink: {
      label: 'official',
      url: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
    },
    notes: 'Needs availability answers.',
    createdAt: '2026-06-04T16:00:00.000Z',
    updatedAt: '2026-06-04T16:00:00.000Z',
    ...overrides,
  }
}

function createListResult(items: ApplicationListItem[]): ApplicationListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

async function openSettingsPage() {
  await screen.findByRole('table', { name: 'Applications' })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
}

function createSettingsApi(overrides: Partial<AppSettings> = {}): SettingsPreloadApi {
  let currentSettings: AppSettings = {
    ...defaultAppSettings,
    ...overrides,
  }

  return {
    get: vi.fn(async () => currentSettings),
    reset: vi.fn(async () => {
      currentSettings = { ...defaultAppSettings }
      return currentSettings
    }),
    update: vi.fn(async (patch: AppSettingsPatch) => {
      currentSettings = {
        ...currentSettings,
        ...patch,
      }

      return currentSettings
    }),
  }
}
