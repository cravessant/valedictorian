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
    const registryStore = createTempRegistryStore('job-app-empty-registry-')

    await expect(
      resolveWorkspaceLaunchState({
        env: {},
        registryStore,
      }),
    ).resolves.toEqual({
      recentWorkspaces: [],
      status: 'needs-workspace',
    })
  })

  it('opens JOB_APP_WORKSPACE_PATH as active launch state', async () => {
    const workspaceRoot = createTempPath('job-app-env-workspace-')
    const registryStore = createTempRegistryStore('job-app-env-registry-')

    const launchState = await resolveWorkspaceLaunchState({
      env: { JOB_APP_WORKSPACE_PATH: workspaceRoot },
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
    const workspaceRoot = createTempPath('job-app-recent-workspace-')
    const workspace = initializeWorkspace(workspaceRoot, { createId: () => 'workspace-recent' })
    const registryStore = createTempRegistryStore('job-app-recent-registry-')
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
    const missingPath = path.join(os.tmpdir(), 'job-app-missing-workspace')
    const registryStore = createTempRegistryStore('job-app-missing-registry-')
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
      recentWorkspaces: [
        {
          id: 'workspace-missing',
          lastOpenedAt: expect.any(String),
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
  it('opens JOB_APP_WORKSPACE_PATH without showing the picker', async () => {
    const workspaceRoot = createTempPath('job-app-env-workspace-')
    const registryStore = createTempRegistryStore('job-app-env-registry-')
    const chooseWorkspaceRoot = vi.fn(async () => null)

    const workspace = await resolveInitialWorkspace({
      chooseWorkspaceRoot,
      env: { JOB_APP_WORKSPACE_PATH: workspaceRoot },
      registryStore,
    })

    expect(workspace?.rootPath).toBe(workspaceRoot)
    expect(chooseWorkspaceRoot).not.toHaveBeenCalled()
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: workspace?.id,
    })
  })

  it('auto-opens the last valid workspace before asking the user to choose', async () => {
    const workspaceRoot = createTempPath('job-app-recent-workspace-')
    const registryStore = createTempRegistryStore('job-app-recent-registry-')
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
    const nextRoot = createTempPath('job-app-launcher-open-workspace-')
    const registryStore = createTempRegistryStore('job-app-launcher-service-registry-')
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
    )
    expect(relaunchApp).not.toHaveBeenCalled()
  })

  it('returns the current workspace after launcher activation updates shared state', async () => {
    const nextRoot = createTempPath('job-app-launcher-current-workspace-')
    const registryStore = createTempRegistryStore('job-app-launcher-current-registry-')
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
    const workspaceRoot = createTempPath('job-app-recent-open-workspace-')
    const workspace = initializeWorkspace(workspaceRoot, { createId: () => 'workspace-recent' })
    const registryStore = createTempRegistryStore('job-app-recent-open-registry-')
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
    )
  })

  it('creates a named workspace under a parent folder from the launcher', async () => {
    const parentPath = createTempPath('job-app-create-parent-')
    const registryStore = createTempRegistryStore('job-app-create-registry-')
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
    expect(fs.existsSync(path.join(rootPath, '.job-automation', 'manifest.json'))).toBe(true)
    expect(launchState).toMatchObject({
      status: 'active',
      workspace: {
        rootPath,
      },
    })
    expect(activateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath }),
    )
  })

  it('removes a recent workspace from launcher state', async () => {
    const workspaceRoot = createTempPath('job-app-remove-recent-workspace-')
    const workspace = initializeWorkspace(workspaceRoot, { createId: () => 'workspace-remove' })
    const registryStore = createTempRegistryStore('job-app-remove-recent-registry-')
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
      recentWorkspaces: [],
      status: 'needs-workspace',
    })
    await expect(registryStore.listRecent()).resolves.toEqual([])
  })

  it('chooses a new workspace, records it as recent, and requests relaunch', async () => {
    const currentRoot = createTempPath('job-app-current-workspace-')
    const nextRoot = createTempPath('job-app-next-workspace-')
    const registryStore = createTempRegistryStore('job-app-service-registry-')
    const currentWorkspace = await resolveInitialWorkspace({
      chooseWorkspaceRoot: vi.fn(async () => currentRoot),
      env: {},
      registryStore,
    })
    const relaunchApp = vi.fn()
    const service = createWorkspaceService({
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
    expect(relaunchApp).toHaveBeenCalled()
  })
})
