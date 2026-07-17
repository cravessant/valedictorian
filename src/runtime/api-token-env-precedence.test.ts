import { describe, expect, it, vi } from 'vitest'
import { defaultAppSettings } from '../settings/app-settings'
import { resolveStartupApiToken } from './api-token-resolution'
import { resolveValedictorianRuntimeConfig } from './valedictorian-runtime'

const ENV_CANARY = 'env-canary-token-7a1b'
const SAVED_CANARY = 'saved-canary-token-3c9d'
const SPACED_ENV_CANARY = ' env spaced token 9f2e '

describe('API token environment precedence', () => {
  it('prefers VALEDICTORIAN_API_TOKEN over the privileged saved token without persisting env', () => {
    const config = resolveValedictorianRuntimeConfig({
      apiToken: SAVED_CANARY,
      env: {
        VALEDICTORIAN_API_TOKEN: ENV_CANARY,
      },
      settings: {
        ...defaultAppSettings,
        apiTokenConfigured: true,
        runtimeMode: 'local-shared',
      },
      userDataPath: '/tmp/valedictorian-user-data',
      workspaceDataPath: '/tmp/valedictorian-workspace',
      workspaceId: 'ws-env',
    })

    expect(config.apiToken).toBe(ENV_CANARY)
    expect(JSON.stringify(config)).not.toContain(SAVED_CANARY)
  })

  it('uses the saved token when the environment override is absent', () => {
    const config = resolveValedictorianRuntimeConfig({
      apiToken: SAVED_CANARY,
      env: {},
      settings: {
        ...defaultAppSettings,
        apiTokenConfigured: true,
        runtimeMode: 'local-shared',
      },
      userDataPath: '/tmp/valedictorian-user-data',
      workspaceDataPath: '/tmp/valedictorian-workspace',
      workspaceId: 'ws-env',
    })

    expect(config.apiToken).toBe(SAVED_CANARY)
  })

  it('treats whitespace-only VALEDICTORIAN_API_TOKEN as absent in runtime config', () => {
    const config = resolveValedictorianRuntimeConfig({
      apiToken: SAVED_CANARY,
      env: {
        VALEDICTORIAN_API_TOKEN: '   \t  ',
      },
      settings: {
        ...defaultAppSettings,
        apiTokenConfigured: true,
        runtimeMode: 'local-shared',
      },
      userDataPath: '/tmp/valedictorian-user-data',
      workspaceDataPath: '/tmp/valedictorian-workspace',
      workspaceId: 'ws-env',
    })

    expect(config.apiToken).toBe(SAVED_CANARY)
  })

  it('uses a nonempty environment token without calling saved-token resolution', async () => {
    const resolveSavedApiToken = vi.fn(async () => {
      throw Object.assign(new Error('Secure storage is unavailable'), {
        code: 'secure_storage_unavailable',
      })
    })

    await expect(resolveStartupApiToken({
      env: { VALEDICTORIAN_API_TOKEN: ENV_CANARY },
      resolveSavedApiToken,
    })).resolves.toBe(ENV_CANARY)

    expect(resolveSavedApiToken).not.toHaveBeenCalled()
  })

  it('calls saved-token resolution only when the environment token is absent', async () => {
    const resolveSavedApiToken = vi.fn(async () => SAVED_CANARY)

    await expect(resolveStartupApiToken({
      env: {},
      resolveSavedApiToken,
    })).resolves.toBe(SAVED_CANARY)

    expect(resolveSavedApiToken).toHaveBeenCalledTimes(1)
  })

  it('treats empty and whitespace-only environment tokens as absent and preserves exact nonempty bytes', async () => {
    const resolveSavedApiToken = vi.fn(async () => SAVED_CANARY)

    await expect(resolveStartupApiToken({
      env: { VALEDICTORIAN_API_TOKEN: '' },
      resolveSavedApiToken,
    })).resolves.toBe(SAVED_CANARY)

    await expect(resolveStartupApiToken({
      env: { VALEDICTORIAN_API_TOKEN: '   \t  ' },
      resolveSavedApiToken,
    })).resolves.toBe(SAVED_CANARY)

    resolveSavedApiToken.mockClear()
    await expect(resolveStartupApiToken({
      env: { VALEDICTORIAN_API_TOKEN: SPACED_ENV_CANARY },
      resolveSavedApiToken,
    })).resolves.toBe(SPACED_ENV_CANARY)
    expect(resolveSavedApiToken).not.toHaveBeenCalled()
  })

  it('keeps the environment token process-only and out of diagnostics', async () => {
    const resolveSavedApiToken = vi.fn(async () => {
      throw Object.assign(new Error('Secure storage is unavailable'), {
        code: 'secure_storage_unavailable',
      })
    })

    const token = await resolveStartupApiToken({
      env: { VALEDICTORIAN_API_TOKEN: ENV_CANARY },
      resolveSavedApiToken,
    })

    expect(token).toBe(ENV_CANARY)
    expect(JSON.stringify({
      env: { VALEDICTORIAN_API_TOKEN: ENV_CANARY },
      resolved: '[redacted-presence]',
    })).not.toContain('persisted')
    const diagnostic = JSON.stringify({
      source: 'environment',
      configured: Boolean(token),
    })
    expect(diagnostic).not.toContain(ENV_CANARY)
    expect(diagnostic).not.toContain(SAVED_CANARY)
  })
})
