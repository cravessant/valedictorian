import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ValedictorianWorkspaceClient } from 'sparxie'
import { initializeWorkspace } from '../workspace/workspace.initializer'
import { createFileWorkspaceRegistryStore } from '../workspace/workspace.registry'
import { createLocalWorkspaceManager } from './local-workspaces'

describe('local workspace profile capability lifecycle', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    for (const cleanupPath of cleanupPaths.splice(0)) {
      fs.rmSync(cleanupPath, { force: true, recursive: true })
    }
  })

  it('isolates prepared capabilities by workspace, reuses each client, and disposes all caches', async () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-capability-registry-'))
    const first = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-capability-first-')),
      { createId: () => 'workspace-first' },
    )
    const second = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-capability-second-')),
      { createId: () => 'workspace-second' },
    )
    cleanupPaths.push(registryRoot, first.rootPath, second.rootPath)
    const registryStore = createFileWorkspaceRegistryStore(path.join(registryRoot, 'workspaces.json'))
    const disposals = new Map<string, ReturnType<typeof vi.fn>>()
    const prepareWorkspaceCapabilities = vi.fn(async (options: { workspaceId: string }) => {
      const dispose = vi.fn()
      disposals.set(options.workspaceId, dispose)
      return {
        dispose,
        profileService: { workspaceId: options.workspaceId },
        secretService: { workspaceId: options.workspaceId },
      }
    })
    const createClient = vi.fn((options: Record<string, unknown>) => ({
      workspaceId: options.workspaceId,
      profileService: options.profileService,
      secretService: options.secretService,
    }) as unknown as ValedictorianWorkspaceClient)
    const manager = createLocalWorkspaceManager({
      createClient: createClient as never,
      prepareWorkspaceCapabilities: prepareWorkspaceCapabilities as never,
      registryStore,
    })
    await manager.open({ path: first.rootPath })
    await manager.open({ path: second.rootPath })

    const [firstClient, concurrentFirstClient] = await Promise.all([
      manager.resolveClient(first.id),
      manager.resolveClient(first.id),
    ])
    const secondClient = await manager.resolveClient(second.id)
    expect(concurrentFirstClient).toBe(firstClient)
    expect(await manager.resolveClient(first.id)).toBe(firstClient)
    expect(secondClient).not.toBe(firstClient)
    expect(prepareWorkspaceCapabilities).toHaveBeenCalledTimes(2)
    expect(createClient).toHaveBeenCalledTimes(2)

    await manager.close()
    expect(disposals.get(first.id)).toHaveBeenCalledTimes(1)
    expect(disposals.get(second.id)).toHaveBeenCalledTimes(1)
  })
})
