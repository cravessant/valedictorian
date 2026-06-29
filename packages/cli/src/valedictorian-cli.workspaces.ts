import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WorkspaceListItem, WorkspaceListResult } from 'sparxie'

interface WorkspaceRegistry {
  lastOpenedWorkspaceId: string | null
  workspaces: Record<string, WorkspaceRegistryRecord>
}

interface WorkspaceRegistryRecord {
  id: string
  name: string
  path: string
  lastOpenedAt: string
  open: boolean
  latestError?: {
    at: string
    message: string
  } | null
}

export function readLocalWorkspaceList(
  env: Record<string, string | undefined>,
): WorkspaceListResult | null {
  const registryPath = resolveWorkspaceRegistryPath(env)

  if (!registryPath || !fs.existsSync(registryPath)) {
    return null
  }

  try {
    const registry = normalizeWorkspaceRegistry(
      JSON.parse(fs.readFileSync(registryPath, 'utf8')) as unknown,
    )
    const items = Object.values(registry.workspaces)
      .map((workspace) => ({
        id: workspace.id,
        lastOpenedAt: workspace.lastOpenedAt,
        latestError: workspace.latestError ?? null,
        name: workspace.name,
        open: workspace.open || workspace.id === registry.lastOpenedWorkspaceId,
        path: workspace.path,
        source: 'local' as const,
      }))
      .sort((left, right) => (right.lastOpenedAt ?? '').localeCompare(left.lastOpenedAt ?? ''))

    return { items }
  } catch {
    return null
  }
}

export function isLocalApiUrl(rawApiUrl: string) {
  try {
    const hostname = new URL(rawApiUrl).hostname.toLowerCase()

    return (
      hostname === 'localhost' ||
      hostname === '0.0.0.0' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1'
    )
  } catch {
    return false
  }
}

export function inferLastOpenWorkspace(items: WorkspaceListItem[]) {
  const openWorkspaces = items.filter((workspace) => workspace.open)

  if (openWorkspaces.length === 1) {
    return openWorkspaces[0]
  }

  return undefined
}

function resolveWorkspaceRegistryPath(env: Record<string, string | undefined>) {
  if (env.VALEDICTORIAN_WORKSPACE_REGISTRY_PATH) {
    return env.VALEDICTORIAN_WORKSPACE_REGISTRY_PATH
  }

  const home = os.homedir()

  if (!home) {
    return undefined
  }

  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Valedictorian', 'workspaces.json')
  }

  if (process.platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Valedictorian', 'workspaces.json')
  }

  return path.join(env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'valedictorian', 'workspaces.json')
}

function normalizeWorkspaceRegistry(value: unknown): WorkspaceRegistry {
  if (!value || typeof value !== 'object') {
    return { lastOpenedWorkspaceId: null, workspaces: {} }
  }

  const candidate = value as Record<string, unknown>
  const candidateWorkspaces =
    candidate.workspaces && typeof candidate.workspaces === 'object'
      ? (candidate.workspaces as Record<string, unknown>)
      : {}
  const workspaces = Object.fromEntries(
    Object.entries(candidateWorkspaces)
      .map(([workspaceId, workspace]) => [workspaceId, normalizeWorkspaceRecord(workspace)])
      .filter((entry): entry is [string, WorkspaceRegistryRecord] => entry[1] !== null),
  )
  const lastOpenedWorkspaceId =
    typeof candidate.lastOpenedWorkspaceId === 'string' &&
    candidate.lastOpenedWorkspaceId in workspaces
      ? candidate.lastOpenedWorkspaceId
      : null

  return { lastOpenedWorkspaceId, workspaces }
}

function normalizeWorkspaceRecord(value: unknown): WorkspaceRegistryRecord | null {
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
    lastOpenedAt: candidate.lastOpenedAt,
    latestError: normalizeLatestError(candidate.latestError),
    name: candidate.name,
    open: candidate.open === true,
    path: candidate.path,
  }
}

function normalizeLatestError(value: unknown): WorkspaceRegistryRecord['latestError'] {
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
