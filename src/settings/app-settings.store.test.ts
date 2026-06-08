import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultAppSettings } from './app-settings'
import { createFileAppSettingsStore, createWorkspaceAppSettingsStore } from './app-settings.store'
import { resolveWorkspaceLayout } from '../workspace/workspace.paths'

function createTempSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'job-app-settings-')), 'settings.json')
}

describe('file app settings store', () => {
  it('loads defaults when no settings file exists', async () => {
    const store = createFileAppSettingsStore(createTempSettingsPath())

    await expect(store.get()).resolves.toEqual(defaultAppSettings)
    await expect(store.get()).resolves.toMatchObject({ sidebarCollapsed: false })
  })

  it('persists partial updates merged with defaults', async () => {
    const settingsPath = createTempSettingsPath()
    const store = createFileAppSettingsStore(settingsPath)

    await expect(
      store.update({
        remoteApiUrl: 'https://job-app.test',
        runtimeMode: 'remote',
        sidebarCollapsed: true,
        showAdvancedFilters: true,
      }),
    ).resolves.toMatchObject({
      localApiHost: '127.0.0.1',
      localApiPort: 4317,
      remoteApiUrl: 'https://job-app.test',
      runtimeMode: 'remote',
      sidebarCollapsed: true,
      showAdvancedFilters: true,
    })

    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toMatchObject({
      remoteApiUrl: 'https://job-app.test',
      runtimeMode: 'remote',
      showAdvancedFilters: true,
    })
    await expect(createFileAppSettingsStore(settingsPath).get()).resolves.toMatchObject({
      remoteApiUrl: 'https://job-app.test',
      runtimeMode: 'remote',
      sidebarCollapsed: true,
      showAdvancedFilters: true,
    })
  })

  it('resets persisted settings to defaults', async () => {
    const store = createFileAppSettingsStore(createTempSettingsPath())

    await store.update({ localApiHost: '0.0.0.0', runtimeMode: 'local-shared' })

    await expect(store.reset()).resolves.toEqual(defaultAppSettings)
    await expect(store.get()).resolves.toEqual(defaultAppSettings)
  })

  it('falls back to defaults for invalid JSON', async () => {
    const settingsPath = createTempSettingsPath()

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, '{not valid json', 'utf8')

    await expect(createFileAppSettingsStore(settingsPath).get()).resolves.toEqual(
      defaultAppSettings,
    )
  })

  it('persists workspace settings to .job-automation/app.json', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'job-app-workspace-settings-'))
    const layout = resolveWorkspaceLayout(workspaceRoot)
    const store = createWorkspaceAppSettingsStore(workspaceRoot)

    await store.update({ sidebarCollapsed: true })

    expect(JSON.parse(fs.readFileSync(layout.appSettingsPath, 'utf8'))).toMatchObject({
      sidebarCollapsed: true,
    })
    expect(fs.existsSync(path.join(workspaceRoot, 'settings.json'))).toBe(false)
  })
})
