import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultAppSettings } from './app-settings'
import { createApplicationFileSecretStore } from './app-secret.composition'
import {
  defaultAtomicDocumentFileOperations,
  type AtomicDocumentFileOperations,
} from './atomic-document'
import {
  apiTokenSecretReference,
  createFileAppSettingsStore,
  createWorkspaceAppSettingsStore,
  defaultAppSettingsFileOperations,
  writeAppSettingsDocumentAtomically,
  type AppSettingsFileOperations,
} from './app-settings.store'
import { resolveWorkspaceLayout } from '../workspace/workspace.paths'

const TOKEN_CANARY = 'canary-api-token-9f3c2a1b'

const ORIGINAL_DOCUMENT = `${JSON.stringify({
  apiToken: TOKEN_CANARY,
  runtimeMode: 'remote',
}, null, 2)}\n`

function createTempSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-settings-')), 'settings.json')
}

const testCodec = {
  decrypt: (value: string) => Buffer.from(value.replace(/^encrypted:/, ''), 'base64').toString(),
  encrypt: (value: string) => {
    if (value === 'trigger-unavailable') {
      throw Object.assign(new Error('Secure storage is unavailable'), {
        code: 'secure_storage_unavailable',
      })
    }
    return `encrypted:${Buffer.from(value).toString('base64')}`
  },
}

