import fs from 'node:fs'
import path from 'node:path'
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
  type AppSettingsStore,
} from './app-settings'
import type { AppSecretStore } from './app-secret.store'
import { resolveWorkspaceLayout } from '../workspace/workspace.paths'

export const apiTokenSecretReference = 'app-secret:api-token'

export interface FileAppSettingsStoreOptions {
  secretStore?: AppSecretStore
}

export function createFileAppSettingsStore(
  settingsPath: string,
  { secretStore }: FileAppSettingsStoreOptions = {},
): AppSettingsStore {
  return {
    async get() {
      return readSettings(settingsPath, secretStore)
    },
    async reset() {
      const currentSettings = await readSettings(settingsPath, secretStore)

      if (currentSettings.apiTokenSecretRef && secretStore) {
        await secretStore.delete(currentSettings.apiTokenSecretRef)
      }

      writeSettings(settingsPath, defaultAppSettings)
      return { ...defaultAppSettings }
    },
    async update(patch) {
      const currentSettings = await readSettings(settingsPath, secretStore)
      const nextSettings = normalizeAppSettings({
        ...currentSettings,
        ...patch,
      })

      if (patch.apiToken !== undefined) {
        if (!secretStore) {
          throw new Error('An encrypted app secret store is required to save the API token')
        }

        if (patch.apiToken) {
          const reference = currentSettings.apiTokenSecretRef ?? apiTokenSecretReference
          await secretStore.set(reference, patch.apiToken)
          nextSettings.apiTokenSecretRef = reference
        } else if (currentSettings.apiTokenSecretRef) {
          await secretStore.delete(currentSettings.apiTokenSecretRef)
          nextSettings.apiTokenSecretRef = undefined
        }
      }

      writeSettings(settingsPath, nextSettings)
      return nextSettings
    },
  }
}

export function createWorkspaceAppSettingsStore(
  workspaceRootPath: string,
  options: FileAppSettingsStoreOptions = {},
): AppSettingsStore {
  return createFileAppSettingsStore(resolveWorkspaceLayout(workspaceRootPath).appSettingsPath, options)
}

async function readSettings(
  settingsPath: string,
  secretStore?: AppSecretStore,
): Promise<AppSettings> {
  const settings = readSettingsFile(settingsPath)

  if (settings.apiTokenSecretRef && secretStore) {
    return {
      ...settings,
      apiToken: await secretStore.get(settings.apiTokenSecretRef) ?? '',
    }
  }

  return settings
}

function readSettingsFile(settingsPath: string): AppSettings {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as unknown

    if (value && typeof value === 'object' && 'apiToken' in value) {
      const { apiToken: _unsupportedApiToken, ...persistedSettings } = value as Record<string, unknown>
      const settings = normalizeAppSettings(persistedSettings)
      writeSettings(settingsPath, settings)
      return settings
    }

    return normalizeAppSettings(value)
  } catch {
    return { ...defaultAppSettings }
  }
}

function writeSettings(settingsPath: string, settings: AppSettings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  const { apiToken: _apiToken, ...persistedSettings } = settings
  fs.writeFileSync(settingsPath, `${JSON.stringify(persistedSettings, null, 2)}\n`, 'utf8')
}
