import { describe, expect, it, vi } from 'vitest'
import { runPackagedPgliteSmoke } from './pglite-packaged-smoke'

describe('packaged PGlite smoke', () => {
  it('writes in one invocation and verifies persistence in a later invocation', async () => {
    const events: string[] = []
    const persisted: Array<{ companyName: string }> = []
    const openOwner = vi.fn(async (dataDirectory: string) => ({
      close: async () => {
        events.push('close')
      },
      repository: {
        createApplication: async (input: { companyName: string }) => {
          events.push('create')
          persisted.push(input)
          return { id: 'packaged-smoke-application' }
        },
        listApplications: async () => {
          events.push('list')
          return { items: persisted, total: persisted.length }
        },
      },
      dataDirectory,
    }))

    await expect(runPackagedPgliteSmoke({
      dataDirectory: '/tmp/packaged-smoke/pglite',
      phase: 'write',
      openOwner,
    })).resolves.toEqual({
      phase: 'write',
    })
    await expect(runPackagedPgliteSmoke({
      dataDirectory: '/tmp/packaged-smoke/pglite',
      phase: 'verify',
      openOwner,
    })).resolves.toEqual({
      companyName: 'Packaged PGlite Smoke',
      persistedApplications: 1,
      phase: 'verify',
    })

    expect(openOwner).toHaveBeenNthCalledWith(1, '/tmp/packaged-smoke/pglite')
    expect(openOwner).toHaveBeenNthCalledWith(2, '/tmp/packaged-smoke/pglite')
    expect(persisted[0]).toMatchObject({
      primaryLink: {
        kind: 'official',
        url: 'https://example.test/packaged-pglite-smoke',
      },
    })
    expect(events).toEqual(['create', 'close', 'list', 'close'])
  })

  it('closes the owner when persistence verification fails', async () => {
    const close = vi.fn(async () => undefined)
    const openOwner = vi.fn()
      .mockResolvedValueOnce({
        close,
        repository: {
          createApplication: async () => ({ id: 'packaged-smoke-application' }),
          listApplications: async () => ({ items: [], total: 0 }),
        },
      })

    await expect(runPackagedPgliteSmoke({
      dataDirectory: '/tmp/packaged-smoke/pglite',
      phase: 'verify',
      openOwner,
    })).rejects.toThrow('did not persist')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
