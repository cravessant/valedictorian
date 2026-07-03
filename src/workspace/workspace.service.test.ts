import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFileWorkspaceRegistryStore } from './workspace.registry'
import { initializeWorkspace } from './workspace.initializer'
import {
  createWorkspaceService,
  resolveWorkspaceLaunchState,
  resolveInitialWorkspace,
} from './workspace.service'

function createTempPath(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function createTempRegistryStore(prefix: string) {
  return createFileWorkspaceRegistryStore(
    path.join(createTempPath(prefix), 'workspaces.json'),
  )
}

describe('workspace launch state', () => {
  it('returns launcher state without asking the user to choose a folder when no workspace exists', async () => {
    const registryStore = createTempRegistryStore('valedictorian-empty-registry-')

    await expect(
      resolveWorkspaceLaunchState({
        env: {},
        registryStore,
      }),
    ).resolves.toEqual({
      devOptions: {
        canSeedSampleData: false,
      },
      recentWorkspaces: [],
      status: 'needs-workspace',
    })
  })

  it('includes dev-only seed capability in launcher state when enabled', async () => {
    const registryStore = createTempRegistryStore('valedictorian-dev-registry-')

    await expect(
      resolveWorkspaceLaunchState({
        canSeedSampleData: true,
        env: {},
        registryStore,
      }),
    ).resolves.toEqual({
      devOptions: {
        canSeedSampleData: true,
      },
      recentWorkspaces: [],
      status: 'needs-workspace',
    })
  })

  it('opens VALEDICTORIAN_WORKSPACE_PATH as active launch state', async () => {
    const workspaceRoot = createTempPath('valedictorian-env-workspace-')
    const registryStore = createTempRegistryStore('valedictorian-env-registry-')

    const launchState = await resolveWorkspaceLaunchState({
      env: { VALEDICTORIAN_WORKSPACE_PATH: workspaceRoot },
      registryStore,
    })

    expect(launchState).toMatchObject({
      status: 'active',
      workspace: {
        rootPath: workspaceRoot,
      },
    })
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: launchState.status === 'active' ? launchState.workspace.id : null,
    })
  })

  it('auto-opens the last valid workspace as active launch state', async () => {
    const workspaceRoot = createTempPath('valedictorian-recent-workspace-')
    const workspace = initializeWorkspace(workspaceRoot, { createId: () => 'workspace-recent' })
    const registryStore = createTempRegistryStore('valedictorian-recent-registry-')
    await registryStore.markOpened({
      id: workspace.id,
      name: workspace.name,
      path: workspace.rootPath,
    })

    await expect(
      resolveWorkspaceLaunchState({
        env: {},
        registryStore,
      }),
    ).resolves.toMatchObject({
      status: 'active',
      workspace: {
        id: workspace.id,
        rootPath: workspaceRoot,
      },
    })
  })

  it('returns launcher state with missing recent workspace metadata', async () => {
    const missingPath = path.join(os.tmpdir(), 'valedictorian-missing-workspace')
    const registryStore = createTempRegistryStore('valedictorian-missing-registry-')
    await registryStore.markOpened({
      id: 'workspace-missing',
      name: 'Missing Search',
      path: missingPath,
    })

    await expect(
      resolveWorkspaceLaunchState({
        env: {},
        pathExists: () => false,
        registryStore,
      }),
    ).resolves.toEqual({
      devOptions: {
        canSeedSampleData: false,
      },
      recentWorkspaces: [
        {
          id: 'workspace-missing',
          lastOpenedAt: expect.any(String),
          latestError: null,
          missing: true,
          name: 'Missing Search',
          open: true,
          path: missingPath,
        },
      ],
      status: 'needs-workspace',
    })
  })
})

describe('workspace startup resolution', () => {
  it('opens VALEDICTORIAN_WORKSPACE_PATH without showing the picker', async () => {
    const workspaceRoot = createTempPath('valedictorian-env-workspace-')
    const registryStore = createTempRegistryStore('valedictorian-env-registry-')
    const chooseWorkspaceRoot = vi.fn(async () => null)

    const workspace = await resolveInitialWorkspace({
      chooseWorkspaceRoot,
      env: { VALEDICTORIAN_WORKSPACE_PATH: workspaceRoot },
      registryStore,
    })

    expect(workspace?.rootPath).toBe(workspaceRoot)
    expect(chooseWorkspaceRoot).not.toHaveBeenCalled()
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: workspace?.id,
    })
  })

  it('auto-opens the last valid workspace before asking the user to choose', async () => {
    const workspaceRoot = createTempPath('valedictorian-recent-workspace-')
    const registryStore = createTempRegistryStore('valedictorian-recent-registry-')
    const workspace = await resolveInitialWorkspace({
      chooseWorkspaceRoot: vi.fn(async () => workspaceRoot),
      env: {},
      registryStore,
    })
    const chooseWorkspaceRoot = vi.fn(async () => null)

    const reopenedWorkspace = await resolveInitialWorkspace({
      chooseWorkspaceRoot,
      env: {},
      registryStore,
    })

    expect(reopenedWorkspace?.rootPath).toBe(workspace?.rootPath)
    expect(chooseWorkspaceRoot).not.toHaveBeenCalled()
  })
})

