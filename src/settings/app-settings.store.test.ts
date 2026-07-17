import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultAppSettings } from './app-settings'
import { createFileAppSecretStore } from './app-secret.store'
import {
  apiTokenSecretReference,
  createFileAppSettingsStore,
  createWorkspaceAppSettingsStore,
} from './app-settings.store'
import { resolveWorkspaceLayout } from '../workspace/workspace.paths'

function createTempSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-settings-')), 'settings.json')
}

const testCodec = {
  decrypt: (value: string) => Buffer.from(value.replace(/^encrypted:/, ''), 'base64').toString(),
  encrypt: (value: string) => `encrypted:${Buffer.from(value).toString('base64')}`,
}

function createSecretBackedSettingsStore(settingsPath: string) {
  const secretsPath = path.join(path.dirname(settingsPath), 'secrets.json')
  return {
    secretsPath,
    store: createFileAppSettingsStore(settingsPath, {
      secretStore: createFileAppSecretStore(secretsPath, testCodec),
    }),
  }
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

  it('stores API tokens encrypted and persists only their reference in app.json', async () => {
    const settingsPath = createTempSettingsPath()
    const { secretsPath, store } = createSecretBackedSettingsStore(settingsPath)

    await expect(store.update({ apiToken: 'new-secret-token' })).resolves.toMatchObject({
      apiToken: 'new-secret-token',
      apiTokenSecretRef: apiTokenSecretReference,
    })

    const persistedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(persistedSettings).not.toHaveProperty('apiToken')
    expect(persistedSettings).toMatchObject({ apiTokenSecretRef: apiTokenSecretReference })
    expect(fs.readFileSync(secretsPath, 'utf8')).not.toContain('new-secret-token')
    await expect(store.get()).resolves.toMatchObject({ apiToken: 'new-secret-token' })
  })

  it('scrubs unsupported plaintext API tokens instead of importing them', async () => {
    const settingsPath = createTempSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({
      ...defaultAppSettings,
      apiToken: 'legacy-secret-token',
      runtimeMode: 'remote',
    }), 'utf8')
    const { secretsPath, store } = createSecretBackedSettingsStore(settingsPath)

    await expect(store.get()).resolves.toMatchObject({
      apiToken: '',
      runtimeMode: 'remote',
    })

    const persistedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(persistedSettings).not.toHaveProperty('apiToken')
    expect(persistedSettings).not.toHaveProperty('apiTokenSecretRef')
    expect(fs.existsSync(secretsPath)).toBe(false)
  })

  it('removes the encrypted API token when settings are reset', async () => {
    const settingsPath = createTempSettingsPath()
    const { secretsPath, store } = createSecretBackedSettingsStore(settingsPath)
    await store.update({ apiToken: 'discard-me' })

    await expect(store.reset()).resolves.toEqual(defaultAppSettings)

    expect(fs.readFileSync(secretsPath, 'utf8')).not.toContain(apiTokenSecretReference)
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).not.toHaveProperty('apiToken')
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
