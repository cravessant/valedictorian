import fs from 'node:fs'
import { join } from 'pathe'
import { initializeWorkspace, type WorkspaceSummary } from './workspace.initializer'
import type {
  WorkspaceRecord,
  WorkspaceRegistryStore,
  WorkspaceRegistryUpsertInput,
} from './workspace.registry'

export interface WorkspaceLaunchRecord extends WorkspaceRecord {
  missing: boolean
}

export interface WorkspaceDevOptions {
  canSeedSampleData: boolean
}

export type WorkspaceCreateSeedData = 'none' | 'sample'

export interface WorkspaceActivationOptions {
  seedData: WorkspaceCreateSeedData
}

export type WorkspaceLaunchState =
  | {
      devOptions: WorkspaceDevOptions
      status: 'active'
      recentWorkspaces: WorkspaceLaunchRecord[]
      workspace: WorkspaceSummary
    }
  | {
      devOptions: WorkspaceDevOptions
      status: 'needs-workspace'
      recentWorkspaces: WorkspaceLaunchRecord[]
    }

export interface WorkspaceService {
  chooseFolder: () => Promise<WorkspaceSummary | null>
  createWorkspace: (input: CreateWorkspaceInput) => Promise<WorkspaceLaunchState>
  getCurrent: () => Promise<WorkspaceSummary | null>
  getLaunchState: () => Promise<WorkspaceLaunchState>
  listRecent: () => Promise<WorkspaceRecord[]>
  openFolder: () => Promise<WorkspaceLaunchState>
  openRecent: (workspaceId: string) => Promise<WorkspaceLaunchState>
  removeRecent: (workspaceId: string) => Promise<WorkspaceLaunchState>
  reveal: (workspacePath: string) => Promise<void>
  revealCurrent: () => Promise<void>
}

export interface CreateWorkspaceInput {
  name: string
  parentPath?: string
  seedData?: WorkspaceCreateSeedData
}

export interface ResolveInitialWorkspaceOptions {
  chooseWorkspaceRoot: () => Promise<string | null>
  env?: Record<string, string | undefined>
  pathExists?: (workspacePath: string) => boolean
  registryStore: WorkspaceRegistryStore
}

export interface ResolveWorkspaceLaunchStateOptions {
  canSeedSampleData?: boolean
  env?: Record<string, string | undefined>
  pathExists?: (workspacePath: string) => boolean
  registryStore: WorkspaceRegistryStore
}

