import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeWorkspace } from '../workspace/workspace.initializer'
import { createFileWorkspaceRegistryStore } from '../workspace/workspace.registry'
import { createLocalWorkspaceManager } from './local-workspaces'

describe('local workspace PGlite owner lifecycle', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    for (const cleanupPath of cleanupPaths.splice(0)) {
      fs.rmSync(cleanupPath, { force: true, recursive: true })
    }
  })

  it('coalesces first resolution, isolates workspaces, and persists across a closed owner', async () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-pglite-registry-'))
    const first = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-pglite-first-')),
      { createId: () => 'workspace-pglite-first' },
    )
    const second = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-pglite-second-')),
      { createId: () => 'workspace-pglite-second' },
    )
    cleanupPaths.push(registryRoot, first.rootPath, second.rootPath)
    const registryStore = createFileWorkspaceRegistryStore(path.join(registryRoot, 'workspaces.json'))
    const manager = createLocalWorkspaceManager({ registryStore })
    await manager.open({ path: first.rootPath })
    await manager.open({ path: second.rootPath })

    const [firstClient, concurrentFirstClient] = await Promise.all([
      manager.resolveClient(first.id),
      manager.resolveClient(first.id),
    ])
    expect(concurrentFirstClient).toBe(firstClient)
    await firstClient.applications.create({
      companyName: 'Persistent Company',
      roleTitle: 'Software Intern',
      sourceName: 'Manual',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      status: 'queued',
      primaryLink: {
        kind: 'official',
        label: 'Official posting',
        url: 'https://example.test/jobs/persistent',
      },
    })

    const secondClient = await manager.resolveClient(second.id)
    await expect(secondClient.applications.list()).resolves.toMatchObject({ total: 0 })
    await manager.close()

    const reopenedManager = createLocalWorkspaceManager({ registryStore })
    const reopenedFirstClient = await reopenedManager.resolveClient(first.id)
    await expect(reopenedFirstClient.applications.list()).resolves.toMatchObject({
      items: [expect.objectContaining({ companyName: 'Persistent Company' })],
      total: 1,
    })
    await reopenedManager.close()
  })
})
