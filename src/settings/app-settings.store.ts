import fs from 'node:fs'
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
  type AppSettingsPatch,
  type AppSettingsStore,
} from './app-settings'
import type { AppSecretStore } from './app-secret'
import {
  defaultAtomicDocumentFileOperations,
  writeAtomicDocument,
  type AtomicDocumentFileOperations,
} from './atomic-document'
import { resolveWorkspaceLayout } from '../workspace/workspace.paths'

export const apiTokenSecretReference = 'app-secret:api-token'

interface PersistedAppSettingsDocument {
  apiToken?: string
  apiTokenSecretRef?: string
  localApiHost?: unknown
  localApiPort?: unknown
  remoteApiUrl?: unknown
  runtimeMode?: unknown
  sidebarCollapsed?: unknown
  showAdvancedFilters?: unknown
  showDebugData?: unknown
  theme?: unknown
}

export interface FileAppSettingsStoreOptions {
  fileOps?: AppSettingsFileOperations
  secretStore?: AppSecretStore
}

/** Compatible alias for the shared durable document filesystem seam. */
export type AppSettingsFileOperations = AtomicDocumentFileOperations

export const defaultAppSettingsFileOperations: AppSettingsFileOperations =
  defaultAtomicDocumentFileOperations

export function createFileAppSettingsStore(
  settingsPath: string,
  { fileOps = defaultAppSettingsFileOperations, secretStore }: FileAppSettingsStoreOptions = {},
): AppSettingsStore {
  return {
    async get() {
      await maybeMigrateLegacyApiToken(settingsPath, secretStore, fileOps)
      return await toPublicSettings(readPersistedDocument(settingsPath), secretStore)
    },
    async reset() {
      const document = readPersistedDocument(settingsPath)
      if (document.apiTokenSecretRef && secretStore) {
        await secretStore.delete(document.apiTokenSecretRef)
      }
      writePersistedDocument(settingsPath, {}, fileOps)
      return { ...defaultAppSettings }
    },
    async resolveApiToken() {
      await maybeMigrateLegacyApiToken(settingsPath, secretStore, fileOps)
      const document = readPersistedDocument(settingsPath)

      if (typeof document.apiToken === 'string' && document.apiToken.length > 0) {
        // Migration left plaintext for retry; never bootstrap runtime from it.
        throw createSecureStorageMigrationFailure()
      }

      if (document.apiTokenSecretRef && secretStore) {
        return secretStore.get(document.apiTokenSecretRef)
      }

      return null
    },
    async update(patch: AppSettingsPatch) {
      await maybeMigrateLegacyApiToken(settingsPath, secretStore, fileOps)
      const current = readPersistedDocument(settingsPath)
      const nextPublic = normalizeAppSettings({
        ...(await toPublicSettings(current, secretStore)),
        ...omitWriteOnlyToken(patch),
      })
      const nextDocument: PersistedAppSettingsDocument = {
        ...current,
        localApiHost: nextPublic.localApiHost,
        localApiPort: nextPublic.localApiPort,
        remoteApiUrl: nextPublic.remoteApiUrl,
        runtimeMode: nextPublic.runtimeMode,
        sidebarCollapsed: nextPublic.sidebarCollapsed,
        showAdvancedFilters: nextPublic.showAdvancedFilters,
        showDebugData: nextPublic.showDebugData,
        theme: nextPublic.theme,
      }

      if (patch.apiToken !== undefined) {
        if (!secretStore) {
          throw new Error('An encrypted app secret store is required to save the API token')
        }

        if (patch.apiToken) {
          const reference = current.apiTokenSecretRef ?? apiTokenSecretReference
          await secretStore.set(reference, patch.apiToken)
          const readback = await secretStore.get(reference)
          if (readback !== patch.apiToken) {
            throw new Error('Encrypted API token readback verification failed')
          }
          nextDocument.apiTokenSecretRef = reference
          delete nextDocument.apiToken
        } else {
          if (current.apiTokenSecretRef) {
            await secretStore.delete(current.apiTokenSecretRef)
          }
          delete nextDocument.apiTokenSecretRef
          delete nextDocument.apiToken
        }
      }

      writePersistedDocument(settingsPath, nextDocument, fileOps)
      return await toPublicSettings(nextDocument, secretStore)
    },
  }
}

