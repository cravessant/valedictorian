import { describe, expect, it, vi } from 'vitest'
import { removeRuntimeIpcHandlers, runtimeIpcChannels } from '../../electron/runtime-ipc'
import { registerConnectorsIpc } from '../ipc/connectors.ipc'
import { registerValedictorianHttpIpc } from '../ipc/valedictorian-http.ipc'
import type { LocalValedictorianClient } from '../runtime/local-valedictorian-client'

describe('Electron runtime IPC lifecycle', () => {
  it('contains no retired application, action-queue, or sourcing aliases', () => {
    expect(runtimeIpcChannels).not.toEqual(expect.arrayContaining([
      'action-queue:list',
      'applications:list',
      'sourcing:findings:list',
    ]))
    expect(runtimeIpcChannels).toContain('policy:evaluate:opportunity')
  })

  it('replaces remaining connector handlers with the newly activated workspace runtime', async () => {
    const { handlers, ipcMain } = createIpcMain()
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

  it('replaces both privileged HTTP transport handlers for the next workspace', () => {
    const { handlers, ipcMain } = createIpcMain()
    const transport = { request: vi.fn(async () => ({ body: '', headers: {}, status: 200 })) }

    registerValedictorianHttpIpc(transport, ipcMain)
    expect([...handlers.keys()].sort()).toEqual([
      'valedictorian-http:cancel',
      'valedictorian-http:request',
    ])

    removeRuntimeIpcHandlers(ipcMain)
    expect(handlers.size).toBe(0)
    expect(() => registerValedictorianHttpIpc(transport, ipcMain)).not.toThrow()
  })
})

function createIpcMain() {
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

  return { handlers, ipcMain }
}

function connectorsWithList(
  list: () => Promise<{ items: Array<{ id: string }> }>,
): LocalValedictorianClient['connectors'] {
  return { list } as unknown as LocalValedictorianClient['connectors']
}
