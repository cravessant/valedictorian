import fs from 'node:fs'
import path from 'node:path'
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
  type AppSettingsStore,
} from './app-settings'
import { resolveWorkspaceLayout } from '../workspace/workspace.paths'

export function createFileAppSettingsStore(settingsPath: string): AppSettingsStore {
  return {
    async get() {
      return readSettings(settingsPath)
    },
    async reset() {
      writeSettings(settingsPath, defaultAppSettings)
      return { ...defaultAppSettings }
    },
    async update(patch) {
      const nextSettings = normalizeAppSettings({
        ...readSettings(settingsPath),
        ...patch,
      })

      writeSettings(settingsPath, nextSettings)
      return nextSettings
    },
  }
}

export function createWorkspaceAppSettingsStore(workspaceRootPath: string): AppSettingsStore {
  return createFileAppSettingsStore(resolveWorkspaceLayout(workspaceRootPath).appSettingsPath)
}

function readSettings(settingsPath: string): AppSettings {
  try {
    return normalizeAppSettings(JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as unknown)
  } catch {
    return { ...defaultAppSettings }
  }
}

function writeSettings(settingsPath: string, settings: AppSettings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}
