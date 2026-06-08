import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFileWorkspaceRegistryStore } from './workspace.registry'
import {
  createWorkspaceService,
  resolveInitialWorkspace,
} from './workspace.service'

function createTempPath(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe('workspace startup resolution', () => {
  it('opens JOB_APP_WORKSPACE_PATH without showing the picker', async () => {
    const workspaceRoot = createTempPath('job-app-env-workspace-')
    const registryStore = createFileWorkspaceRegistryStore(
      path.join(createTempPath('job-app-env-registry-'), 'workspaces.json'),
    )
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
    const registryStore = createFileWorkspaceRegistryStore(
      path.join(createTempPath('job-app-recent-registry-'), 'workspaces.json'),
    )
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
  it('chooses a new workspace, records it as recent, and requests relaunch', async () => {
    const currentRoot = createTempPath('job-app-current-workspace-')
    const nextRoot = createTempPath('job-app-next-workspace-')
    const registryStore = createFileWorkspaceRegistryStore(
      path.join(createTempPath('job-app-service-registry-'), 'workspaces.json'),
    )
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
