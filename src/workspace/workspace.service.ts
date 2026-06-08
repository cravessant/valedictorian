import fs from 'node:fs'
import { initializeWorkspace, type WorkspaceSummary } from './workspace.initializer'
import type {
  WorkspaceRecord,
  WorkspaceRegistryStore,
  WorkspaceRegistryUpsertInput,
} from './workspace.registry'

export interface WorkspaceService {
  chooseFolder: () => Promise<WorkspaceSummary | null>
  getCurrent: () => Promise<WorkspaceSummary>
  listRecent: () => Promise<WorkspaceRecord[]>
  revealCurrent: () => Promise<void>
}

export interface ResolveInitialWorkspaceOptions {
  chooseWorkspaceRoot: () => Promise<string | null>
  env?: Record<string, string | undefined>
  pathExists?: (workspacePath: string) => boolean
  registryStore: WorkspaceRegistryStore
}

export interface CreateWorkspaceServiceOptions {
  chooseWorkspaceRoot: () => Promise<string | null>
  currentWorkspace: WorkspaceSummary
  registryStore: WorkspaceRegistryStore
  relaunchApp: () => void
  revealPath: (workspacePath: string) => Promise<void> | void
}

export async function resolveInitialWorkspace({
  chooseWorkspaceRoot,
  env = process.env,
  pathExists = fs.existsSync,
  registryStore,
}: ResolveInitialWorkspaceOptions): Promise<WorkspaceSummary | null> {
  if (env.JOB_APP_WORKSPACE_PATH) {
    return openWorkspace(env.JOB_APP_WORKSPACE_PATH, registryStore)
  }

  const registry = await registryStore.get()
  const lastWorkspace =
    registry.lastOpenedWorkspaceId ? registry.workspaces[registry.lastOpenedWorkspaceId] : null

  if (lastWorkspace && pathExists(lastWorkspace.path)) {
    return openWorkspace(lastWorkspace.path, registryStore)
  }

  const selectedWorkspacePath = await chooseWorkspaceRoot()

  if (!selectedWorkspacePath) {
    return null
  }

  return openWorkspace(selectedWorkspacePath, registryStore)
}

export function createWorkspaceService({
  chooseWorkspaceRoot,
  currentWorkspace,
  registryStore,
  relaunchApp,
  revealPath,
}: CreateWorkspaceServiceOptions): WorkspaceService {
  return {
    async chooseFolder() {
      const selectedWorkspacePath = await chooseWorkspaceRoot()

      if (!selectedWorkspacePath) {
        return null
      }

      const nextWorkspace = await openWorkspace(selectedWorkspacePath, registryStore)
      relaunchApp()
      return nextWorkspace
    },
    async getCurrent() {
      return currentWorkspace
    },
    listRecent() {
      return registryStore.listRecent()
    },
    async revealCurrent() {
      await revealPath(currentWorkspace.rootPath)
    },
  }
}

async function openWorkspace(
  workspaceRootPath: string,
  registryStore: WorkspaceRegistryStore,
): Promise<WorkspaceSummary> {
  const workspace = initializeWorkspace(workspaceRootPath)
  await registryStore.markOpened(toRegistryInput(workspace))
  return workspace
}

function toRegistryInput(workspace: WorkspaceSummary): WorkspaceRegistryUpsertInput {
  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.rootPath,
  }
}
