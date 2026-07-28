import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceLaunchState, WorkspaceService } from '../workspace/workspace.service'
import { registerWorkspaceIpc } from './workspace.ipc'

const currentWorkspace = {
  id: 'workspace-1',
  name: 'Job Search',
  rootPath: '/Users/keni/Job Search',
  dataPath: '/Users/keni/Job Search/.valedictorian',
  manifestPath: '/Users/keni/Job Search/.valedictorian/manifest.json',
  appSettingsPath: '/Users/keni/Job Search/.valedictorian/app.json',
  profilePath: '/Users/keni/Job Search/.valedictorian/profile.json',
  pgliteDataPath: '/Users/keni/Job Search/.valedictorian/pglite',
  automationsPath: '/Users/keni/Job Search/.valedictorian/automations',
  promptsPath: '/Users/keni/Job Search/.valedictorian/prompts',
  templatesPath: '/Users/keni/Job Search/.valedictorian/templates',
  notesPath: '/Users/keni/Job Search/.valedictorian/notes',
}

describe('workspace IPC registration', () => {
  it('passes the invoking window to launcher folder picker handlers', async () => {
    const parentWindow = { id: 1 }
    const event = { sender: { id: 2 } }
    const service: WorkspaceService = {
      chooseCreateParentFolder: vi.fn(async () => '/Users/keni/Documents'),
      chooseFolder: vi.fn(async () => currentWorkspace),
      createWorkspace: vi.fn(async () => ({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'needs-workspace',
      } satisfies WorkspaceLaunchState)),
      getCurrent: vi.fn(),
      getLaunchState: vi.fn(),
      listRecent: vi.fn(),
      openFolder: vi.fn(async () => ({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'needs-workspace',
      } satisfies WorkspaceLaunchState)),
      openRecent: vi.fn(),
      removeRecent: vi.fn(),
      reveal: vi.fn(),
      revealCurrent: vi.fn(),
    }
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()

    registerWorkspaceIpc(
      service,
      {
        handle(channel, handler) {
          handlers.set(channel, handler)
        },
      },
      {
        getParentWindow(ipcEvent) {
          return ipcEvent === event ? parentWindow : null
        },
      },
    )

    await handlers.get('workspace:choose-create-parent-folder')?.(event)
    await handlers.get('workspace:choose-folder')?.(event)
    await handlers.get('workspace:open-folder')?.(event)
    await handlers.get('workspace:create-workspace')?.(event, { name: 'Draft Search' })

    expect(service.chooseCreateParentFolder).toHaveBeenCalledWith({ parentWindow })
    expect(service.chooseFolder).toHaveBeenCalledWith({ parentWindow })
    expect(service.openFolder).toHaveBeenCalledWith({ parentWindow })
    expect(service.createWorkspace).toHaveBeenCalledWith(
      { name: 'Draft Search' },
      { parentWindow },
    )
  })

  it('registers workspace handlers', async () => {
    const service: WorkspaceService = {
      chooseCreateParentFolder: vi.fn(async () => '/Users/keni/Documents'),
      chooseFolder: vi.fn(async () => currentWorkspace),
      createWorkspace: vi.fn(async () => ({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'active',
        workspace: currentWorkspace,
      } satisfies WorkspaceLaunchState)),
      getCurrent: vi.fn(async () => currentWorkspace),
      getLaunchState: vi.fn(async () => ({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'active',
        workspace: currentWorkspace,
      } satisfies WorkspaceLaunchState)),
      listRecent: vi.fn(async () => []),
      openFolder: vi.fn(async () => ({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'active',
        workspace: currentWorkspace,
      } satisfies WorkspaceLaunchState)),
      openRecent: vi.fn(async () => ({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'active',
        workspace: currentWorkspace,
      } satisfies WorkspaceLaunchState)),
      removeRecent: vi.fn(async () => ({
        devOptions: {
          canSeedSampleData: false,
        },
        recentWorkspaces: [],
        status: 'needs-workspace',
      } satisfies WorkspaceLaunchState)),
      reveal: vi.fn(async () => undefined),
      revealCurrent: vi.fn(async () => undefined),
    }
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()

    registerWorkspaceIpc(service, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    await expect(handlers.get('workspace:get-current')?.({})).resolves.toEqual(currentWorkspace)
    await expect(handlers.get('workspace:get-launch-state')?.({})).resolves.toMatchObject({
      status: 'active',
    })
    await expect(handlers.get('workspace:list-recent')?.({})).resolves.toEqual([])
    await expect(handlers.get('workspace:choose-create-parent-folder')?.({})).resolves.toBe(
      '/Users/keni/Documents',
    )
    await expect(handlers.get('workspace:choose-folder')?.({})).resolves.toEqual(currentWorkspace)
    await expect(handlers.get('workspace:open-folder')?.({})).resolves.toMatchObject({
      status: 'active',
    })
    await expect(handlers.get('workspace:open-recent')?.({}, 'workspace-1')).resolves.toMatchObject({
      status: 'active',
    })
    await expect(
      handlers.get('workspace:create-workspace')?.({}, {
        name: 'Summer Search',
        parentPath: '/Users/keni',
      }),
    ).resolves.toMatchObject({
      status: 'active',
    })
    await expect(handlers.get('workspace:remove-recent')?.({}, 'workspace-1')).resolves.toMatchObject({
      status: 'needs-workspace',
    })
    await expect(handlers.get('workspace:reveal')?.({}, '/Users/keni/Job Search')).resolves.toBeUndefined()
    await expect(handlers.get('workspace:reveal-current')?.({})).resolves.toBeUndefined()

    expect(service.getCurrent).toHaveBeenCalled()
    expect(service.getLaunchState).toHaveBeenCalled()
    expect(service.listRecent).toHaveBeenCalled()
    expect(service.chooseCreateParentFolder).toHaveBeenCalled()
    expect(service.chooseFolder).toHaveBeenCalled()
    expect(service.openFolder).toHaveBeenCalled()
    expect(service.openRecent).toHaveBeenCalledWith('workspace-1')
    expect(service.createWorkspace).toHaveBeenCalledWith(
      {
        name: 'Summer Search',
        parentPath: '/Users/keni',
      },
      { parentWindow: null },
    )
    expect(service.removeRecent).toHaveBeenCalledWith('workspace-1')
    expect(service.reveal).toHaveBeenCalledWith('/Users/keni/Job Search')
    expect(service.revealCurrent).toHaveBeenCalled()
  })
})
