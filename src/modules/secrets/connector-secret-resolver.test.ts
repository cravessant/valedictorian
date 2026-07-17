import { describe, expect, it, vi } from 'vitest'
import { normalizeProfileAnswerKey } from 'sparxie'
import { createConnectorSecretResolver } from './connector-secret-resolver'
import { identitySsnLast4SecretKey } from './secret.identity'

describe('createConnectorSecretResolver', () => {
  it('exposes only revealSecret and never returns store shapes', async () => {
    const resolve = vi.fn(async (key: string) =>
      key === 'jobright'
        ? {
            key: 'jobright',
            kind: 'password' as const,
            label: 'Jobright',
            updatedAt: '2026-01-01T00:00:00.000Z',
            value: 'pw',
          }
        : null,
    )

    const resolver = createConnectorSecretResolver({ resolve })

    expect(Object.keys(resolver)).toEqual(['revealSecret'])
    await expect(resolver.revealSecret('jobright')).resolves.toEqual({
      key: 'jobright',
      value: 'pw',
    })
    await expect(resolver.revealSecret('missing')).resolves.toBeNull()
    expect(resolve).toHaveBeenCalledWith('jobright')
  })

  it('blocks normalized identity aliases before generic connector resolution', async () => {
    const resolve = vi.fn(async (key: string) =>
      normalizeProfileAnswerKey(key) === identitySsnLast4SecretKey
        ? {
            key: identitySsnLast4SecretKey,
            kind: 'identity' as const,
            label: 'SSN last four',
            updatedAt: '2026-01-01T00:00:00.000Z',
            value: '5125',
          }
        : null,
    )
    const resolver = createConnectorSecretResolver({ resolve })

    for (const key of [identitySsnLast4SecretKey, 'IDENTITY_SSN_LAST4', 'identity-ssn-last4']) {
      await expect(resolver.revealSecret(key)).resolves.toBeNull()
    }
    expect(resolve).not.toHaveBeenCalled()
  })
})
