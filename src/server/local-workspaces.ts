import crypto from 'node:crypto'
import fs from 'node:fs'
import type { ValedictorianWorkspaceClient } from 'sparxie'
import {
  createLocalValedictorianClient,
  type LocalValedictorianClientOptions,
} from '../runtime/local-valedictorian-client'
import {
  createDefaultLocalConnectorPorts,
  type DefaultLocalConnectorPorts,
} from '../modules/connectors/connector.runtime-ports'
import type { SecretCodec } from '../modules/secrets/secret.codec'
import { isSecretCodecAvailable } from '../modules/secrets/secret.codec'
import {
  createConnectorRunRecoveryLifecycle,
  type ConnectorRunRecoveryLifecycle,
} from '../modules/connectors/connector.recovery'
import { initializeWorkspace } from '../workspace/workspace.initializer'
import { resolveWorkspaceLayout } from '../workspace/workspace.paths'
import type { WorkspaceRecord, WorkspaceRegistryStore } from '../workspace/workspace.registry'
import {
  prepareWorkspaceProfileCapabilities,
  type PreparedWorkspaceProfileCapabilities,
} from '../modules/profile/profile.composition'

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
  close(): Promise<void>
  connectorRunRecovery: ConnectorRunRecoveryLifecycle
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
  createConnectorPorts?: (workspaceId?: string) => DefaultLocalConnectorPorts
  createId?: () => string
  connectorRunRecovery?: ConnectorRunRecoveryLifecycle
  now?: () => Date
  prepareWorkspaceCapabilities?: typeof prepareWorkspaceProfileCapabilities
  referenceTrackerPath?: string
  registryStore: WorkspaceRegistryStore
  secretCodec?: SecretCodec
  seedDataMode?: LocalValedictorianClientOptions['seedDataMode']
}

export function createLocalWorkspaceManager({
  createClient = createLocalValedictorianClient,
  createConnectorPorts = () => createDefaultLocalConnectorPorts(),
  createId = () => crypto.randomUUID(),
  connectorRunRecovery = createConnectorRunRecoveryLifecycle(),
  now = () => new Date(),
  prepareWorkspaceCapabilities,
  referenceTrackerPath,
  registryStore,
  secretCodec,
  seedDataMode = 'none',
}: CreateLocalWorkspaceManagerOptions): LocalWorkspaceManager {
  const clientCache = new Map<string, ValedictorianWorkspaceClient>()
  const clientInflight = new Map<string, Promise<ValedictorianWorkspaceClient>>()
  const capabilityCache = new Map<string, PreparedWorkspaceProfileCapabilities>()
  const prepareCapabilities = prepareWorkspaceCapabilities
    ?? (createClient === createLocalValedictorianClient
      ? prepareWorkspaceProfileCapabilities
      : null)

  return {
    connectorRunRecovery,
    async close() {
      await Promise.allSettled(clientInflight.values())
      for (const capabilities of capabilityCache.values()) capabilities.dispose()
      clientInflight.clear()
      capabilityCache.clear()
      clientCache.clear()
    },
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
      const cachedClient = clientCache.get(workspaceId)
      if (cachedClient) {
        await registryStore.clearError(workspaceId)
        return cachedClient
      }
      const inflightClient = clientInflight.get(workspaceId)
      if (inflightClient) return inflightClient

      const resolution = (async () => {
        try {
        const registry = await registryStore.get()
        const workspace = registry.workspaces[workspaceId]

        if (!workspace) {
          throw new Error(`Workspace not registered: ${workspaceId}`)
        }

        if (!fs.existsSync(workspace.path)) {
          throw new Error(`Workspace path does not exist: ${workspace.path}`)
        }

        const connectorPorts = createConnectorPorts(workspaceId)
        const layout = resolveWorkspaceLayout(workspace.path)
        const prepared = prepareCapabilities
          ? await prepareCapabilities({
              profilePath: layout.profilePath,
              secretCodec: secretCodec ?? unavailableWorkspaceSecretCodec,
              pgliteDataPath: layout.pgliteDataPath,
              workspaceId,
            })
          : null
        let client: ValedictorianWorkspaceClient
        try {
          client = createClient({
            connectorRunRecovery,
            connectorRuntime: connectorPorts.connectorRuntime,
            localSecretResolutionEnabled: isSecretCodecAvailable(secretCodec),
            profilePath: layout.profilePath,
            ...(prepared === null
              ? {}
              : {
                  profileService: prepared.profileService,
                  secretService: prepared.secretService,
                }),
            referenceTrackerPath,
            seedDataMode,
            secretCodec,
            pgliteDataPath: layout.pgliteDataPath,
            workspaceId,
          })
        } catch (error) {
          prepared?.dispose()
          throw error
        }
        if (prepared) capabilityCache.set(workspaceId, prepared)
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
      })()
      clientInflight.set(workspaceId, resolution)
      return resolution.finally(() => {
        if (clientInflight.get(workspaceId) === resolution) clientInflight.delete(workspaceId)
      })
    },
  }
}

const unavailableWorkspaceSecretCodec: SecretCodec = {
  decrypt() {
    throw new Error('Protected storage is unavailable.')
  },
  encrypt() {
    throw new Error('Protected storage is unavailable.')
  },
  isAvailable: () => false,
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
