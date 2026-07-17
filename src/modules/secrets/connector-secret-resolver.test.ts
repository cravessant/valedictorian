import { describe, expect, it, vi } from 'vitest'
import { createConnectorSecretResolver } from './connector-secret-resolver'

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
})
