import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceService } from '../workspace/workspace.service'
import { registerWorkspaceIpc } from './workspace.ipc'

const currentWorkspace = {
  id: 'workspace-1',
  name: 'Job Search',
  rootPath: '/Users/keni/Job Search',
  dataPath: '/Users/keni/Job Search/.job-automation',
  manifestPath: '/Users/keni/Job Search/.job-automation/manifest.json',
  appSettingsPath: '/Users/keni/Job Search/.job-automation/app.json',
  sqlitePath: '/Users/keni/Job Search/.job-automation/job-app.sqlite',
  automationsPath: '/Users/keni/Job Search/.job-automation/automations',
  promptsPath: '/Users/keni/Job Search/.job-automation/prompts',
  templatesPath: '/Users/keni/Job Search/.job-automation/templates',
  notesPath: '/Users/keni/Job Search/.job-automation/notes',
}

describe('workspace IPC registration', () => {
  it('registers workspace handlers', async () => {
    const service: WorkspaceService = {
      chooseFolder: vi.fn(async () => currentWorkspace),
      getCurrent: vi.fn(async () => currentWorkspace),
      listRecent: vi.fn(async () => []),
      revealCurrent: vi.fn(async () => undefined),
    }
    const handlers = new Map<string, (_event: unknown) => Promise<unknown>>()

    registerWorkspaceIpc(service, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    await expect(handlers.get('workspace:get-current')?.({})).resolves.toEqual(currentWorkspace)
    await expect(handlers.get('workspace:list-recent')?.({})).resolves.toEqual([])
    await expect(handlers.get('workspace:choose-folder')?.({})).resolves.toEqual(currentWorkspace)
    await expect(handlers.get('workspace:reveal-current')?.({})).resolves.toBeUndefined()

    expect(service.getCurrent).toHaveBeenCalled()
    expect(service.listRecent).toHaveBeenCalled()
    expect(service.chooseFolder).toHaveBeenCalled()
    expect(service.revealCurrent).toHaveBeenCalled()
  })
})