describe('workspace service', () => {
  it('opens a folder from the launcher and activates runtime without relaunching', async () => {
    const nextRoot = createTempPath('valedictorian-launcher-open-workspace-')
    const registryStore = createTempRegistryStore('valedictorian-launcher-service-registry-')
    const activateWorkspace = vi.fn(async () => undefined)
    const relaunchApp = vi.fn()
    const service = createWorkspaceService({
      activateWorkspace,
      chooseWorkspaceRoot: vi.fn(async () => nextRoot),
      currentWorkspace: null,
      registryStore,
      relaunchApp,
      revealPath: vi.fn(),
    })

    const launchState = await service.openFolder()

    expect(launchState).toMatchObject({
      status: 'active',
      workspace: {
        rootPath: nextRoot,
      },
    })
    expect(activateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: nextRoot }),
      { seedData: 'none' },
    )
    expect(relaunchApp).not.toHaveBeenCalled()
  })

  it('stays in switcher launcher state when opening a folder is canceled', async () => {
    const currentRoot = createTempPath('valedictorian-switcher-current-workspace-')
    const currentWorkspace = initializeWorkspace(currentRoot, { createId: () => 'workspace-current' })
    const registryStore = createTempRegistryStore('valedictorian-switcher-cancel-registry-')
    await registryStore.markOpened({
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      path: currentWorkspace.rootPath,
    })
    const activateWorkspace = vi.fn(async () => undefined)
    const relaunchApp = vi.fn()
    const service = createWorkspaceService({
      activateWorkspace,
      chooseWorkspaceRoot: vi.fn(async () => null),
      currentWorkspace,
      registryStore,
      relaunchApp,
      revealPath: vi.fn(),
      showWorkspaceSwitcher: () => true,
    })

    const launchState = await service.openFolder()

    expect(launchState).toMatchObject({
      recentWorkspaces: [
        expect.objectContaining({
          id: currentWorkspace.id,
          missing: false,
        }),
      ],
      status: 'needs-workspace',
    })
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: currentWorkspace.id,
    })
    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(relaunchApp).not.toHaveBeenCalled()
  })

  it('returns the current workspace after launcher activation updates shared state', async () => {
    const nextRoot = createTempPath('valedictorian-launcher-current-workspace-')
    const registryStore = createTempRegistryStore('valedictorian-launcher-current-registry-')
    let currentWorkspace: ReturnType<typeof initializeWorkspace> | null = null
    const service = createWorkspaceService({
      activateWorkspace: vi.fn(async (workspace) => {
        currentWorkspace = workspace
      }),
      chooseWorkspaceRoot: vi.fn(async () => nextRoot),
      currentWorkspace: () => currentWorkspace,
      registryStore,
      relaunchApp: vi.fn(),
      revealPath: vi.fn(),
    })

    await service.openFolder()

    await expect(service.getCurrent()).resolves.toMatchObject({
      rootPath: nextRoot,
    })
  })

  it('opens a valid recent workspace from the launcher', async () => {
    const workspaceRoot = createTempPath('valedictorian-recent-open-workspace-')
    const workspace = initializeWorkspace(workspaceRoot, { createId: () => 'workspace-recent' })
    const registryStore = createTempRegistryStore('valedictorian-recent-open-registry-')
    await registryStore.markOpened({
      id: workspace.id,
      name: workspace.name,
      path: workspace.rootPath,
    })
    const activateWorkspace = vi.fn(async () => undefined)
    const service = createWorkspaceService({
      activateWorkspace,
      chooseWorkspaceRoot: vi.fn(async () => null),
      currentWorkspace: null,
      registryStore,
      relaunchApp: vi.fn(),
      revealPath: vi.fn(),
    })

    const launchState = await service.openRecent(workspace.id)

    expect(launchState).toMatchObject({
      status: 'active',
      workspace: {
        id: workspace.id,
        rootPath: workspaceRoot,
      },
    })
    expect(activateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: workspace.id }),
      { seedData: 'none' },
    )
  })

  it('shows launcher state instead of the active workspace when switcher mode is requested', async () => {
    const workspaceRoot = createTempPath('valedictorian-switcher-workspace-')
    const workspace = initializeWorkspace(workspaceRoot, { createId: () => 'workspace-switcher' })
    const registryStore = createTempRegistryStore('valedictorian-switcher-registry-')
    await registryStore.markOpened({
      id: workspace.id,
      name: workspace.name,
      path: workspace.rootPath,
    })
    const service = createWorkspaceService({
      chooseWorkspaceRoot: vi.fn(async () => null),
      currentWorkspace: workspace,
      registryStore,
      relaunchApp: vi.fn(),
      revealPath: vi.fn(),
      showWorkspaceSwitcher: () => true,
    })

    await expect(service.getLaunchState()).resolves.toMatchObject({
      recentWorkspaces: [
        expect.objectContaining({
          id: workspace.id,
          missing: false,
        }),
      ],
      status: 'needs-workspace',
    })
  })

  it('marks a recent workspace open and activates it when switching from an active workspace', async () => {
    const currentRoot = createTempPath('valedictorian-current-recent-workspace-')
    const nextRoot = createTempPath('valedictorian-next-recent-workspace-')
    const currentWorkspace = initializeWorkspace(currentRoot, { createId: () => 'workspace-current' })
    const nextWorkspace = initializeWorkspace(nextRoot, { createId: () => 'workspace-next' })
    const registryStore = createTempRegistryStore('valedictorian-recent-switch-registry-')
    await registryStore.markOpened({
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      path: currentWorkspace.rootPath,
    })
    await registryStore.markOpened({
      id: nextWorkspace.id,
      name: nextWorkspace.name,
      path: nextWorkspace.rootPath,
    })
    await registryStore.markOpened({
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      path: currentWorkspace.rootPath,
    })
    const activateWorkspace = vi.fn(async () => undefined)
    const relaunchApp = vi.fn()
    const onWorkspaceRegistryChanged = vi.fn()
    const service = createWorkspaceService({
      activateWorkspace,
      chooseWorkspaceRoot: vi.fn(async () => null),
      currentWorkspace,
      onWorkspaceRegistryChanged,
      registryStore,
      relaunchApp,
      revealPath: vi.fn(),
    })

    await service.openRecent(nextWorkspace.id)

    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: nextWorkspace.id,
    })
    expect(activateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: nextWorkspace.id }),
      { seedData: 'none' },
    )
    expect(onWorkspaceRegistryChanged).toHaveBeenCalled()
    expect(relaunchApp).not.toHaveBeenCalled()
  })

  it('creates a named workspace under a parent folder from the launcher', async () => {
    const parentPath = createTempPath('valedictorian-create-parent-')
    const registryStore = createTempRegistryStore('valedictorian-create-registry-')
    const activateWorkspace = vi.fn(async () => undefined)
    const service = createWorkspaceService({
      activateWorkspace,
      chooseWorkspaceRoot: vi.fn(async () => null),
      currentWorkspace: null,
      registryStore,
      relaunchApp: vi.fn(),
      revealPath: vi.fn(),
    })

    const launchState = await service.createWorkspace({
      name: 'Summer Search',
      parentPath,
    })

    const rootPath = path.join(parentPath, 'Summer Search')
    expect(fs.existsSync(path.join(rootPath, '.valedictorian', 'manifest.json'))).toBe(true)
    expect(launchState).toMatchObject({
      status: 'active',
      workspace: {
        rootPath,
      },
    })
    expect(activateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath }),
      { seedData: 'none' },
    )
  })

  it('chooses a create parent folder without opening a workspace', async () => {
    const chooseWorkspaceParentRoot = vi.fn(async () => '/Users/keni/Documents')
    const registryStore = createTempRegistryStore('valedictorian-create-parent-picker-registry-')
    const activateWorkspace = vi.fn(async () => undefined)
    const service = createWorkspaceService({
      activateWorkspace,
      chooseWorkspaceParentRoot,
      chooseWorkspaceRoot: vi.fn(async () => null),
      currentWorkspace: null,
      registryStore,
      relaunchApp: vi.fn(),
      revealPath: vi.fn(),
    })

    await expect(service.chooseCreateParentFolder()).resolves.toBe('/Users/keni/Documents')
    await expect(registryStore.listRecent()).resolves.toEqual([])
    expect(activateWorkspace).not.toHaveBeenCalled()
  })

  it('stays in switcher launcher state when creating a workspace is canceled', async () => {
    const currentRoot = createTempPath('valedictorian-switcher-create-current-')
    const currentWorkspace = initializeWorkspace(currentRoot, { createId: () => 'workspace-current' })
    const registryStore = createTempRegistryStore('valedictorian-switcher-create-cancel-registry-')
    await registryStore.markOpened({
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      path: currentWorkspace.rootPath,
    })
    const activateWorkspace = vi.fn(async () => undefined)
    const relaunchApp = vi.fn()
    const service = createWorkspaceService({
      activateWorkspace,
      chooseWorkspaceParentRoot: vi.fn(async () => null),
      chooseWorkspaceRoot: vi.fn(async () => null),
      currentWorkspace,
      registryStore,
      relaunchApp,
      revealPath: vi.fn(),
      showWorkspaceSwitcher: () => true,
    })

    const launchState = await service.createWorkspace({ name: 'Draft Search' })

    expect(launchState).toMatchObject({
      recentWorkspaces: [
        expect.objectContaining({
          id: currentWorkspace.id,
          missing: false,
        }),
      ],
      status: 'needs-workspace',
    })
    await expect(registryStore.listRecent()).resolves.toHaveLength(1)
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: currentWorkspace.id,
    })
    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(relaunchApp).not.toHaveBeenCalled()
  })

  it('passes sample seed intent only when dev seeding is enabled', async () => {
    const parentPath = createTempPath('valedictorian-create-dev-parent-')
    const registryStore = createTempRegistryStore('valedictorian-create-dev-registry-')
    const activateWorkspace = vi.fn(async () => undefined)
    const service = createWorkspaceService({
      activateWorkspace,
      canSeedSampleData: true,
      chooseWorkspaceRoot: vi.fn(async () => null),
      currentWorkspace: null,
      registryStore,
      relaunchApp: vi.fn(),
      revealPath: vi.fn(),
    })

    await service.createWorkspace({
      name: 'Seeded Search',
      parentPath,
      seedData: 'sample',
    })

    expect(activateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: path.join(parentPath, 'Seeded Search') }),
      { seedData: 'sample' },
    )
  })

  it('ignores sample seed requests when dev seeding is disabled', async () => {
    const parentPath = createTempPath('valedictorian-create-packaged-parent-')
    const registryStore = createTempRegistryStore('valedictorian-create-packaged-registry-')
    const activateWorkspace = vi.fn(async () => undefined)
    const service = createWorkspaceService({
      activateWorkspace,
      canSeedSampleData: false,
      chooseWorkspaceRoot: vi.fn(async () => null),
      currentWorkspace: null,
      registryStore,
      relaunchApp: vi.fn(),
      revealPath: vi.fn(),
    })

    await service.createWorkspace({
      name: 'Fresh Search',
      parentPath,
      seedData: 'sample',
    })

    expect(activateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: path.join(parentPath, 'Fresh Search') }),
      { seedData: 'none' },
    )
  })

  it('removes a recent workspace from launcher state', async () => {
    const workspaceRoot = createTempPath('valedictorian-remove-recent-workspace-')
    const workspace = initializeWorkspace(workspaceRoot, { createId: () => 'workspace-remove' })
    const registryStore = createTempRegistryStore('valedictorian-remove-recent-registry-')
    await registryStore.markOpened({
      id: workspace.id,
      name: workspace.name,
      path: workspace.rootPath,
    })
    const service = createWorkspaceService({
      chooseWorkspaceRoot: vi.fn(async () => null),
      currentWorkspace: null,
      registryStore,
      relaunchApp: vi.fn(),
      revealPath: vi.fn(),
    })

    await expect(service.removeRecent(workspace.id)).resolves.toEqual({
      devOptions: {
        canSeedSampleData: false,
      },
      recentWorkspaces: [],
      status: 'needs-workspace',
    })
    await expect(registryStore.listRecent()).resolves.toEqual([])
  })

  it('chooses a new workspace, records it as recent, and activates it in-process', async () => {
    const currentRoot = createTempPath('valedictorian-current-workspace-')
    const nextRoot = createTempPath('valedictorian-next-workspace-')
    const registryStore = createTempRegistryStore('valedictorian-service-registry-')
    const currentWorkspace = await resolveInitialWorkspace({
      chooseWorkspaceRoot: vi.fn(async () => currentRoot),
      env: {},
      registryStore,
    })
    const activateWorkspace = vi.fn(async () => undefined)
    const relaunchApp = vi.fn()
    const service = createWorkspaceService({
      activateWorkspace,
      chooseWorkspaceRoot: vi.fn(async () => nextRoot),
      currentWorkspace: currentWorkspace!,
      registryStore,
      relaunchApp,
      revealPath: vi.fn(),
    })

    const nextWorkspace = await service.chooseFolder()

    expect(nextWorkspace?.rootPath).toBe(nextRoot)
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: nextWorkspace?.id,
    })
    expect(activateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: nextRoot }),
      { seedData: 'none' },
    )
    expect(relaunchApp).not.toHaveBeenCalled()
  })
})
