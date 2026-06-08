import { describe, expect, it } from 'vitest'
import { createWorkspacePreloadApi } from './workspace.preload'

describe('workspace preload API', () => {
  it('invokes workspace IPC channels', async () => {
    const invocations: unknown[][] = []
    const api = createWorkspacePreloadApi({
      invoke(...args) {
        invocations.push(args)
        return Promise.resolve(null)
      },
    })

    await api.getCurrent()
    await api.listRecent()
    await api.chooseFolder()
    await api.revealCurrent()

    expect(invocations).toEqual([
      ['workspace:get-current'],
      ['workspace:list-recent'],
      ['workspace:choose-folder'],
      ['workspace:reveal-current'],
    ])
  })
})
