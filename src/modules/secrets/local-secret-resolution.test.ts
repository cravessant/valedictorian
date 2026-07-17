import { describe, expect, it } from 'vitest'
import {
  createLocalSecretResolutionService,
  LocalSecretResolutionCapabilityError,
  LocalSecretResolutionInvalidRequestError,
  rejectUnsupportedLocalSecretResolution,
} from './local-secret-resolution'
import type { SecretValue } from './secret.store'

const CANARY = 'plaintext-canary-value-8e2f'

function secretValue(value: string): SecretValue {
  return {
    key: 'jobright',
    kind: 'password',
    label: 'Jobright',
    updatedAt: '2026-01-01T00:00:00.000Z',
    value,
  }
}

describe('local secret resolution capability', () => {
  it('fails closed with canonical unsupported outcome from the stub', async () => {
    await expect(
      rejectUnsupportedLocalSecretResolution({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
    ).rejects.toMatchObject({
      code: 'local_secret_resolution_unsupported',
      statusCode: 409,
      body: {
        code: 'local_secret_resolution_unsupported',
        message: 'Local secret resolution is unsupported.',
      },
    })
  })

  it('resolves byte-exact plaintext when policy permits', async () => {
    const service = createLocalSecretResolutionService({
      policy: {
        enabled: true,
        isSecureStorageAvailable: () => true,
      },
      resolveSecret: async () => secretValue(` ${CANARY} `),
    })

    await expect(
      service.resolve({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
    ).resolves.toEqual({
      value: ` ${CANARY} `,
      handling: { cache: 'no-store', sensitivity: 'secret' },
    })
  })

  it('maps missing, unsupported, and unavailable outcomes to canonical typed failures', async () => {
    const unsupported = createLocalSecretResolutionService({
      policy: { enabled: false, isSecureStorageAvailable: () => true },
      resolveSecret: async () => secretValue(CANARY),
    })
    await expect(
      unsupported.resolve({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
    ).rejects.toBeInstanceOf(LocalSecretResolutionCapabilityError)
    await expect(
      unsupported.resolve({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
    ).rejects.toMatchObject({ code: 'local_secret_resolution_unsupported', statusCode: 409 })

    const unavailable = createLocalSecretResolutionService({
      policy: { enabled: true, isSecureStorageAvailable: () => false },
      resolveSecret: async () => secretValue(CANARY),
    })
    await expect(
      unavailable.resolve({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
    ).rejects.toMatchObject({ code: 'secure_storage_unavailable', statusCode: 503 })

    const missing = createLocalSecretResolutionService({
      policy: { enabled: true, isSecureStorageAvailable: () => true },
      resolveSecret: async () => null,
    })
    await expect(
      missing.resolve({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://missing' },
      }),
    ).rejects.toMatchObject({ code: 'secret_not_found', statusCode: 404 })
  })

  it('maps unexpected adapter failures to value-free responses without reflecting canaries', async () => {
    const service = createLocalSecretResolutionService({
      policy: { enabled: true, isSecureStorageAvailable: () => true },
      resolveSecret: async () => {
        throw new Error(`boom containing ${CANARY}`)
      },
    })

    await expect(
      service.resolve({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      body: { message: 'Local secret resolution failed' },
    })

    try {
      await service.resolve({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      })
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(CANARY)
      expect(String(error)).not.toContain(CANARY)
    }
  })

  it('maps schema-invalid input to a value-free 400 failure', async () => {
    const service = createLocalSecretResolutionService({
      policy: { enabled: true, isSecureStorageAvailable: () => true },
      resolveSecret: async () => secretValue(CANARY),
    })

    await expect(
      service.resolve({ purpose: { kind: 'not-a-purpose' } }),
    ).rejects.toBeInstanceOf(LocalSecretResolutionInvalidRequestError)

    await expect(
      service.resolve({ purpose: { kind: 'not-a-purpose' } }),
    ).rejects.toMatchObject({
      statusCode: 400,
      body: { message: 'Invalid local secret resolution request' },
    })

    try {
      await service.resolve({ purpose: { kind: 'not-a-purpose' }, reference: { $valedictorianRef: `secret://${CANARY}` } })
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(CANARY)
      expect(String(error)).not.toContain(CANARY)
    }
  })
})
