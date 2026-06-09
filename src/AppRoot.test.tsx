import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppRoot from './AppRoot'
import {
  createApplication,
  createListResult,
  createWorkspaceApi,
  createWorkspaceSummary,
} from './App.test-helpers'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import type { WorkspaceLaunchState } from './workspace/workspace.service'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function createLauncherWorkspaceApi(
  initialState: WorkspaceLaunchState,
  overrides: Partial<WorkspacePreloadApi> = {},
): WorkspacePreloadApi {
  return {
    ...createWorkspaceApi(null),
    getLaunchState: vi.fn(async () => initialState),
    ...overrides,
  }
}

describe('AppRoot workspace gate', () => {
  it('renders the main app when launch state has an active workspace', async () => {
    const workspace = createWorkspaceSummary()

    render(
      <AppRoot
        appProps={{
          applicationLoader: () => Promise.resolve(createListResult([createApplication()])),
        }}
        workspaceApi={createWorkspaceApi(workspace)}
      />,
    )

    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
  })

  it('renders an in-app workspace launcher when no workspace is active', async () => {
    const missingWorkspace = {
      id: 'workspace-missing',
      lastOpenedAt: '2026-06-08T12:00:00.000Z',
      missing: true,
      name: 'Missing Search',
      open: false,
      path: '/Users/keni/Missing Search',
    }
    const recentWorkspace = {
      id: 'workspace-recent',
      lastOpenedAt: '2026-06-08T13:00:00.000Z',
      missing: false,
      name: 'Job Search',
      open: true,
      path: '/Users/keni/Job Search',
    }

    render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi({
          recentWorkspaces: [recentWorkspace, missingWorkspace],
          status: 'needs-workspace',
        })}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Open a workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Job Search' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Missing Search unavailable' })).toBeDisabled()
  })

  it('opens a folder from the launcher and enters the main app', async () => {
    const workspace = createWorkspaceSummary()
    const openFolder = vi.fn(async () => ({
      recentWorkspaces: [],
      status: 'active' as const,
      workspace,
    }))

    render(
      <AppRoot
        appProps={{
          applicationLoader: () => Promise.resolve(createListResult([createApplication()])),
        }}
        workspaceApi={createLauncherWorkspaceApi(
          { recentWorkspaces: [], status: 'needs-workspace' },
          { openFolder },
        )}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open folder' }))

    await waitFor(() => expect(openFolder).toHaveBeenCalled())
    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
  })

  it('stays on the launcher when opening a folder is canceled', async () => {
    const openFolder = vi.fn(async () => ({
      recentWorkspaces: [],
      status: 'needs-workspace' as const,
    }))

    render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi(
          { recentWorkspaces: [], status: 'needs-workspace' },
          { openFolder },
        )}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open folder' }))

    await waitFor(() => expect(openFolder).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: 'Open a workspace' })).toBeInTheDocument()
  })

  it('creates a workspace from the launcher and enters the main app', async () => {
    const workspace = createWorkspaceSummary({ name: 'Summer Search' })
    const createWorkspace = vi.fn(async () => ({
      recentWorkspaces: [],
      status: 'active' as const,
      workspace,
    }))

    render(
      <AppRoot
        appProps={{
          applicationLoader: () => Promise.resolve(createListResult([createApplication()])),
        }}
        workspaceApi={createLauncherWorkspaceApi(
          { recentWorkspaces: [], status: 'needs-workspace' },
          { createWorkspace },
        )}
      />,
    )

    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: { value: 'Summer Search' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith({ name: 'Summer Search' }))
    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
  })
})
