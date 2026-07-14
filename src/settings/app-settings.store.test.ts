import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultAppSettings } from './app-settings'
import { createFileAppSettingsStore, createWorkspaceAppSettingsStore } from './app-settings.store'
import { resolveWorkspaceLayout } from '../workspace/workspace.paths'

function createTempSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-settings-')), 'settings.json')
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
        remoteApiUrl: 'https://valedictorian.test',
        runtimeMode: 'remote',
        sidebarCollapsed: true,
        showAdvancedFilters: true,
        showDebugData: true,
      }),
    ).resolves.toMatchObject({
      localApiHost: '127.0.0.1',
      localApiPort: 4317,
      remoteApiUrl: 'https://valedictorian.test',
      runtimeMode: 'remote',
      sidebarCollapsed: true,
      showAdvancedFilters: true,
      showDebugData: true,
    })

    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toMatchObject({
      remoteApiUrl: 'https://valedictorian.test',
      runtimeMode: 'remote',
      showAdvancedFilters: true,
      showDebugData: true,
    })
    await expect(createFileAppSettingsStore(settingsPath).get()).resolves.toMatchObject({
      remoteApiUrl: 'https://valedictorian.test',
      runtimeMode: 'remote',
      sidebarCollapsed: true,
      showAdvancedFilters: true,
      showDebugData: true,
    })
  })

  it('resets persisted settings including showDebugData to defaults', async () => {
    const store = createFileAppSettingsStore(createTempSettingsPath())

    await store.update({ localApiHost: '0.0.0.0', runtimeMode: 'local-shared', showDebugData: true })

    await expect(store.reset()).resolves.toEqual(defaultAppSettings)
    await expect(store.get()).resolves.toEqual(defaultAppSettings)
    await expect(store.get()).resolves.toMatchObject({ showDebugData: false })
  })

  it('falls back to defaults for invalid JSON', async () => {
    const settingsPath = createTempSettingsPath()

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, '{not valid json', 'utf8')

    await expect(createFileAppSettingsStore(settingsPath).get()).resolves.toEqual(
      defaultAppSettings,
    )
  })

  it('persists workspace settings to .valedictorian/app.json', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-workspace-settings-'))
    const layout = resolveWorkspaceLayout(workspaceRoot)
    const store = createWorkspaceAppSettingsStore(workspaceRoot)

    await store.update({ sidebarCollapsed: true })

    expect(JSON.parse(fs.readFileSync(layout.appSettingsPath, 'utf8'))).toMatchObject({
      sidebarCollapsed: true,
    })
    expect(fs.existsSync(path.join(workspaceRoot, 'settings.json'))).toBe(false)
  })

  it('keeps theme settings isolated between workspace roots', async () => {
    const workspaceRootA = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-workspace-theme-a-'))
    const workspaceRootB = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-workspace-theme-b-'))
    const storeA = createWorkspaceAppSettingsStore(workspaceRootA)
    const storeB = createWorkspaceAppSettingsStore(workspaceRootB)

    await storeA.update({
      theme: { presetId: 'graphite', overrides: { primary: '#123456' } },
    })
    await storeB.update({
      theme: { presetId: 'catppuccin-latte', overrides: { background: '#abcdef' } },
    })

    await expect(storeA.get()).resolves.toMatchObject({
      theme: { presetId: 'graphite', overrides: { primary: '#123456' } },
    })
    await expect(storeB.get()).resolves.toMatchObject({
      theme: { presetId: 'catppuccin-latte', overrides: { background: '#abcdef' } },
    })
    expect(fs.readFileSync(resolveWorkspaceLayout(workspaceRootA).appSettingsPath, 'utf8')).toContain('graphite')
    expect(fs.readFileSync(resolveWorkspaceLayout(workspaceRootB).appSettingsPath, 'utf8')).toContain('catppuccin-latte')
  })
})
