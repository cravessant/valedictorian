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
import type { WorkspaceDevOptions, WorkspaceLaunchState } from './workspace/workspace.service'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type WorkspaceLaunchStateInput =
  | (Omit<Extract<WorkspaceLaunchState, { status: 'active' }>, 'devOptions'> & {
      devOptions?: WorkspaceDevOptions
    })
  | (Omit<Extract<WorkspaceLaunchState, { status: 'needs-workspace' }>, 'devOptions'> & {
      devOptions?: WorkspaceDevOptions
    })

function createLauncherWorkspaceApi(
  initialState: WorkspaceLaunchStateInput,
  overrides: Partial<WorkspacePreloadApi> = {},
): WorkspacePreloadApi {
  return {
    ...createWorkspaceApi(null),
    getLaunchState: vi.fn(async () => ({
      devOptions: {
        canSeedSampleData: false,
      },
      ...initialState,
    } as WorkspaceLaunchState)),
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

    expect(await screen.findByRole('heading', { name: 'Job Automation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Job Search' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Open Job Search' })).toHaveTextContent('Job Search')
    expect(screen.getByRole('button', { name: 'Missing Search unavailable' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Missing Search unavailable' })).toHaveTextContent(
      'Missing Search',
    )
  })

  it('renders the workspace launcher in an Obsidian-style two-pane shell', async () => {
    const { container } = render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi({
          recentWorkspaces: [],
          status: 'needs-workspace',
        })}
      />,
    )

    const shell = await screen.findByTestId('workspace-launcher-shell')

    expect(shell).toHaveClass('grid')
    expect(shell).toHaveClass('grid-cols-[250px_minmax(0,1fr)]')
    expect(shell).toHaveClass('bg-card')
    expect(screen.getByRole('main')).toHaveClass('bg-background')
    expect(screen.getByRole('complementary', { name: 'Recent workspaces' })).toHaveClass('bg-card')
    expect(screen.getByRole('heading', { name: 'Job Automation' })).toHaveClass('text-4xl')
    expect(screen.getByText('No recent workspaces')).not.toHaveClass('border')
    expect(container.querySelector('.lucide-gem')).toBeNull()
  })

  it('renders an Obsidian-style launcher with a recent sidebar and action panel', async () => {
    render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi({
          recentWorkspaces: [
            {
              id: 'workspace-recent',
              lastOpenedAt: '2026-06-08T13:00:00.000Z',
              missing: false,
              name: 'Mango',
              open: true,
              path: '/Users/keni/Documents',
            },
          ],
          status: 'needs-workspace',
        })}
      />,
    )

    expect(await screen.findByTestId('workspace-launcher-shell')).toHaveClass(
      'grid-cols-[250px_minmax(0,1fr)]',
    )
    expect(screen.getByRole('complementary', { name: 'Recent workspaces' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Mango' })).toHaveTextContent('Mango')
    expect(screen.getByRole('heading', { name: 'Job Automation' })).toBeInTheDocument()
    expect(screen.getByText('Create workspace')).toBeInTheDocument()
    expect(screen.getByText('Open folder as workspace')).toBeInTheDocument()
  })

  it('uses concise Obsidian-style launcher actions', async () => {
    render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi({
          recentWorkspaces: [],
          status: 'needs-workspace',
        })}
      />,
    )

    expect(await screen.findByRole('button', { name: 'Open folder' })).toHaveTextContent('Open')
    expect(screen.getByLabelText('Workspace name')).toHaveAttribute(
      'placeholder',
      'New workspace name',
    )
    expect(screen.getByRole('button', { name: 'Create workspace' })).toHaveTextContent('Create')
  })

  it('shows an unchecked dev-only seed checkbox when sample seeding is available', async () => {
    render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi({
          devOptions: {
            canSeedSampleData: true,
          },
          recentWorkspaces: [],
          status: 'needs-workspace',
        })}
      />,
    )

    const seedCheckbox = await screen.findByRole('checkbox', { name: 'Seed demo data' })

    expect(seedCheckbox).not.toBeChecked()
  })

  it('does not show the seed checkbox when sample seeding is unavailable', async () => {
    render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi({
          devOptions: {
            canSeedSampleData: false,
          },
          recentWorkspaces: [],
          status: 'needs-workspace',
        })}
      />,
    )

    expect(await screen.findByLabelText('Workspace name')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Seed demo data' })).not.toBeInTheDocument()
  })

  it('creates a workspace without seed data when the dev seed checkbox stays unchecked', async () => {
    const createWorkspace = vi.fn(async () => ({
      devOptions: {
        canSeedSampleData: true,
      },
      recentWorkspaces: [],
      status: 'needs-workspace' as const,
    }))

    render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi(
          {
            devOptions: {
              canSeedSampleData: true,
            },
            recentWorkspaces: [],
            status: 'needs-workspace',
          },
          { createWorkspace },
        )}
      />,
    )

    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: { value: 'Fresh Search' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith({ name: 'Fresh Search' }))
  })

  it('creates a workspace with sample seed data when the dev seed checkbox is checked', async () => {
    const createWorkspace = vi.fn(async () => ({
      devOptions: {
        canSeedSampleData: true,
      },
      recentWorkspaces: [],
      status: 'needs-workspace' as const,
    }))

    render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi(
          {
            devOptions: {
              canSeedSampleData: true,
            },
            recentWorkspaces: [],
            status: 'needs-workspace',
          },
          { createWorkspace },
        )}
      />,
    )

    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: { value: 'Seeded Search' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seed demo data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() =>
      expect(createWorkspace).toHaveBeenCalledWith({
        name: 'Seeded Search',
        seedData: 'sample',
      }),
    )
  })

  it('opens a folder from the launcher and enters the main app', async () => {
    const workspace = createWorkspaceSummary()
    const openFolder = vi.fn(async () => ({
      devOptions: {
        canSeedSampleData: false,
      },
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
      devOptions: {
        canSeedSampleData: false,
      },
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
    expect(screen.getByRole('heading', { name: 'Job Automation' })).toBeInTheDocument()
  })

  it('creates a workspace from the launcher and enters the main app', async () => {
    const workspace = createWorkspaceSummary({ name: 'Summer Search' })
    const createWorkspace = vi.fn(async () => ({
      devOptions: {
        canSeedSampleData: false,
      },
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
