// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ValedictorianWorkspaceClient } from '@sparxie/sdk'

import App from './App'
import { createConnectorsApi, createUpdatesApi } from './App.test-helpers'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import { defaultAppSettings, type AppSettings } from './settings/app-settings'

const originalMatchMedia = window.matchMedia

afterEach(() => {
  cleanup()
  window.matchMedia = originalMatchMedia
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
  delete (window as Window & { valedictorianNavigation?: unknown }).valedictorianNavigation
  window.history.replaceState(null, '', '/')
})

describe('App sidebar navigation', () => {
  it('mounts the application chrome and keeps sidebar and lifecycle rail selection aligned', async () => {
    const user = userEvent.setup()
    const { settingsApi, workspaceApi } = installAppApis()

    render(
      <App
        settingsApi={settingsApi}
        workspaceApi={workspaceApi}
        connectorsApi={createConnectorsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Captures' })
    const sidebar = screen.getByRole('complementary', { name: 'Application navigation' })
    expect(within(sidebar).getByText('Job lifecycle')).toBeInTheDocument()
    expect(within(sidebar).getByText('Workspace data')).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: 'Companies' })).toBeInTheDocument()
    expect(screen.getByRole('banner', { name: 'App chrome' })).toHaveTextContent('Pancake · Captures')
    expect(within(sidebar).getByRole('button', { name: 'Captures' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.queryByText(/Canonical Captures, Jobs/)).not.toBeInTheDocument()

    await user.click(within(sidebar).getByRole('button', { name: 'Jobs' }))
    await screen.findByRole('table', { name: 'Jobs' })
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'jobs')

    const lifecycleRail = screen.getByRole('navigation', { name: 'Lifecycle phase' })
    await user.click(within(lifecycleRail).getByRole('button', { name: /^Applications/ }))
    await screen.findByRole('table', { name: 'Applications' })
    expect(within(sidebar).getByRole('button', { name: 'Applications' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await user.click(within(sidebar).getByRole('button', { name: 'Companies' }))
    expect(await screen.findByRole('heading', { name: 'Companies' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Lifecycle phase' })).not.toBeInTheDocument()
  })

  it('persists desktop collapse and expand through the settings API', async () => {
    const user = userEvent.setup()
    const { settingsApi, workspaceApi } = installAppApis()

    render(
      <App
        settingsApi={settingsApi}
        workspaceApi={workspaceApi}
        connectorsApi={createConnectorsApi()}
      />,
    )
    await screen.findByRole('table', { name: 'Captures' })

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'collapsed')
    })
    expect(screen.queryByRole('complementary', { name: 'Application navigation' }))
      .not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show sidebar temporarily' }))
      .not.toBeInTheDocument()
    expect(screen.getByTestId('app-layout')).toHaveClass('md:grid-cols-1')
    expect(settingsApi.update).toHaveBeenLastCalledWith({ sidebarCollapsed: true })

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(await screen.findByRole('complementary', { name: 'Application navigation' }))
      .toBeInTheDocument()
    expect(settingsApi.update).toHaveBeenLastCalledWith({ sidebarCollapsed: false })
  })

  it('opens and closes the sidebar as a narrow viewport drawer', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    const user = userEvent.setup()
    const { settingsApi, workspaceApi } = installAppApis()

    render(
      <App
        settingsApi={settingsApi}
        workspaceApi={workspaceApi}
        connectorsApi={createConnectorsApi()}
      />,
    )
    await screen.findByRole('table', { name: 'Captures' })
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'drawer-closed')

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'drawer-open')
    expect(screen.getByRole('complementary', { name: 'Application navigation' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close sidebar drawer' }))
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-sidebar-state', 'drawer-closed')
    expect(settingsApi.update).not.toHaveBeenCalled()
  })

  it('opens quick settings and routes its footer action to the full settings page', async () => {
    const user = userEvent.setup()
    const { settingsApi, workspaceApi } = installAppApis()

    render(
      <App
        settingsApi={settingsApi}
        workspaceApi={workspaceApi}
        connectorsApi={createConnectorsApi()}
      />,
    )
    await screen.findByRole('table', { name: 'Captures' })

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const quickSettings = screen.getByRole('dialog', { name: 'Quick settings' })
    expect(within(quickSettings).getByRole('button', { name: 'Open all settings' }))
      .toBeInTheDocument()

    await user.click(within(quickSettings).getByRole('button', { name: 'Open all settings' }))
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'settings')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Settings navigation' })).toBeInTheDocument()
  })

  it('opens full settings from the buffered native navigation subscription', async () => {
    let openSettings: (() => void) | undefined
    Object.defineProperty(window, 'valedictorianNavigation', {
      configurable: true,
      value: {
        onOpenSettings(listener: () => void) {
          openSettings = listener
          return () => undefined
        },
      },
    })
    const { settingsApi, workspaceApi } = installAppApis()

    render(
      <App
        settingsApi={settingsApi}
        workspaceApi={workspaceApi}
        connectorsApi={createConnectorsApi()}
      />,
    )
    await screen.findByRole('table', { name: 'Captures' })

    act(() => openSettings?.())
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'settings')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('keeps the updater action in the main app topbar when updates are enabled', async () => {
    const user = userEvent.setup()
    const updatesApi = createUpdatesApi({ currentVersion: '0.1.0', status: 'idle' })
    const { settingsApi, workspaceApi } = installAppApis()

    render(
      <App
        settingsApi={settingsApi}
        workspaceApi={workspaceApi}
        connectorsApi={createConnectorsApi()}
        updatesApi={updatesApi}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Check for updates' }))
    expect(updatesApi.check).toHaveBeenCalledOnce()
  })

  it('switches workspace surfaces atomically on popstate without a cross-type lookup', async () => {
    const companyId = 'company-one'
    const jobId = '01900000-0000-7000-8000-000000000001'
    window.history.replaceState({
      location: { view: 'companies', resourceId: companyId },
      cursorChain: [],
    }, '', `/?view=companies&resource=${companyId}`)
    const companiesGet = vi.fn(async () => ({
      lookup: {
        requested: {
          id: companyId,
          displayName: 'Company One',
          websiteUrl: null,
          status: 'active',
          aliases: [],
          notes: null,
        },
        canonical: { id: companyId, displayName: 'Company One' },
      },
      assignedJobCount: 1,
    }))
    const jobsGet = vi.fn(async () => ({
      id: jobId,
      facts: {
        roleTitle: 'Atomic Job',
        companyName: 'Company One',
        sourceName: 'Test',
      },
      availability: { state: 'active' },
    }))
    const emptyLifecyclePage = async () => ({
      items: [],
      limit: 50,
      nextCursor: null,
    })
    const workspaceClient = {
      captures: { list: vi.fn(emptyLifecyclePage) },
      jobs: { list: vi.fn(emptyLifecyclePage), get: jobsGet },
      companyAssignments: {
        get: vi.fn(async () => ({
          jobId,
          assignmentRevision: 1,
          workspaceCompany: {
            companyId,
            revision: 1,
            displayName: 'Company One',
            status: 'active',
          },
          jobFactsCompanyName: 'Company One',
          roleTitle: 'Atomic Job',
          namesDiffer: false,
        })),
      },
      opportunities: { list: vi.fn(emptyLifecyclePage) },
      applications: { list: vi.fn(emptyLifecyclePage) },
      companies: {
        capability: {
          get: vi.fn(async () => ({ status: 'ready' as const })),
        },
        get: companiesGet,
        directory: {
          list: vi.fn(async () => ({
            items: [],
            pageInfo: {
              startCursor: null,
              endCursor: null,
              hasPreviousPage: false,
              hasNextPage: false,
            },
            totalCount: 0,
          })),
        },
        assignedJobs: {
          list: vi.fn(async () => ({
            items: [],
            pageInfo: {
              startCursor: null,
              endCursor: null,
              hasPreviousPage: false,
              hasNextPage: false,
            },
            totalCount: 0,
          })),
        },
      },
    } as unknown as ValedictorianWorkspaceClient
    const { settingsApi, workspaceApi } = installAppApis()
    render(
      <App
        settingsApi={settingsApi}
        workspaceApi={workspaceApi}
        connectorsApi={createConnectorsApi()}
        workspaceClient={workspaceClient}
      />,
    )
    await screen.findByRole('heading', { name: 'Company One' })

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', {
        state: {
          location: { view: 'jobs', resourceId: jobId },
          cursorChain: [],
        },
      }))
    })

    expect(await screen.findByRole('heading', { name: 'Atomic Job' })).toHaveFocus()
    expect(companiesGet.mock.calls).toEqual([[companyId]])
    expect(jobsGet.mock.calls).toEqual([[jobId]])
  })
})

function installAppApis(): {
  settingsApi: SettingsPreloadApi
  workspaceApi: WorkspacePreloadApi
} {
  let settings: AppSettings = defaultAppSettings
  const settingsApi: SettingsPreloadApi = {
    get: vi.fn(async () => settings),
    reset: vi.fn(async () => defaultAppSettings),
    update: vi.fn(async (patch) => {
      settings = { ...settings, ...patch }
      return settings
    }),
  }
  const workspaceApi = {
    getCurrent: vi.fn(async () => ({
      id: 'workspace-one',
      name: 'Pancake',
      path: '/tmp/pancake',
    })),
  } as unknown as WorkspacePreloadApi
  Object.defineProperty(window, 'valedictorianHttp', {
    configurable: true,
    value: {
      apiBaseUrl: 'http://127.0.0.1:4317',
      workspaceId: 'workspace-one',
      request: vi.fn(async () => new Response(JSON.stringify({
        items: [],
        limit: 100,
        nextCursor: null,
      }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })),
      getBackendState: () => ({ status: 'available', origin: 'http://127.0.0.1:4317' }),
      onBackendStateChanged: () => vi.fn(),
    },
  })
  return { settingsApi, workspaceApi }
}
