// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { createConnectorsApi } from './App.test-helpers'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import { defaultAppSettings, type AppSettings } from './settings/app-settings'

const originalMatchMedia = window.matchMedia

afterEach(() => {
  cleanup()
  window.matchMedia = originalMatchMedia
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
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
