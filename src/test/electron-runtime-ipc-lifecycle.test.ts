import { describe, expect, it, vi } from 'vitest'
import { removeRuntimeIpcHandlers } from '../../electron/runtime-ipc'
import { registerConnectorsIpc } from '../ipc/connectors.ipc'
import type { LocalValedictorianClient } from '../runtime/local-valedictorian-client'

describe('Electron runtime IPC lifecycle', () => {
  it('replaces remaining connector handlers with the newly activated workspace runtime', async () => {
    const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()
    const ipcMain = {
      handle(channel: string, handler: (_event: unknown, input?: unknown) => Promise<unknown>) {
        if (handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`)
        handlers.set(channel, handler)
      },
      removeHandler(channel: string) {
        handlers.delete(channel)
      },
    }
    const firstList = vi.fn(async () => ({ items: [{ id: 'workspace-a' }] }))
    const secondList = vi.fn(async () => ({ items: [{ id: 'workspace-b' }] }))

    registerConnectorsIpc(connectorsWithList(firstList), ipcMain)
    removeRuntimeIpcHandlers(ipcMain)
    registerConnectorsIpc(connectorsWithList(secondList), ipcMain)

    await expect(handlers.get('connectors:list')?.({})).resolves.toEqual({
      items: [{ id: 'workspace-b' }],
    })
    expect(firstList).not.toHaveBeenCalled()
    expect(secondList).toHaveBeenCalledOnce()
  })
})

function connectorsWithList(
  list: () => Promise<{ items: Array<{ id: string }> }>,
): LocalValedictorianClient['connectors'] {
  return { list } as unknown as LocalValedictorianClient['connectors']
}
