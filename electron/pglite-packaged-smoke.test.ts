import { describe, expect, it, vi } from 'vitest'
import { runPackagedPgliteSmoke } from './pglite-packaged-smoke'

describe('packaged PGlite smoke', () => {
  it('writes in one invocation and verifies persistence in a later invocation', async () => {
    const events: string[] = []
    let persistedCaptures = 0
    const openOwner = vi.fn(async (dataDirectory: string) => ({
      close: async () => {
        events.push('close')
      },
      write: async () => {
        events.push('write')
        persistedCaptures += 1
      },
      read: async () => {
        events.push('read')
        return { found: persistedCaptures > 0, total: persistedCaptures }
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
      persistedCaptures: 1,
      phase: 'verify',
    })

    expect(openOwner).toHaveBeenNthCalledWith(1, '/tmp/packaged-smoke/pglite')
    expect(openOwner).toHaveBeenNthCalledWith(2, '/tmp/packaged-smoke/pglite')
    expect(events).toEqual(['write', 'close', 'read', 'close'])
  })

  it('closes the owner when persistence verification fails', async () => {
    const close = vi.fn(async () => undefined)
    const openOwner = vi.fn()
      .mockResolvedValueOnce({
        close,
        write: async () => undefined,
        read: async () => ({ found: false, total: 0 }),
      })

    await expect(runPackagedPgliteSmoke({
      dataDirectory: '/tmp/packaged-smoke/pglite',
      phase: 'verify',
      openOwner,
    })).rejects.toThrow('did not persist')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
