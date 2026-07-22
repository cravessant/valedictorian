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
      write: async (cycle: 1 | 2) => {
        events.push(`write:${cycle}`)
        persistedCaptures += 1
      },
      read: async (cycles: 1 | 2) => {
        events.push(`read:${cycles}`)
        return { found: persistedCaptures >= cycles, total: persistedCaptures, completeLifecycle: persistedCaptures >= cycles }
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
      persistedCaptures: 2,
      phase: 'verify',
    })

    expect(openOwner).toHaveBeenNthCalledWith(1, '/tmp/packaged-smoke/pglite')
    expect(openOwner).toHaveBeenNthCalledWith(2, '/tmp/packaged-smoke/pglite')
    expect(openOwner).toHaveBeenNthCalledWith(3, '/tmp/packaged-smoke/pglite')
    expect(events).toEqual(['write:1', 'close', 'read:1', 'write:2', 'close', 'read:2', 'close'])
  })

  it('closes the owner when persistence verification fails', async () => {
    const close = vi.fn(async () => undefined)
    const openOwner = vi.fn()
      .mockResolvedValueOnce({
        close,
        write: async (_cycle: 1 | 2) => undefined,
        read: async (_cycles: 1 | 2) => ({ found: false, total: 0, completeLifecycle: false }),
      })

    await expect(runPackagedPgliteSmoke({
      dataDirectory: '/tmp/packaged-smoke/pglite',
      phase: 'verify',
      openOwner,
    })).rejects.toThrow('did not persist')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
