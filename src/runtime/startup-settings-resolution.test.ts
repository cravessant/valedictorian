import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultAppSettings, type AppSettings } from '../settings/app-settings'
import { createFileAppSettingsStore } from '../settings/app-settings.store'
import { createApplicationFileSecretStore } from '@sparxie/valedictorian-local-runtime/protected-secrets'
import { resolveStartupSettingsAndApiToken } from '@sparxie/valedictorian-local-runtime/runtime'

const ENV_CANARY = 'env-startup-canary-token-8b4d'
const SPACED_ENV_CANARY = ' env spaced startup 2c1a '
const SAVED_CANARY = 'saved-startup-canary-token-5e7f'

const publicSettingsFixture: AppSettings = {
  ...defaultAppSettings,
  runtimeMode: 'local-shared',
  theme: {
    ...defaultAppSettings.theme,
    presetId: 'graphite',
  },
}

const testCodec = {
  decrypt: (value: string) => Buffer.from(value.replace(/^encrypted:/, ''), 'base64').toString(),
  encrypt: (value: string) => `encrypted:${Buffer.from(value).toString('base64')}`,
}

describe('resolveStartupSettingsAndApiToken', () => {
  it('uses a nonempty environment token without calling secret-backed settings or saved-secret status', async () => {
    const readPublicSettings = vi.fn(async () => publicSettingsFixture)
    const readSecretBackedSettingsAndToken = vi.fn(async () => {
      throw new Error('secret-backed settings must not be consulted')
    })

    const result = await resolveStartupSettingsAndApiToken({
      env: { VALEDICTORIAN_API_TOKEN: ENV_CANARY },
      readPublicSettings,
      readSecretBackedSettingsAndToken,
    })

    expect(result.apiToken).toBe(ENV_CANARY)
    expect(result.settings).toEqual(publicSettingsFixture)
    expect(result.settings.apiTokenConfigured).toBe(false)
    expect(readPublicSettings).toHaveBeenCalledTimes(1)
    expect(readSecretBackedSettingsAndToken).not.toHaveBeenCalled()
  })

  it('reads ordinary non-secret startup settings even when saved secrets are malformed', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-startup-settings-'))
    const settingsPath = path.join(workspaceRoot, 'app.json')
    const secretsPath = path.join(workspaceRoot, 'secrets.json')
    fs.writeFileSync(
      settingsPath,
      `${JSON.stringify({
        runtimeMode: 'remote',
        showDebugData: true,
        localApiPort: 9999,
        apiTokenSecretRef: 'app-secret:api-token',
      }, null, 2)}\n`,
      'utf8',
    )
    fs.writeFileSync(secretsPath, '{"version":2,"secrets":{}}', 'utf8')

    const secretBackedStore = createFileAppSettingsStore(settingsPath, {
      secretStore: createApplicationFileSecretStore(secretsPath, testCodec),
    })
    const getSpy = vi.spyOn(secretBackedStore, 'get')
    const resolveSpy = vi.spyOn(secretBackedStore, 'resolveApiToken')

    const result = await resolveStartupSettingsAndApiToken({
      env: { VALEDICTORIAN_API_TOKEN: ENV_CANARY },
      readPublicSettings: () => createFileAppSettingsStore(settingsPath).get(),
      readSecretBackedSettingsAndToken: async () => ({
        settings: await secretBackedStore.get(),
        apiToken: await secretBackedStore.resolveApiToken(),
      }),
    })

    expect(result.apiToken).toBe(ENV_CANARY)
    expect(result.settings).toMatchObject({
      showDebugData: true,
      localApiPort: 9999,
      runtimeMode: 'remote',
    })
    expect(getSpy).not.toHaveBeenCalled()
    expect(resolveSpy).not.toHaveBeenCalled()
    await expect(secretBackedStore.get()).rejects.toThrow(/invalid/i)
  })

  it('preserves exact environment token bytes and keeps them process-only', async () => {
    const result = await resolveStartupSettingsAndApiToken({
      env: { VALEDICTORIAN_API_TOKEN: SPACED_ENV_CANARY },
      readPublicSettings: async () => publicSettingsFixture,
      readSecretBackedSettingsAndToken: async () => {
        throw new Error('should not run')
      },
    })

    expect(result.apiToken).toBe(SPACED_ENV_CANARY)
    expect(JSON.stringify({
      settings: result.settings,
      source: 'environment',
      configured: Boolean(result.apiToken),
    })).not.toContain(SPACED_ENV_CANARY)
  })

  it('falls back to the secret-backed settings path when the environment token is absent, empty, or whitespace', async () => {
    const readPublicSettings = vi.fn(async () => publicSettingsFixture)
    const readSecretBackedSettingsAndToken = vi.fn(async () => ({
      settings: {
        ...publicSettingsFixture,
        apiTokenConfigured: true,
      },
      apiToken: SAVED_CANARY,
    }))

    await expect(resolveStartupSettingsAndApiToken({
      env: {},
      readPublicSettings,
      readSecretBackedSettingsAndToken,
    })).resolves.toEqual({
      settings: {
        ...publicSettingsFixture,
        apiTokenConfigured: true,
      },
      apiToken: SAVED_CANARY,
    })
    expect(readPublicSettings).not.toHaveBeenCalled()
    expect(readSecretBackedSettingsAndToken).toHaveBeenCalledTimes(1)

    readSecretBackedSettingsAndToken.mockClear()
    await expect(resolveStartupSettingsAndApiToken({
      env: { VALEDICTORIAN_API_TOKEN: '' },
      readPublicSettings,
      readSecretBackedSettingsAndToken,
    })).resolves.toMatchObject({ apiToken: SAVED_CANARY })

    readSecretBackedSettingsAndToken.mockClear()
    await expect(resolveStartupSettingsAndApiToken({
      env: { VALEDICTORIAN_API_TOKEN: '   \t  ' },
      readPublicSettings,
      readSecretBackedSettingsAndToken,
    })).resolves.toMatchObject({ apiToken: SAVED_CANARY })
  })
})
