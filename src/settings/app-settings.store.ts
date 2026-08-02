import fs from 'node:fs'
import {
  defaultAtomicDocumentFileOperations,
  writeAtomicDocument,
  type AppSecretStore,
  type AtomicDocumentFileOperations,
} from '@sparxie/valedictorian-local-runtime/protected-secrets'
import {
  resolveWorkspaceLayout,
} from '@sparxie/valedictorian-local-runtime/workspace-files'
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
  type AppSettingsPatch,
  type AppSettingsStore,
} from './app-settings'

export const apiTokenSecretReference = 'app-secret:api-token'

interface PersistedAppSettingsDocument {
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
  fileOps?: AtomicDocumentFileOperations
  secretStore?: AppSecretStore
}

export function createFileAppSettingsStore(
  settingsPath: string,
  { fileOps = defaultAtomicDocumentFileOperations, secretStore }: FileAppSettingsStoreOptions = {},
): AppSettingsStore {
  return {
    async get() {
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
      const document = readPersistedDocument(settingsPath)

      if (document.apiTokenSecretRef && secretStore) {
        return secretStore.get(document.apiTokenSecretRef)
      }

      return null
    },
    async update(patch: AppSettingsPatch) {
      const current = readPersistedDocument(settingsPath)
      const nextPublic = normalizeAppSettings({
        ...(await toPublicSettings(current, secretStore)),
        ...omitWriteOnlyToken(patch),
      })
      const nextDocument: PersistedAppSettingsDocument = {
        apiTokenSecretRef: current.apiTokenSecretRef,
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
        } else {
          if (current.apiTokenSecretRef) {
            await secretStore.delete(current.apiTokenSecretRef)
          }
          delete nextDocument.apiTokenSecretRef
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

async function toPublicSettings(
  document: PersistedAppSettingsDocument,
  secretStore?: AppSecretStore,
): Promise<AppSettings> {
  const hasStoredCiphertext =
    typeof document.apiTokenSecretRef === 'string'
    && document.apiTokenSecretRef.length > 0
    && Boolean(secretStore)
    && await secretStore!.has(document.apiTokenSecretRef)

  return normalizeAppSettings({
    ...document,
    apiTokenConfigured: hasStoredCiphertext,
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
  fileOps: AtomicDocumentFileOperations,
) {
  writeAppSettingsDocumentAtomically(
    settingsPath,
    `${JSON.stringify(document, null, 2)}\n`,
    fileOps,
  )
}

export function writeAppSettingsDocumentAtomically(
  settingsPath: string,
  contents: string,
  fileOps: AtomicDocumentFileOperations = defaultAtomicDocumentFileOperations,
) {
  writeAtomicDocument(settingsPath, contents, fileOps)
}
