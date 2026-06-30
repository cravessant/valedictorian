import crypto from 'node:crypto'
import fs from 'node:fs'
import type { ValedictorianWorkspaceClient } from 'sparxie'
import {
  createLocalValedictorianClient,
  type LocalValedictorianClientOptions,
} from '../runtime/local-valedictorian-client'
import type { ProfileSecretCodec } from '../modules/profile/profile.repository'
import { initializeWorkspace } from '../workspace/workspace.initializer'
import { resolveWorkspaceLayout } from '../workspace/workspace.paths'
import type { WorkspaceRecord, WorkspaceRegistryStore } from '../workspace/workspace.registry'

export class LocalWorkspaceConflictError extends Error {
  readonly statusCode = 409

  constructor(message: string) {
    super(message)
    this.name = 'LocalWorkspaceConflictError'
  }
}

export interface LocalWorkspaceListItem {
  id: string
  name: string
  open: boolean
  path: string
  source: 'local'
  lastOpenedAt?: string
  latestError?: {
    at: string
    message: string
  } | null
}

export interface LocalWorkspaceListResult {
  items: LocalWorkspaceListItem[]
}

export interface LocalWorkspaceManager {
  create(input: LocalWorkspaceCreateInput): Promise<LocalWorkspaceListItem>
  list(): Promise<LocalWorkspaceListResult>
  open(input: LocalWorkspaceOpenInput): Promise<LocalWorkspaceListItem>
  resolveClient(workspaceId: string): Promise<ValedictorianWorkspaceClient>
}

export interface LocalWorkspaceCreateInput {
  path: string
  rekey?: boolean
}

export interface LocalWorkspaceOpenInput {
  path: string
  rekey?: boolean
}

export interface CreateLocalWorkspaceManagerOptions {
  createClient?: (options: LocalValedictorianClientOptions) => ValedictorianWorkspaceClient
  createId?: () => string
  now?: () => Date
  referenceTrackerPath?: string
  registryStore: WorkspaceRegistryStore
  secretCodec?: ProfileSecretCodec
  seedDataMode?: LocalValedictorianClientOptions['seedDataMode']
}

export function createLocalWorkspaceManager({
  createClient = createLocalValedictorianClient,
  createId = () => crypto.randomUUID(),
  now = () => new Date(),
  referenceTrackerPath,
  registryStore,
  secretCodec,
  seedDataMode = 'none',
}: CreateLocalWorkspaceManagerOptions): LocalWorkspaceManager {
  const clientCache = new Map<string, ValedictorianWorkspaceClient>()

  return {
    async create(input) {
      fs.mkdirSync(input.path, { recursive: true })
      return openWorkspace({ createId, input, now, registryStore })
    },
    async list() {
      return {
        items: (await registryStore.listRecent()).map(toListItem),
      }
    },
    async open(input) {
      if (!fs.existsSync(input.path)) {
        throw new Error(`Workspace path does not exist: ${input.path}`)
      }

      return openWorkspace({ createId, input, now, registryStore })
    },
    async resolveClient(workspaceId) {
      try {
        const cachedClient = clientCache.get(workspaceId)

        if (cachedClient) {
          await registryStore.clearError(workspaceId)
          return cachedClient
        }

        const registry = await registryStore.get()
        const workspace = registry.workspaces[workspaceId]

        if (!workspace) {
          throw new Error(`Workspace not registered: ${workspaceId}`)
        }

        if (!fs.existsSync(workspace.path)) {
          throw new Error(`Workspace path does not exist: ${workspace.path}`)
        }

        const client = createClient({
          referenceTrackerPath,
          seedDataMode,
          secretCodec,
          sqlitePath: resolveWorkspaceLayout(workspace.path).sqlitePath,
        })
        clientCache.set(workspaceId, client)
        await registryStore.clearError(workspaceId)
        return client
      } catch (error) {
        await registryStore.recordError(
          workspaceId,
          error instanceof Error ? error.message : String(error),
          now(),
        )
        throw error
      }
    },
  }
}

async function openWorkspace({
  createId,
  input,
  now,
  registryStore,
}: {
  createId: () => string
  input: LocalWorkspaceOpenInput
  now: () => Date
  registryStore: WorkspaceRegistryStore
}) {
  const openedAt = now()
  let workspace = initializeWorkspace(input.path, { createId, now: openedAt })
  const currentRegistry = await registryStore.get()
  const existingWorkspace = currentRegistry.workspaces[workspace.id]

  if (existingWorkspace && existingWorkspace.path !== workspace.rootPath) {
    if (!input.rekey) {
      throw new LocalWorkspaceConflictError(
        `Workspace id ${workspace.id} is already registered to a different path. Re-key the workspace to register it here.`,
      )
    }

    const nextWorkspaceId = createId()
    const nextExistingWorkspace = currentRegistry.workspaces[nextWorkspaceId]

    if (nextExistingWorkspace && nextExistingWorkspace.path !== workspace.rootPath) {
      throw new LocalWorkspaceConflictError(
        `Workspace id ${nextWorkspaceId} is already registered to a different path. Re-key the workspace to register it here.`,
      )
    }

    rekeyWorkspaceManifest(workspace.rootPath, nextWorkspaceId)
    workspace = {
      ...workspace,
      id: nextWorkspaceId,
    }
  }

  const registry = await registryStore.markOpened(
    {
      id: workspace.id,
      name: workspace.name,
      path: workspace.rootPath,
    },
    openedAt,
  )

  return toListItem(registry.workspaces[workspace.id])
}

function rekeyWorkspaceManifest(rootPath: string, workspaceId: string) {
  const { manifestPath } = resolveWorkspaceLayout(rootPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        id: workspaceId,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

function toListItem(record: WorkspaceRecord): LocalWorkspaceListItem {
  return {
    id: record.id,
    lastOpenedAt: record.lastOpenedAt,
    latestError: record.latestError ?? null,
    name: record.name,
    open: record.open,
    path: record.path,
    source: 'local',
  }
}
