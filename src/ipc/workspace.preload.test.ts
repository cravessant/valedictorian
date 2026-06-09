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
    await api.getLaunchState()
    await api.listRecent()
    await api.chooseFolder()
    await api.openFolder()
    await api.openRecent('workspace-1')
    await api.createWorkspace({ name: 'Summer Search', parentPath: '/Users/keni' })
    await api.removeRecent('workspace-1')
    await api.reveal('/Users/keni/Job Search')
    await api.revealCurrent()

    expect(invocations).toEqual([
      ['workspace:get-current'],
      ['workspace:get-launch-state'],
      ['workspace:list-recent'],
      ['workspace:choose-folder'],
      ['workspace:open-folder'],
      ['workspace:open-recent', 'workspace-1'],
      ['workspace:create-workspace', { name: 'Summer Search', parentPath: '/Users/keni' }],
      ['workspace:remove-recent', 'workspace-1'],
      ['workspace:reveal', '/Users/keni/Job Search'],
      ['workspace:reveal-current'],
    ])
  })
})
