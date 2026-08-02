import fs from 'node:fs'
import { dirname } from 'pathe'

/** Durable local workspace discovery registry. */
export interface WorkspaceRecord {
  id: string
  name: string
  path: string
  lastOpenedAt: string
  open: boolean
  latestError?: WorkspaceRegistryError | null
}

export interface WorkspaceRegistryError {
  at: string
  message: string
}

export interface WorkspaceRegistry {
  lastOpenedWorkspaceId: string | null
  workspaces: Record<string, WorkspaceRecord>
}

export interface WorkspaceRegistryUpsertInput {
  id: string
  name: string
  path: string
}

export interface WorkspaceRegistryStore {
  clearError: (workspaceId: string) => Promise<WorkspaceRegistry>
  get: () => Promise<WorkspaceRegistry>
  listRecent: () => Promise<WorkspaceRecord[]>
  markOpened: (
    workspace: WorkspaceRegistryUpsertInput,
    openedAt?: Date,
  ) => Promise<WorkspaceRegistry>
  recordError: (
    workspaceId: string,
    message: string,
    occurredAt?: Date,
  ) => Promise<WorkspaceRegistry>
  remove: (workspaceId: string) => Promise<WorkspaceRegistry>
}

export const emptyWorkspaceRegistry: WorkspaceRegistry = {
  lastOpenedWorkspaceId: null,
  workspaces: {},
}

export function createFileWorkspaceRegistryStore(registryPath: string): WorkspaceRegistryStore {
  return {
    async clearError(workspaceId) {
      const currentRegistry = readRegistry(registryPath)
      const workspace = currentRegistry.workspaces[workspaceId]

      if (!workspace) {
        return currentRegistry
      }

      const nextRegistry = {
        ...currentRegistry,
        workspaces: {
          ...currentRegistry.workspaces,
          [workspaceId]: {
            ...workspace,
            latestError: null,
          },
        },
      }

      writeRegistry(registryPath, nextRegistry)
      return nextRegistry
    },
    async get() {
      return readRegistry(registryPath)
    },
    async listRecent() {
      return Object.values(readRegistry(registryPath).workspaces).sort((left, right) =>
        right.lastOpenedAt.localeCompare(left.lastOpenedAt),
      )
    },
    async markOpened(workspace, openedAt = new Date()) {
      const currentRegistry = readRegistry(registryPath)
      const previousRecord = currentRegistry.workspaces[workspace.id]
      const nextRecord: WorkspaceRecord = {
        latestError: null,
        ...previousRecord,
        ...workspace,
        lastOpenedAt: openedAt.toISOString(),
        open: true,
      }
      const nextWorkspaces: Record<string, WorkspaceRecord> = {
        [workspace.id]: nextRecord,
      }

      for (const [workspaceId, currentWorkspace] of Object.entries(currentRegistry.workspaces)) {
        if (workspaceId !== workspace.id) {
          nextWorkspaces[workspaceId] = {
            ...currentWorkspace,
            open: false,
          }
        }
      }

      const nextRegistry = {
        lastOpenedWorkspaceId: workspace.id,
        workspaces: nextWorkspaces,
      }

      writeRegistry(registryPath, nextRegistry)
      return nextRegistry
    },
    async recordError(workspaceId, message, occurredAt = new Date()) {
      const currentRegistry = readRegistry(registryPath)
      const workspace = currentRegistry.workspaces[workspaceId]

      if (!workspace) {
        return currentRegistry
      }

      const nextRegistry = {
        ...currentRegistry,
        workspaces: {
          ...currentRegistry.workspaces,
          [workspaceId]: {
            ...workspace,
            latestError: {
              at: occurredAt.toISOString(),
              message,
            },
          },
        },
      }

      writeRegistry(registryPath, nextRegistry)
      return nextRegistry
    },
    async remove(workspaceId) {
      const currentRegistry = readRegistry(registryPath)
      const { [workspaceId]: _removedWorkspace, ...nextWorkspaces } = currentRegistry.workspaces
      const nextRegistry = {
        lastOpenedWorkspaceId:
          currentRegistry.lastOpenedWorkspaceId === workspaceId
            ? null
            : currentRegistry.lastOpenedWorkspaceId,
        workspaces: nextWorkspaces,
      }

      writeRegistry(registryPath, nextRegistry)
      return nextRegistry
    },
  }
}

function readRegistry(registryPath: string): WorkspaceRegistry {
  try {
    return normalizeRegistry(JSON.parse(fs.readFileSync(registryPath, 'utf8')) as unknown)
  } catch {
    return { ...emptyWorkspaceRegistry }
  }
}

function writeRegistry(registryPath: string, registry: WorkspaceRegistry) {
  fs.mkdirSync(dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
}

function normalizeRegistry(value: unknown): WorkspaceRegistry {
  if (!value || typeof value !== 'object') {
    return { ...emptyWorkspaceRegistry }
  }

  const candidate = value as Record<string, unknown>
  const candidateWorkspaces =
    candidate.workspaces && typeof candidate.workspaces === 'object'
      ? (candidate.workspaces as Record<string, unknown>)
      : {}
  const workspaces = Object.fromEntries(
    Object.entries(candidateWorkspaces)
      .map(([workspaceId, workspace]) => [workspaceId, normalizeWorkspaceRecord(workspace)])
      .filter((entry): entry is [string, WorkspaceRecord] => entry[1] !== null),
  )
  const lastOpenedWorkspaceId =
    typeof candidate.lastOpenedWorkspaceId === 'string' &&
    candidate.lastOpenedWorkspaceId in workspaces
      ? candidate.lastOpenedWorkspaceId
      : null

  return {
    lastOpenedWorkspaceId,
    workspaces,
  }
}

function normalizeWorkspaceRecord(value: unknown): WorkspaceRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.path !== 'string' ||
    typeof candidate.lastOpenedAt !== 'string'
  ) {
    return null
  }

  return {
    id: candidate.id,
    name: candidate.name,
    path: candidate.path,
    lastOpenedAt: candidate.lastOpenedAt,
    latestError: normalizeWorkspaceRegistryError(candidate.latestError),
    open: candidate.open === true,
  }
}

function normalizeWorkspaceRegistryError(value: unknown): WorkspaceRegistryError | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (typeof candidate.at !== 'string' || typeof candidate.message !== 'string') {
    return null
  }

  return {
    at: candidate.at,
    message: candidate.message,
  }
}
