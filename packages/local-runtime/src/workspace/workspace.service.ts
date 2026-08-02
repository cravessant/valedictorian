import fs from 'node:fs'
import { join } from 'pathe'
import type {
  WorkspaceRecord,
  WorkspaceRegistryStore,
  WorkspaceRegistryUpsertInput,
} from '../workspace-files.js'
import { initializeWorkspace, type WorkspaceSummary } from './workspace.initializer.js'

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

export interface WorkspaceFolderPickerOptions<ParentWindow = unknown> {
  parentWindow?: ParentWindow | null
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

export interface WorkspaceService<ParentWindow = unknown> {
  chooseCreateParentFolder: (
    options?: WorkspaceFolderPickerOptions<ParentWindow>,
  ) => Promise<string | null>
  chooseFolder: (
    options?: WorkspaceFolderPickerOptions<ParentWindow>,
  ) => Promise<WorkspaceSummary | null>
  createWorkspace: (
    input: CreateWorkspaceInput,
    options?: WorkspaceFolderPickerOptions<ParentWindow>,
  ) => Promise<WorkspaceLaunchState>
  getCurrent: () => Promise<WorkspaceSummary | null>
  getLaunchState: () => Promise<WorkspaceLaunchState>
  listRecent: () => Promise<WorkspaceRecord[]>
  openFolder: (options?: WorkspaceFolderPickerOptions<ParentWindow>) => Promise<WorkspaceLaunchState>
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

export interface CreateWorkspaceServiceOptions<ParentWindow = unknown> {
  activateWorkspace?: (
    workspace: WorkspaceSummary,
    options: WorkspaceActivationOptions,
  ) => Promise<void> | void
  canSeedSampleData?: boolean
  chooseWorkspaceParentRoot?: (
    options?: WorkspaceFolderPickerOptions<ParentWindow>,
  ) => Promise<string | null>
  chooseWorkspaceRoot: (options?: WorkspaceFolderPickerOptions<ParentWindow>) => Promise<string | null>
  currentWorkspace: WorkspaceSummary | null | (() => WorkspaceSummary | null)
  onWorkspaceRegistryChanged?: () => Promise<void> | void
  pathExists?: (workspacePath: string) => boolean
  registryStore: WorkspaceRegistryStore
  relaunchApp?: () => void
  revealPath: (workspacePath: string) => Promise<void> | void
  showWorkspaceSwitcher?: () => boolean
}

export async function resolveInitialWorkspace({
  chooseWorkspaceRoot,
  env = process.env,
  pathExists = fs.existsSync,
  registryStore,
}: ResolveInitialWorkspaceOptions): Promise<WorkspaceSummary | null> {
  const envWorkspacePath = readWorkspacePathEnv(env)

  if (envWorkspacePath) {
    return openWorkspace(envWorkspacePath, registryStore)
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
  const envWorkspacePath = readWorkspacePathEnv(env)

  if (envWorkspacePath) {
    const workspace = await openWorkspace(envWorkspacePath, registryStore)
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

function readWorkspacePathEnv(env: Record<string, string | undefined>) {
  return env.VALEDICTORIAN_WORKSPACE_PATH
}

export function createWorkspaceService<ParentWindow = unknown>({
  activateWorkspace = async () => undefined,
  canSeedSampleData = false,
  chooseWorkspaceRoot,
  chooseWorkspaceParentRoot,
  currentWorkspace,
  onWorkspaceRegistryChanged = async () => undefined,
  pathExists = fs.existsSync,
  registryStore,
  revealPath,
  showWorkspaceSwitcher = () => false,
}: CreateWorkspaceServiceOptions<ParentWindow>): WorkspaceService<ParentWindow> {
  const selectWorkspaceParentRoot = chooseWorkspaceParentRoot ?? chooseWorkspaceRoot
  const resolveCurrentLaunchState = () => {
    if (showWorkspaceSwitcher()) {
      return resolveWorkspaceSwitcherLaunchState({
        canSeedSampleData,
        pathExists,
        registryStore,
      })
    }

    return resolveWorkspaceLaunchState({ canSeedSampleData, pathExists, registryStore })
  }

  return {
    chooseCreateParentFolder(options) {
      return selectWorkspaceParentRoot(options)
    },
    async chooseFolder(options) {
      const selectedWorkspacePath = await chooseWorkspaceRoot(options)

      if (!selectedWorkspacePath) {
        return null
      }

      const nextWorkspace = await openWorkspace(selectedWorkspacePath, registryStore)
      await onWorkspaceRegistryChanged()
      await activateWorkspace(nextWorkspace, { seedData: 'none' })
      return nextWorkspace
    },
    async createWorkspace(input, options) {
      const parentPath = input.parentPath ?? await selectWorkspaceParentRoot(options)

      if (!parentPath) {
        return resolveCurrentLaunchState()
      }

      const workspaceRootPath = join(parentPath, input.name)
      fs.mkdirSync(workspaceRootPath, { recursive: true })
      const workspace = await openWorkspace(workspaceRootPath, registryStore)
      await onWorkspaceRegistryChanged()
      await activateWorkspaceSelection({
        activateWorkspace,
        seedData: readCreateSeedData(input, canSeedSampleData),
        workspace,
      })
      return resolveWorkspaceLaunchState({ canSeedSampleData, pathExists, registryStore })
    },
    async getCurrent() {
      return readCurrentWorkspace(currentWorkspace)
    },
    getLaunchState() {
      return resolveCurrentLaunchState()
    },
    listRecent() {
      return registryStore.listRecent()
    },
    async openFolder(options) {
      const selectedWorkspacePath = await chooseWorkspaceRoot(options)

      if (!selectedWorkspacePath) {
        return resolveCurrentLaunchState()
      }

      const workspace = await openWorkspace(selectedWorkspacePath, registryStore)
      await onWorkspaceRegistryChanged()
      await activateWorkspaceSelection({
        activateWorkspace,
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
      await onWorkspaceRegistryChanged()
      await activateWorkspaceSelection({
        activateWorkspace,
        seedData: 'none',
        workspace,
      })
      return resolveWorkspaceLaunchState({ canSeedSampleData, pathExists, registryStore })
    },
    async removeRecent(workspaceId) {
      await registryStore.remove(workspaceId)
      await onWorkspaceRegistryChanged()
      return resolveCurrentLaunchState()
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

export async function resolveWorkspaceSwitcherLaunchState({
  canSeedSampleData = false,
  pathExists = fs.existsSync,
  registryStore,
}: Omit<ResolveWorkspaceLaunchStateOptions, 'env'>): Promise<WorkspaceLaunchState> {
  return {
    devOptions: {
      canSeedSampleData,
    },
    recentWorkspaces: await listLaunchRecords(registryStore, pathExists),
    status: 'needs-workspace',
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

async function activateWorkspaceSelection({
  activateWorkspace,
  seedData,
  workspace,
}: {
  activateWorkspace: (
    workspace: WorkspaceSummary,
    options: WorkspaceActivationOptions,
  ) => Promise<void> | void
  seedData: WorkspaceCreateSeedData
  workspace: WorkspaceSummary
}) {
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
