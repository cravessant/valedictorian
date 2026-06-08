import fs from 'node:fs'
import { dirname } from 'pathe'

export interface WorkspaceRecord {
  id: string
  name: string
  path: string
  lastOpenedAt: string
  open: boolean
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
  get: () => Promise<WorkspaceRegistry>
  listRecent: () => Promise<WorkspaceRecord[]>
  markOpened: (
    workspace: WorkspaceRegistryUpsertInput,
    openedAt?: Date,
  ) => Promise<WorkspaceRegistry>
}

export const emptyWorkspaceRegistry: WorkspaceRegistry = {
  lastOpenedWorkspaceId: null,
  workspaces: {},
}

export function createFileWorkspaceRegistryStore(registryPath: string): WorkspaceRegistryStore {
  return {
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
      const nextRecord: WorkspaceRecord = {
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
    open: candidate.open === true,
  }
}