export function createWorkspaceAppSettingsStore(
  workspaceRootPath: string,
  options: FileAppSettingsStoreOptions = {},
): AppSettingsStore {
  return createFileAppSettingsStore(resolveWorkspaceLayout(workspaceRootPath).appSettingsPath, options)
}

async function maybeMigrateLegacyApiToken(
  settingsPath: string,
  secretStore?: AppSecretStore,
  fileOps: AppSettingsFileOperations = defaultAppSettingsFileOperations,
): Promise<void> {
  const document = readPersistedDocument(settingsPath)
  if (!('apiToken' in document)) {
    return
  }

  const legacyToken = document.apiToken
  if (typeof legacyToken !== 'string') {
    const { apiToken: _ignored, ...rest } = document
    writePersistedDocument(settingsPath, rest, fileOps)
    return
  }

  if (legacyToken.length === 0) {
    const { apiToken: _empty, ...rest } = document
    writePersistedDocument(settingsPath, rest, fileOps)
    return
  }

  if (!secretStore) {
    return
  }

  const reference = document.apiTokenSecretRef ?? apiTokenSecretReference

  try {
    await secretStore.set(reference, legacyToken)
    const readback = await secretStore.get(reference)
    if (readback !== legacyToken) {
      return
    }

    const { apiToken: _migrated, ...rest } = document
    writePersistedDocument(settingsPath, {
      ...rest,
      apiTokenSecretRef: reference,
    }, fileOps)
  } catch {
    // Leave plaintext in place for a retryable migration path.
  }
}

async function toPublicSettings(
  document: PersistedAppSettingsDocument,
  secretStore?: AppSecretStore,
): Promise<AppSettings> {
  const hasLegacyPlaintext =
    typeof document.apiToken === 'string' && document.apiToken.length > 0
  const hasStoredCiphertext =
    typeof document.apiTokenSecretRef === 'string'
    && document.apiTokenSecretRef.length > 0
    && Boolean(secretStore)
    && await secretStore!.has(document.apiTokenSecretRef)

  return normalizeAppSettings({
    ...document,
    apiTokenConfigured: hasLegacyPlaintext || hasStoredCiphertext,
  })
}

function createSecureStorageMigrationFailure() {
  return Object.assign(new Error('Secure storage is unavailable'), {
    code: 'secure_storage_unavailable',
  })
}

function omitWriteOnlyToken(patch: AppSettingsPatch): Omit<AppSettingsPatch, 'apiToken'> {
  const { apiToken: _apiToken, ...rest } = patch
  return rest
}

function readPersistedDocument(settingsPath: string): PersistedAppSettingsDocument {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as unknown
    if (!value || typeof value !== 'object') {
      return {}
    }
    return { ...(value as PersistedAppSettingsDocument) }
  } catch {
    return {}
  }
}

function writePersistedDocument(
  settingsPath: string,
  document: PersistedAppSettingsDocument,
  fileOps: AppSettingsFileOperations = defaultAppSettingsFileOperations,
) {
  const persisted: Record<string, unknown> = { ...document }
  // Public configured flag is derived; never persist it.
  delete persisted.apiTokenConfigured
  writeAppSettingsDocumentAtomically(
    settingsPath,
    `${JSON.stringify(persisted, null, 2)}\n`,
    fileOps,
  )
}

export function writeAppSettingsDocumentAtomically(
  settingsPath: string,
  contents: string,
  fileOps: AppSettingsFileOperations = defaultAppSettingsFileOperations,
) {
  writeAtomicDocument(settingsPath, contents, fileOps)
}