function createSecretBackedSettingsStore(settingsPath: string, codec = testCodec) {
  const secretsPath = path.join(path.dirname(settingsPath), 'secrets.json')
  return {
    secretsPath,
    store: createFileAppSettingsStore(settingsPath, {
      secretStore: createApplicationFileSecretStore(secretsPath, codec),
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

  it('stores API tokens encrypted and returns only configured status publicly', async () => {
    const settingsPath = createTempSettingsPath()
    const { secretsPath, store } = createSecretBackedSettingsStore(settingsPath)

    await expect(store.update({ apiToken: TOKEN_CANARY })).resolves.toEqual(
      expect.objectContaining({
        apiTokenConfigured: true,
      }),
    )
    const publicSettings = await store.get()
    expect(publicSettings).toMatchObject({ apiTokenConfigured: true })
    expect(publicSettings).not.toHaveProperty('apiToken')
    expect(publicSettings).not.toHaveProperty('apiTokenSecretRef')
    expect(JSON.stringify(publicSettings)).not.toContain(TOKEN_CANARY)

    const persistedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(persistedSettings).not.toHaveProperty('apiToken')
    expect(persistedSettings).not.toHaveProperty('apiTokenConfigured')
    expect(persistedSettings).toMatchObject({ apiTokenSecretRef: apiTokenSecretReference })
    expect(fs.readFileSync(secretsPath, 'utf8')).not.toContain(TOKEN_CANARY)
    await expect(store.resolveApiToken()).resolves.toBe(TOKEN_CANARY)
  })

  it('migrates legacy plaintext API tokens only after verified encrypted readback', async () => {
    const settingsPath = createTempSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({
      apiToken: TOKEN_CANARY,
      runtimeMode: 'remote',
    }), 'utf8')
    const { secretsPath, store } = createSecretBackedSettingsStore(settingsPath)

    await expect(store.get()).resolves.toMatchObject({
      apiTokenConfigured: true,
      runtimeMode: 'remote',
    })
    await expect(store.resolveApiToken()).resolves.toBe(TOKEN_CANARY)

    const persistedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(persistedSettings).not.toHaveProperty('apiToken')
    expect(persistedSettings).toMatchObject({ apiTokenSecretRef: apiTokenSecretReference })
    expect(fs.readFileSync(secretsPath, 'utf8')).not.toContain(TOKEN_CANARY)
    expect(JSON.stringify(persistedSettings)).not.toContain(TOKEN_CANARY)
  })

  it('keeps legacy plaintext when encryption is unavailable so migration stays retryable', async () => {
    const settingsPath = createTempSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({
      apiToken: TOKEN_CANARY,
      runtimeMode: 'remote',
    }), 'utf8')
    const unavailableCodec = {
      decrypt: () => {
        throw Object.assign(new Error('Secure storage is unavailable'), {
          code: 'secure_storage_unavailable',
        })
      },
      encrypt: () => {
        throw Object.assign(new Error('Secure storage is unavailable'), {
          code: 'secure_storage_unavailable',
        })
      },
    }
    const { secretsPath, store } = createSecretBackedSettingsStore(settingsPath, unavailableCodec)

    await expect(store.get()).resolves.toMatchObject({
      apiTokenConfigured: true,
      runtimeMode: 'remote',
    })
    await expect(store.resolveApiToken()).rejects.toMatchObject({
      code: 'secure_storage_unavailable',
    })
    await expect(store.resolveApiToken()).rejects.toSatisfy((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain(TOKEN_CANARY)
      expect(String(error)).not.toContain(TOKEN_CANARY)
      return true
    })

    const persistedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(persistedSettings).toMatchObject({ apiToken: TOKEN_CANARY })
    expect(persistedSettings).not.toHaveProperty('apiTokenSecretRef')
    expect(fs.existsSync(secretsPath)).toBe(false)
  })

  it('keeps legacy plaintext when encrypted readback does not match', async () => {
    const settingsPath = createTempSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({
      apiToken: TOKEN_CANARY,
    }), 'utf8')
    const mismatchedCodec = {
      decrypt: () => 'different-value',
      encrypt: (value: string) => `encrypted:${Buffer.from(value).toString('base64')}`,
    }
    const { store } = createSecretBackedSettingsStore(settingsPath, mismatchedCodec)

    await expect(store.get()).resolves.toMatchObject({ apiTokenConfigured: true })
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toMatchObject({
      apiToken: TOKEN_CANARY,
    })
    await expect(store.resolveApiToken()).rejects.toMatchObject({
      code: 'secure_storage_unavailable',
    })
    await expect(store.resolveApiToken()).rejects.toSatisfy((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain(TOKEN_CANARY)
      expect(String(error)).not.toContain(TOKEN_CANARY)
      return true
    })
  })

  it('treats a stale apiTokenSecretRef without a store entry as not configured', async () => {
    const settingsPath = createTempSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({
      apiTokenSecretRef: apiTokenSecretReference,
      runtimeMode: 'remote',
    }), 'utf8')
    const { secretsPath, store } = createSecretBackedSettingsStore(settingsPath)
    expect(fs.existsSync(secretsPath)).toBe(false)

    const publicSettings = await store.get()
    expect(publicSettings).toMatchObject({ apiTokenConfigured: false, runtimeMode: 'remote' })
    expect(publicSettings).not.toHaveProperty('apiToken')
    expect(publicSettings).not.toHaveProperty('apiTokenSecretRef')
    expect(JSON.stringify(publicSettings)).not.toContain(TOKEN_CANARY)
  })

  it('reports configured from ciphertext presence without decrypting', async () => {
    const settingsPath = createTempSettingsPath()
    const secretsPath = path.join(path.dirname(settingsPath), 'secrets.json')
    fs.writeFileSync(settingsPath, JSON.stringify({
      apiTokenSecretRef: apiTokenSecretReference,
    }), 'utf8')
    fs.writeFileSync(secretsPath, JSON.stringify({
      version: 1,
      secrets: {
        [apiTokenSecretReference]: `encrypted:${Buffer.from(TOKEN_CANARY).toString('base64')}`,
      },
    }), 'utf8')

    const decryptCalls: string[] = []
    const unavailableCodec = {
      decrypt(value: string) {
        decryptCalls.push(value)
        throw Object.assign(new Error('Secure storage is unavailable'), {
          code: 'secure_storage_unavailable',
        })
      },
      encrypt() {
        throw Object.assign(new Error('Secure storage is unavailable'), {
          code: 'secure_storage_unavailable',
        })
      },
    }
    const store = createFileAppSettingsStore(settingsPath, {
      secretStore: createApplicationFileSecretStore(secretsPath, unavailableCodec),
    })

    const publicSettings = await store.get()
    expect(publicSettings).toMatchObject({ apiTokenConfigured: true })
    expect(publicSettings).not.toHaveProperty('apiToken')
    expect(publicSettings).not.toHaveProperty('apiTokenSecretRef')
    expect(JSON.stringify(publicSettings)).not.toContain(TOKEN_CANARY)
    expect(decryptCalls).toEqual([])
  })

  it('removes empty legacy plaintext without storing a secret', async () => {
    const settingsPath = createTempSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({
      apiToken: '',
      runtimeMode: 'local-shared',
    }), 'utf8')
    const { secretsPath, store } = createSecretBackedSettingsStore(settingsPath)

    await expect(store.get()).resolves.toMatchObject({
      apiTokenConfigured: false,
      runtimeMode: 'local-shared',
    })
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).not.toHaveProperty('apiToken')
    expect(fs.existsSync(secretsPath)).toBe(false)
  })

  it('deletes the encrypted API token and returns not configured', async () => {
    const settingsPath = createTempSettingsPath()
    const { secretsPath, store } = createSecretBackedSettingsStore(settingsPath)
    await store.update({ apiToken: TOKEN_CANARY })

    await expect(store.update({ apiToken: '' })).resolves.toMatchObject({
      apiTokenConfigured: false,
    })
    await expect(store.resolveApiToken()).resolves.toBeNull()
    expect(fs.readFileSync(secretsPath, 'utf8')).not.toContain(apiTokenSecretReference)
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).not.toHaveProperty('apiTokenSecretRef')
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

describe('atomic app settings document replacement', () => {
  function createRecordingFileOps(
    overrides: Partial<AppSettingsFileOperations> = {},
  ): AppSettingsFileOperations {
    return {
      ...defaultAppSettingsFileOperations,
      ...overrides,
    }
  }

  it('leaves the original document intact when a temp write fails before replacement', () => {
    const settingsPath = createTempSettingsPath()
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, ORIGINAL_DOCUMENT, 'utf8')

    const fileOps = createRecordingFileOps({
      writeSync() {
        throw Object.assign(new Error('ENOSPC while writing settings'), { code: 'ENOSPC' })
      },
    })

    expect(() => writeAppSettingsDocumentAtomically(
      settingsPath,
      `${JSON.stringify({ apiTokenSecretRef: apiTokenSecretReference, runtimeMode: 'remote' }, null, 2)}\n`,
      fileOps,
    )).toThrow(/ENOSPC|writing settings/i)

    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(ORIGINAL_DOCUMENT)
    const leftovers = fs.readdirSync(path.dirname(settingsPath)).filter((entry) => entry.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('completes the destination when the filesystem returns short UTF-8 writes', () => {
    const settingsPath = createTempSettingsPath()
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, ORIGINAL_DOCUMENT, 'utf8')

    const replacement = `${JSON.stringify({
      apiTokenSecretRef: apiTokenSecretReference,
      note: 'Café 日本語 🎉',
      runtimeMode: 'remote',
    }, null, 2)}\n`
    const expectedBytes = Buffer.from(replacement, 'utf8')
    expect(expectedBytes.length).toBeGreaterThan(replacement.length)

    let writeCalls = 0
    const fileOps = createRecordingFileOps({
      writeSync(fd, data, offset = 0, length) {
        writeCalls += 1
        const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
        const remaining = length ?? buffer.length - offset
        const chunk = Math.min(7, remaining)
        if (chunk <= 0) {
          return 0
        }
        return fs.writeSync(fd, buffer, offset, chunk)
      },
    })

    writeAppSettingsDocumentAtomically(settingsPath, replacement, fileOps)

    const destination = fs.readFileSync(settingsPath)
    expect(Buffer.compare(destination, expectedBytes)).toBe(0)
    expect(destination.toString('utf8')).toBe(replacement)
    expect(JSON.parse(destination.toString('utf8'))).toMatchObject({
      note: 'Café 日本語 🎉',
      runtimeMode: 'remote',
    })
    expect(writeCalls).toBeGreaterThan(1)
  })

  it('leaves the original document intact when a short write makes no progress', () => {
    const settingsPath = createTempSettingsPath()
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, ORIGINAL_DOCUMENT, 'utf8')

    const fileOps = createRecordingFileOps({
      writeSync() {
        return 0
      },
    })

    expect(() => writeAppSettingsDocumentAtomically(
      settingsPath,
      `${JSON.stringify({
        apiTokenSecretRef: apiTokenSecretReference,
        note: 'Café 日本語',
        runtimeMode: 'remote',
      }, null, 2)}\n`,
      fileOps,
    )).toThrow(/no progress|short write/i)

    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(ORIGINAL_DOCUMENT)
    const leftovers = fs.readdirSync(path.dirname(settingsPath)).filter((entry) => entry.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('leaves the original document intact when rename replacement fails', () => {
    const settingsPath = createTempSettingsPath()
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, ORIGINAL_DOCUMENT, 'utf8')

    const fileOps = createRecordingFileOps({
      renameSync() {
        throw Object.assign(new Error('rename failed'), { code: 'EPERM' })
      },
    })

    expect(() => writeAppSettingsDocumentAtomically(
      settingsPath,
      `${JSON.stringify({ apiTokenSecretRef: apiTokenSecretReference, runtimeMode: 'remote' }, null, 2)}\n`,
      fileOps,
    )).toThrow(/rename failed/i)

    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(ORIGINAL_DOCUMENT)
    const leftovers = fs.readdirSync(path.dirname(settingsPath)).filter((entry) => entry.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('replaces with a complete migrated document and no plaintext on success', async () => {
    const settingsPath = createTempSettingsPath()
    fs.writeFileSync(settingsPath, ORIGINAL_DOCUMENT, 'utf8')
    const { secretsPath, store } = createSecretBackedSettingsStore(settingsPath)

    await expect(store.get()).resolves.toMatchObject({
      apiTokenConfigured: true,
      runtimeMode: 'remote',
    })

    const persisted = fs.readFileSync(settingsPath, 'utf8')
    const parsed = JSON.parse(persisted) as Record<string, unknown>
    expect(parsed).toMatchObject({
      apiTokenSecretRef: apiTokenSecretReference,
      runtimeMode: 'remote',
    })
    expect(parsed).not.toHaveProperty('apiToken')
    expect(persisted).not.toContain(TOKEN_CANARY)
    expect(fs.readFileSync(secretsPath, 'utf8')).not.toContain(TOKEN_CANARY)
    expect(fs.statSync(settingsPath).mode & 0o777).toBe(0o600)
  })

  it('cleans up temporary artifacts best-effort without leaking canaries in diagnostics', () => {
    const settingsPath = createTempSettingsPath()
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, ORIGINAL_DOCUMENT, 'utf8')
    const openedTemps: string[] = []

    const fileOps = createRecordingFileOps({
      openSync(target, flags, mode) {
        const fd = defaultAppSettingsFileOperations.openSync(target, flags, mode)
        if (target !== settingsPath) {
          openedTemps.push(target)
        }
        return fd
      },
      renameSync() {
        throw Object.assign(new Error('rename failed'), { code: 'EPERM' })
      },
    })

    let thrown: unknown
    try {
      writeAppSettingsDocumentAtomically(
        settingsPath,
        `${JSON.stringify({ apiTokenSecretRef: apiTokenSecretReference }, null, 2)}\n`,
        fileOps,
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeTruthy()
    expect(String(thrown)).not.toContain(TOKEN_CANARY)
    expect(JSON.stringify(thrown, Object.getOwnPropertyNames(thrown as object))).not.toContain(TOKEN_CANARY)
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(ORIGINAL_DOCUMENT)
    expect(openedTemps.length).toBeGreaterThan(0)
    for (const temporaryPath of openedTemps) {
      expect(fs.existsSync(temporaryPath)).toBe(false)
      expect(path.dirname(temporaryPath)).toBe(path.dirname(settingsPath))
      expect(path.basename(temporaryPath)).not.toBe(`${path.basename(settingsPath)}.tmp`)
    }
  })

  it('does not report success until file fsync, rename, and containing-directory fsync complete', () => {
    const settingsPath = createTempSettingsPath()
    const events: string[] = []
    const fileOps = createRecordingFileOps({
      closeSync(fd) {
        events.push('close:file')
        defaultAppSettingsFileOperations.closeSync(fd)
      },
      fsyncDirectory(directoryPath) {
        events.push('fsyncDirectory')
        defaultAppSettingsFileOperations.fsyncDirectory(directoryPath)
      },
      fsyncSync(fd) {
        events.push('fsync:file')
        defaultAppSettingsFileOperations.fsyncSync(fd)
      },
      openSync(filePath, flags, mode) {
        events.push(`open:${flags}`)
        return defaultAppSettingsFileOperations.openSync(filePath, flags, mode)
      },
      renameSync(from, to) {
        events.push('rename')
        defaultAppSettingsFileOperations.renameSync(from, to)
      },
      writeSync(fd, data, offset, length) {
        events.push('write')
        return defaultAppSettingsFileOperations.writeSync(fd, data, offset, length)
      },
    })

    writeAppSettingsDocumentAtomically(
      settingsPath,
      `${JSON.stringify({ runtimeMode: 'remote' }, null, 2)}\n`,
      fileOps,
    )

    expect(events.indexOf('open:wx')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('write')).toBeGreaterThan(events.indexOf('open:wx'))
    expect(events.indexOf('fsync:file')).toBeGreaterThan(events.indexOf('write'))
    expect(events.indexOf('close:file')).toBeGreaterThan(events.indexOf('fsync:file'))
    expect(events.indexOf('rename')).toBeGreaterThan(events.indexOf('close:file'))
    expect(events.indexOf('fsyncDirectory')).toBeGreaterThan(events.indexOf('rename'))
  })
})

describe('legacy API token migration durability ordering', () => {
  function createPrefixedRecordingOps(
    events: string[],
    prefix: string,
  ): AtomicDocumentFileOperations {
    return {
      chmodSync(filePath, mode) {
        events.push(`${prefix}:chmod`)
        defaultAtomicDocumentFileOperations.chmodSync(filePath, mode)
      },
      closeSync(fd) {
        events.push(`${prefix}:close:file`)
        defaultAtomicDocumentFileOperations.closeSync(fd)
      },
      fsyncDirectory(directoryPath) {
        events.push(`${prefix}:fsyncDirectory`)
        defaultAtomicDocumentFileOperations.fsyncDirectory(directoryPath)
      },
      fsyncSync(fd) {
        events.push(`${prefix}:fsync:file`)
        defaultAtomicDocumentFileOperations.fsyncSync(fd)
      },
      mkdirSync(directoryPath, options) {
        events.push(`${prefix}:mkdir`)
        defaultAtomicDocumentFileOperations.mkdirSync(directoryPath, options)
      },
      openSync(filePath, flags, mode) {
        events.push(`${prefix}:open:${flags}`)
        return defaultAtomicDocumentFileOperations.openSync(filePath, flags, mode)
      },
      renameSync(from, to) {
        events.push(`${prefix}:rename`)
        defaultAtomicDocumentFileOperations.renameSync(from, to)
      },
      unlinkSync(filePath) {
        events.push(`${prefix}:unlink`)
        defaultAtomicDocumentFileOperations.unlinkSync(filePath)
      },
      writeSync(fd, data, offset, length) {
        events.push(`${prefix}:write`)
        return defaultAtomicDocumentFileOperations.writeSync(fd, data, offset, length)
      },
    }
  }

  it('completes durable secret-store set before starting plaintext-removing settings replacement', async () => {
    const settingsPath = createTempSettingsPath()
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, ORIGINAL_DOCUMENT, 'utf8')
    const secretsPath = path.join(path.dirname(settingsPath), 'secrets.json')
    const events: string[] = []

    const store = createFileAppSettingsStore(settingsPath, {
      fileOps: createPrefixedRecordingOps(events, 'settings'),
      secretStore: createApplicationFileSecretStore(
        secretsPath,
        testCodec,
        { fileOps: createPrefixedRecordingOps(events, 'secret') },
      ),
    })

    await expect(store.get()).resolves.toMatchObject({
      apiTokenConfigured: true,
      runtimeMode: 'remote',
    })

    const secretDirSync = events.indexOf('secret:fsyncDirectory')
    const settingsTempOpen = events.indexOf('settings:open:wx')
    expect(secretDirSync).toBeGreaterThanOrEqual(0)
    expect(settingsTempOpen).toBeGreaterThan(secretDirSync)
    expect(events.indexOf('settings:rename')).toBeGreaterThan(settingsTempOpen)

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    expect(persisted).not.toHaveProperty('apiToken')
    expect(persisted).toMatchObject({ apiTokenSecretRef: apiTokenSecretReference })
    expect(fs.readFileSync(settingsPath, 'utf8')).not.toContain(TOKEN_CANARY)
    expect(fs.readFileSync(secretsPath, 'utf8')).not.toContain(TOKEN_CANARY)
  })
})
