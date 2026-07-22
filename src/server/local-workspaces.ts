import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  createLocalValedictorianClient,
  type LocalValedictorianClientOptions,
} from '../runtime/local-valedictorian-client'
import type { LocalValedictorianClient } from '../runtime/local-connector-client.contract'
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
import { ProfileUpgradeRequiredError } from '../modules/profile/profile.upgrade-policy'

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
  resolveClient(workspaceId: string): Promise<LocalValedictorianClient>
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
  createClient?: (
    options: LocalValedictorianClientOptions,
  ) => Promise<LocalValedictorianClient> | LocalValedictorianClient
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
  const clientCache = new Map<string, LocalValedictorianClient>()
  const clientInflight = new Map<string, Promise<LocalValedictorianClient>>()
  const capabilityCache = new Map<string, PreparedWorkspaceProfileCapabilities>()
  const recoveryScopeCache = new Map<string, { pgliteDataPath: string; workspaceId: string }>()
  let closeInflight: Promise<void> | null = null
  const prepareCapabilities = prepareWorkspaceCapabilities
    ?? (createClient === createLocalValedictorianClient
      ? prepareWorkspaceProfileCapabilities
      : null)

  return {
    connectorRunRecovery,
    close() {
      if (closeInflight) return closeInflight
      closeInflight = (async () => {
        await Promise.allSettled(clientInflight.values())
        const capabilities = [...capabilityCache.values()]
        const recoveryScopes = [...recoveryScopeCache.values()]
        clientInflight.clear()
        capabilityCache.clear()
        recoveryScopeCache.clear()
        clientCache.clear()
        await Promise.allSettled(capabilities.map((prepared) => prepared.dispose()))
        for (const scope of recoveryScopes) connectorRunRecovery.deactivate(scope)
      })().finally(() => {
        closeInflight = null
      })
      return closeInflight
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
      if (closeInflight) await closeInflight
      const cachedClient = clientCache.get(workspaceId)
      if (cachedClient) {
        await registryStore.clearError(workspaceId)
        return cachedClient
      }
      const inflightClient = clientInflight.get(workspaceId)
      if (inflightClient) return inflightClient

      const resolution = (async () => {
        let prepared: PreparedWorkspaceProfileCapabilities | null = null
        let recoveryScope: { pgliteDataPath: string; workspaceId: string } | null = null
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
          recoveryScope = { pgliteDataPath: layout.pgliteDataPath, workspaceId }
          prepared = prepareCapabilities
            ? await prepareCapabilities({
                profilePath: layout.profilePath,
                secretCodec: secretCodec ?? unavailableWorkspaceSecretCodec,
                pgliteDataPath: layout.pgliteDataPath,
                workspaceId,
              })
            : null
          const client = await createClient({
            ...(prepared ? { database: prepared.database } : {}),
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
          } as LocalValedictorianClientOptions)
          await registryStore.clearError(workspaceId)
          if (prepared) capabilityCache.set(workspaceId, prepared)
          recoveryScopeCache.set(workspaceId, recoveryScope)
          clientCache.set(workspaceId, client)
          return client
        } catch (error) {
          clientCache.delete(workspaceId)
          capabilityCache.delete(workspaceId)
          if (recoveryScope) connectorRunRecovery.deactivate(recoveryScope)
          recoveryScopeCache.delete(workspaceId)
          if (prepared) await Promise.allSettled([prepared.dispose()])
          await registryStore.recordError(
            workspaceId,
            sanitizedWorkspaceInitializationError(error),
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

function sanitizedWorkspaceInitializationError(error: unknown) {
  if (
    error instanceof Error
    && (
      error.name === 'ProfileMigrationError'
      || error instanceof ProfileUpgradeRequiredError
    )
    && !error.message.includes('/')
    && !error.message.includes('\\')
  ) {
    return error.message
  }
  return 'Workspace initialization failed. Retry opening this workspace.'
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
  const physicalWorkspace = Object.values(currentRegistry.workspaces).find(
    (registered) => samePhysicalWorkspace(registered.path, workspace.rootPath),
  )
  if (physicalWorkspace) {
    if (physicalWorkspace.id !== workspace.id) {
      throw new LocalWorkspaceConflictError(
        `Workspace path is already registered as ${physicalWorkspace.id}.`,
      )
    }
    workspace = {
      ...workspace,
      name: physicalWorkspace.name,
      rootPath: physicalWorkspace.path,
    }
  }
  const existingWorkspace = currentRegistry.workspaces[workspace.id]

  if (!physicalWorkspace && existingWorkspace && existingWorkspace.path !== workspace.rootPath) {
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

function samePhysicalWorkspace(firstPath: string, secondPath: string) {
  try {
    return fs.realpathSync.native(firstPath) === fs.realpathSync.native(secondPath)
  } catch {
    return path.resolve(firstPath) === path.resolve(secondPath)
  }
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
