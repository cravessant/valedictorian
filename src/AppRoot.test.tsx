import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

    expect(await screen.findByRole('heading', { name: 'Valedictorian' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Job Search' })).toBeEnabled()
    expect(screen.getByText('Job Search')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Missing Search unavailable' })).toBeDisabled()
    expect(screen.getByText('Missing Search')).toBeInTheDocument()
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
    expect(screen.getByRole('complementary', { name: 'Recent workspaces' })).toHaveClass(
      'bg-card',
      'pt-32',
    )
    expect(screen.getByRole('heading', { name: 'Valedictorian' })).toHaveClass('text-2xl')
    const recentEmpty = screen.getByText('No recent workspaces')
    expect(recentEmpty).not.toHaveClass('border')
    expect(recentEmpty).toHaveClass('px-2', 'py-2', 'text-sm', 'text-muted-foreground')
    expect(recentEmpty.closest('[data-slot="empty"]')).toBeNull()
    expect(screen.queryByLabelText(/Empty/i)).not.toBeInTheDocument()
    expect(container.querySelector('.lucide-gem')).toBeNull()
  })

  it('composes recent workspaces as Item rows with distinct Open and Remove controls', async () => {
    const recentWorkspaces = [
      {
        id: 'workspace-recent',
        lastOpenedAt: '2026-06-08T13:00:00.000Z',
        missing: false,
        name: 'Job Search',
        open: true,
        path: '/Users/keni/Job Search',
      },
      {
        id: 'workspace-missing',
        lastOpenedAt: '2026-06-08T12:00:00.000Z',
        missing: true,
        name: 'Missing Search',
        open: false,
        path: '/Users/keni/Missing Search',
      },
    ]
    const openRecent = vi.fn(async () => ({
      devOptions: {
        canSeedSampleData: false,
      },
      recentWorkspaces,
      status: 'needs-workspace' as const,
    }))
    const removeRecent = vi.fn(async () => ({
      devOptions: {
        canSeedSampleData: false,
      },
      recentWorkspaces: [recentWorkspaces[1]],
      status: 'needs-workspace' as const,
    }))

    render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi(
          {
            recentWorkspaces,
            status: 'needs-workspace',
          },
          { openRecent, removeRecent },
        )}
      />,
    )

    const openButton = await screen.findByRole('button', { name: 'Open Job Search' })
    const item = openButton.closest('[data-slot="item"]')
    expect(item).not.toBeNull()
    expect(item).toHaveAttribute('data-size', 'sm')
    expect(item!.closest('[data-slot="item-group"]')).not.toBeNull()

    const content = item!.querySelector('[data-slot="item-content"]')
    expect(content).not.toBeNull()
    expect(content!.querySelector('[data-slot="item-title"]')).toHaveTextContent('Job Search')
    const description = content!.querySelector('[data-slot="item-description"]')
    expect(description).toHaveTextContent('/Users/keni/Job Search')
    expect(description).toHaveClass('truncate', 'text-nowrap')
    expect(description).not.toHaveClass('text-balance')

    const removeButton = screen.getByRole('button', { name: 'Remove Job Search' })
    const actions = openButton.closest('[data-slot="item-actions"]')
    expect(actions).not.toBeNull()
    expect(actions).toContainElement(openButton)
    expect(actions).toContainElement(removeButton)
    expect(openButton.contains(removeButton)).toBe(false)
    expect(openButton.contains(content)).toBe(false)
    expect(removeButton.contains(content)).toBe(false)
    expect(item!.contains(content)).toBe(true)
    expect(item!.contains(actions)).toBe(true)

    fireEvent.click(openButton)
    await waitFor(() => expect(openRecent).toHaveBeenCalledWith('workspace-recent'))

    fireEvent.click(screen.getByRole('button', { name: 'Remove Job Search' }))
    await waitFor(() => expect(removeRecent).toHaveBeenCalledWith('workspace-recent'))

    const missingOpen = screen.getByRole('button', { name: 'Missing Search unavailable' })
    expect(missingOpen).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Missing Search' })).toBeEnabled()
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
    expect(screen.getByRole('button', { name: 'Open Mango' })).toBeInTheDocument()
    expect(screen.getByText('Mango')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Valedictorian' })).toBeInTheDocument()
    expect(screen.getByText('Create workspace')).toBeInTheDocument()
    expect(screen.getByText('Open folder as workspace')).toBeInTheDocument()
  })

  it('uses shared decorative separators at the create/open home boundary', async () => {
    const { container } = render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi({
          recentWorkspaces: [],
          status: 'needs-workspace',
        })}
      />,
    )

    await screen.findByRole('button', { name: 'Open folder' })

    const separators = container.querySelectorAll('[data-slot="item-separator"]')
    expect(separators).toHaveLength(1)
    expect(separators[0]).toHaveClass('my-4', 'bg-border')
    expect(separators[0]).toHaveAttribute('data-orientation', 'horizontal')
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('composes home Create and Open choices as Item rows with h2 semantics', async () => {
    render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi({
          recentWorkspaces: [],
          status: 'needs-workspace',
        })}
      />,
    )

    const createHeading = await screen.findByRole('heading', {
      level: 2,
      name: 'Create workspace',
    })
    const createItem = createHeading.closest('[data-slot="item"]')
    expect(createItem).not.toBeNull()
    expect(createItem!.closest('[data-slot="item-group"]')).not.toBeNull()
    expect(createItem).toHaveClass('border-transparent', 'px-0', 'py-1')
    expect(createItem).not.toHaveClass('px-4', 'py-3')
    expect(createHeading.closest('[data-slot="item-title"]')).not.toBeNull()
    expect(createItem!.querySelector('[data-slot="item-description"]')).toHaveTextContent(
      'Create a new workspace under a folder.',
    )
    expect(
      createItem!.querySelector('[data-slot="item-actions"]')?.querySelector(
        '[aria-label="Create workspace"]',
      ),
    ).not.toBeNull()

    const openHeading = screen.getByRole('heading', {
      level: 2,
      name: 'Open folder as workspace',
    })
    const openItem = openHeading.closest('[data-slot="item"]')
    expect(openItem).not.toBeNull()
    expect(openItem).toHaveClass('border-transparent', 'px-0', 'py-1')
    expect(openItem).not.toHaveClass('px-4', 'py-3')
    expect(openHeading.closest('[data-slot="item-title"]')).not.toBeNull()
    expect(openItem!.querySelector('[data-slot="item-description"]')).toHaveTextContent(
      'Open an existing workspace folder.',
    )
    expect(
      openItem!.querySelector('[data-slot="item-actions"]')?.querySelector(
        '[aria-label="Open folder"]',
      ),
    ).not.toBeNull()

    expect(screen.getByRole('button', { name: 'Create workspace' })).toHaveTextContent('Create')
    expect(screen.getByRole('button', { name: 'Open folder' })).toHaveTextContent('Open')
  })

  it('preserves Tab Enter and Space on launcher Item actions and skips disabled Open', async () => {
    const user = userEvent.setup()
    const openRecent = vi.fn(async () => ({
      devOptions: {
        canSeedSampleData: false,
      },
      recentWorkspaces: [
        {
          id: 'workspace-recent',
          lastOpenedAt: '2026-06-08T13:00:00.000Z',
          missing: false,
          name: 'Job Search',
          open: true,
          path: '/Users/keni/Job Search',
        },
        {
          id: 'workspace-missing',
          lastOpenedAt: '2026-06-08T12:00:00.000Z',
          missing: true,
          name: 'Missing Search',
          open: false,
          path: '/Users/keni/Missing Search',
        },
      ],
      status: 'needs-workspace' as const,
    }))
    const removeRecent = vi.fn(async () => ({
      devOptions: {
        canSeedSampleData: false,
      },
      recentWorkspaces: [
        {
          id: 'workspace-recent',
          lastOpenedAt: '2026-06-08T13:00:00.000Z',
          missing: false,
          name: 'Job Search',
          open: true,
          path: '/Users/keni/Job Search',
        },
        {
          id: 'workspace-missing',
          lastOpenedAt: '2026-06-08T12:00:00.000Z',
          missing: true,
          name: 'Missing Search',
          open: false,
          path: '/Users/keni/Missing Search',
        },
      ],
      status: 'needs-workspace' as const,
    }))
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
          {
            recentWorkspaces: [
              {
                id: 'workspace-recent',
                lastOpenedAt: '2026-06-08T13:00:00.000Z',
                missing: false,
                name: 'Job Search',
                open: true,
                path: '/Users/keni/Job Search',
              },
              {
                id: 'workspace-missing',
                lastOpenedAt: '2026-06-08T12:00:00.000Z',
                missing: true,
                name: 'Missing Search',
                open: false,
                path: '/Users/keni/Missing Search',
              },
            ],
            status: 'needs-workspace',
          },
          { openFolder, openRecent, removeRecent },
        )}
      />,
    )

    await screen.findByRole('button', { name: 'Open Job Search' })

    await user.tab()
    expect(screen.getByRole('button', { name: 'Open Job Search' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(openRecent).toHaveBeenCalledWith('workspace-recent'))

    await user.tab()
    expect(screen.getByRole('button', { name: 'Remove Job Search' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Remove Missing Search' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Missing Search unavailable' })).not.toHaveFocus()

    await user.keyboard(' ')
    await waitFor(() => expect(removeRecent).toHaveBeenCalledWith('workspace-missing'))

    await user.tab()
    expect(screen.getByRole('button', { name: 'Create workspace' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'Create local workspace' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByRole('button', { name: 'Open folder' })

    screen.getByRole('button', { name: 'Open folder' }).focus()
    await user.keyboard(' ')
    await waitFor(() => expect(openFolder).toHaveBeenCalled())
  })

  it('keeps create details on a compact secondary create screen', async () => {
    render(
      <AppRoot
        workspaceApi={createLauncherWorkspaceApi({
          recentWorkspaces: [],
          status: 'needs-workspace',
        })}
      />,
    )

    expect(await screen.findByRole('button', { name: 'Open folder' })).toHaveTextContent('Open')
    expect(screen.getByRole('button', { name: 'Create workspace' })).toHaveTextContent('Create')
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Seed demo data' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByRole('heading', { name: 'Create local workspace' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create local workspace' })).toHaveClass('text-lg')
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace name')).toHaveAttribute(
      'placeholder',
      'New workspace name',
    )
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

    fireEvent.click(await screen.findByRole('button', { name: 'Create workspace' }))

    const seedCheckbox = await screen.findByRole('checkbox', { name: 'Seed demo data' })

    expect(seedCheckbox).not.toBeChecked()
  })

  it('uses shared decorative separators on the create screen name, location, and seed boundaries', async () => {
    const { container } = render(
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

    fireEvent.click(await screen.findByRole('button', { name: 'Create workspace' }))
    await screen.findByRole('checkbox', { name: 'Seed demo data' })

    const separators = container.querySelectorAll('[data-slot="separator"]')
    expect(separators).toHaveLength(2)
    expect(separators[0]).toHaveClass('my-5', 'bg-border')
    expect(separators[1]).toHaveClass('my-5', 'bg-border')
    expect(screen.queryByRole('separator')).toBeNull()
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

    fireEvent.click(await screen.findByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByLabelText('Workspace name')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Seed demo data' })).not.toBeInTheDocument()
  })

  it('creates a workspace without seed data when the dev seed checkbox stays unchecked', async () => {
    const chooseCreateParentFolder = vi.fn(async () => '/Users/keni/Documents')
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
          { chooseCreateParentFolder, createWorkspace },
        )}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Create workspace' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Browse' }))
    expect(await screen.findByText('/Users/keni/Documents')).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: { value: 'Fresh Search' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() =>
      expect(createWorkspace).toHaveBeenCalledWith({
        name: 'Fresh Search',
        parentPath: '/Users/keni/Documents',
      }),
    )
  })

  it('creates a workspace with sample seed data when the dev seed checkbox is checked', async () => {
    const chooseCreateParentFolder = vi.fn(async () => '/Users/keni/Documents')
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
          { chooseCreateParentFolder, createWorkspace },
        )}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Create workspace' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Browse' }))
    expect(await screen.findByText('/Users/keni/Documents')).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: { value: 'Seeded Search' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seed demo data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() =>
      expect(createWorkspace).toHaveBeenCalledWith({
        name: 'Seeded Search',
        parentPath: '/Users/keni/Documents',
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
    expect(screen.getByRole('heading', { name: 'Valedictorian' })).toBeInTheDocument()
  })

  it('creates a workspace from the launcher and enters the main app', async () => {
    const workspace = createWorkspaceSummary({ name: 'Summer Search' })
    const chooseCreateParentFolder = vi.fn(async () => '/Users/keni/Documents')
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
          { chooseCreateParentFolder, createWorkspace },
        )}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Create workspace' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Browse' }))
    expect(await screen.findByText('/Users/keni/Documents')).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: { value: 'Summer Search' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() =>
      expect(createWorkspace).toHaveBeenCalledWith({
        name: 'Summer Search',
        parentPath: '/Users/keni/Documents',
      }),
    )
    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
  })
})