export interface CreateWorkspaceServiceOptions {
  activateWorkspace?: (
    workspace: WorkspaceSummary,
    options: WorkspaceActivationOptions,
  ) => Promise<void> | void
  canSeedSampleData?: boolean
  chooseWorkspaceParentRoot?: () => Promise<string | null>
  chooseWorkspaceRoot: () => Promise<string | null>
  currentWorkspace: WorkspaceSummary | null | (() => WorkspaceSummary | null)
  pathExists?: (workspacePath: string) => boolean
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

export async function resolveWorkspaceLaunchState({
  canSeedSampleData = false,
  env = process.env,
  pathExists = fs.existsSync,
  registryStore,
}: ResolveWorkspaceLaunchStateOptions): Promise<WorkspaceLaunchState> {
  if (env.JOB_APP_WORKSPACE_PATH) {
    const workspace = await openWorkspace(env.JOB_APP_WORKSPACE_PATH, registryStore)
    return {
      devOptions: {
        canSeedSampleData,
      },
      recentWorkspaces: await listLaunchRecords(registryStore, pathExists),
      status: 'active',
      workspace,
    }
  }

  const registry = await registryStore.get()
  const lastWorkspace =
    registry.lastOpenedWorkspaceId ? registry.workspaces[registry.lastOpenedWorkspaceId] : null

  if (lastWorkspace && pathExists(lastWorkspace.path)) {
    const workspace = await openWorkspace(lastWorkspace.path, registryStore)
    return {
      devOptions: {
        canSeedSampleData,
      },
      recentWorkspaces: await listLaunchRecords(registryStore, pathExists),
      status: 'active',
      workspace,
    }
  }

  return {
    devOptions: {
      canSeedSampleData,
    },
    recentWorkspaces: await listLaunchRecords(registryStore, pathExists),
    status: 'needs-workspace',
  }
}

export function createWorkspaceService({
  activateWorkspace = async () => undefined,
  canSeedSampleData = false,
  chooseWorkspaceRoot,
  chooseWorkspaceParentRoot,
  currentWorkspace,
  pathExists = fs.existsSync,
  registryStore,
  relaunchApp,
  revealPath,
}: CreateWorkspaceServiceOptions): WorkspaceService {
  const selectWorkspaceParentRoot = chooseWorkspaceParentRoot ?? chooseWorkspaceRoot

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
    async createWorkspace(input) {
      const parentPath = input.parentPath ?? await selectWorkspaceParentRoot()

      if (!parentPath) {
        return resolveWorkspaceLaunchState({ canSeedSampleData, pathExists, registryStore })
      }

      const workspaceRootPath = join(parentPath, input.name)
      fs.mkdirSync(workspaceRootPath, { recursive: true })
      const workspace = await openWorkspace(workspaceRootPath, registryStore)
      await activateOrRelaunch({
        activateWorkspace,
        currentWorkspace: readCurrentWorkspace(currentWorkspace),
        relaunchApp,
        seedData: readCreateSeedData(input, canSeedSampleData),
        workspace,
      })
      return resolveWorkspaceLaunchState({ canSeedSampleData, pathExists, registryStore })
    },
    async getCurrent() {
      return readCurrentWorkspace(currentWorkspace)
    },
    getLaunchState() {
      return resolveWorkspaceLaunchState({ pathExists, registryStore })
    },
    listRecent() {
      return registryStore.listRecent()
    },
    async openFolder() {
      const selectedWorkspacePath = await chooseWorkspaceRoot()

      if (!selectedWorkspacePath) {
        return resolveWorkspaceLaunchState({ canSeedSampleData, pathExists, registryStore })
      }

      const workspace = await openWorkspace(selectedWorkspacePath, registryStore)
      await activateOrRelaunch({
        activateWorkspace,
        currentWorkspace: readCurrentWorkspace(currentWorkspace),
        relaunchApp,
        seedData: 'none',
        workspace,
      })
      return resolveWorkspaceLaunchState({ canSeedSampleData, pathExists, registryStore })
    },
    async openRecent(workspaceId) {
      const registry = await registryStore.get()
      const workspaceRecord = registry.workspaces[workspaceId]

      if (!workspaceRecord || !pathExists(workspaceRecord.path)) {
        return resolveWorkspaceLaunchState({ canSeedSampleData, pathExists, registryStore })
      }

      const workspace = await openWorkspace(workspaceRecord.path, registryStore)
      await activateOrRelaunch({
        activateWorkspace,
        currentWorkspace: readCurrentWorkspace(currentWorkspace),
        relaunchApp,
        seedData: 'none',
        workspace,
      })
      return resolveWorkspaceLaunchState({ canSeedSampleData, pathExists, registryStore })
    },
    async removeRecent(workspaceId) {
      await registryStore.remove(workspaceId)
      return resolveWorkspaceLaunchState({ canSeedSampleData, pathExists, registryStore })
    },
    async reveal(workspacePath) {
      await revealPath(workspacePath)
    },
    async revealCurrent() {
      const workspace = readCurrentWorkspace(currentWorkspace)

      if (!workspace) {
        return
      }

      await revealPath(workspace.rootPath)
    },
  }
}

function readCurrentWorkspace(
  currentWorkspace: WorkspaceSummary | null | (() => WorkspaceSummary | null),
) {
  return typeof currentWorkspace === 'function' ? currentWorkspace() : currentWorkspace
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

async function listLaunchRecords(
  registryStore: WorkspaceRegistryStore,
  pathExists: (workspacePath: string) => boolean,
): Promise<WorkspaceLaunchRecord[]> {
  return (await registryStore.listRecent()).map((workspace) => ({
    ...workspace,
    missing: !pathExists(workspace.path),
  }))
}

async function activateOrRelaunch({
  activateWorkspace,
  currentWorkspace,
  relaunchApp,
  seedData,
  workspace,
}: {
  activateWorkspace: (
    workspace: WorkspaceSummary,
    options: WorkspaceActivationOptions,
  ) => Promise<void> | void
  currentWorkspace: WorkspaceSummary | null
  relaunchApp: () => void
  seedData: WorkspaceCreateSeedData
  workspace: WorkspaceSummary
}) {
  if (currentWorkspace) {
    relaunchApp()
    return
  }

  await activateWorkspace(workspace, { seedData })
}

function readCreateSeedData(
  input: CreateWorkspaceInput,
  canSeedSampleData: boolean,
): WorkspaceCreateSeedData {
  if (canSeedSampleData && input.seedData === 'sample') {
    return 'sample'
  }

  return 'none'
}
