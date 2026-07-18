import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ValedictorianWorkspaceClient } from 'sparxie'
import { initializeWorkspace } from '../workspace/workspace.initializer'
import { createFileWorkspaceRegistryStore } from '../workspace/workspace.registry'
import { ProfileUpgradeRequiredError } from '../modules/profile/profile.upgrade-policy'
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
      const dispose = vi.fn(async () => undefined)
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

  it('closes a failed partial owner, records a sanitized error, evicts it, and retries', async () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-capability-retry-registry-'))
    const workspace = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-capability-retry-')),
      { createId: () => 'workspace-retry' },
    )
    cleanupPaths.push(registryRoot, workspace.rootPath)
    const registryStore = createFileWorkspaceRegistryStore(path.join(registryRoot, 'workspaces.json'))
    const firstDispose = vi.fn(async () => undefined)
    const secondDispose = vi.fn(async () => undefined)
    const prepareWorkspaceCapabilities = vi
      .fn()
      .mockResolvedValueOnce({
        dispose: firstDispose,
        profileService: {},
        secretService: {},
      })
      .mockResolvedValueOnce({
        dispose: secondDispose,
        profileService: {},
        secretService: {},
      })
    const createdClient = { workspaceId: workspace.id } as unknown as ValedictorianWorkspaceClient
    const createClient = vi
      .fn()
      .mockRejectedValueOnce(new Error(`/private/token-${workspace.id}`))
      .mockResolvedValueOnce(createdClient)
    const manager = createLocalWorkspaceManager({
      createClient: createClient as never,
      prepareWorkspaceCapabilities: prepareWorkspaceCapabilities as never,
      registryStore,
    })
    await manager.open({ path: workspace.rootPath })

    await expect(manager.resolveClient(workspace.id)).rejects.toThrow('token-workspace-retry')
    expect(firstDispose).toHaveBeenCalledTimes(1)
    await expect(registryStore.get()).resolves.toMatchObject({
      workspaces: {
        [workspace.id]: {
          latestError: {
            message: 'Workspace initialization failed. Retry opening this workspace.',
          },
        },
      },
    })

    await expect(manager.resolveClient(workspace.id)).resolves.toBe(createdClient)
    expect(prepareWorkspaceCapabilities).toHaveBeenCalledTimes(2)
    await expect(registryStore.get()).resolves.toMatchObject({
      workspaces: { [workspace.id]: { latestError: null } },
    })
    await Promise.all([manager.close(), manager.close()])
    expect(secondDispose).toHaveBeenCalledTimes(1)
  })

  it('records the safe staged-upgrade instruction without exposing a workspace path', async () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-upgrade-registry-'))
    const workspace = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-upgrade-required-')),
      { createId: () => 'workspace-upgrade-required' },
    )
    cleanupPaths.push(registryRoot, workspace.rootPath)
    const registryStore = createFileWorkspaceRegistryStore(path.join(registryRoot, 'workspaces.json'))
    const manager = createLocalWorkspaceManager({
      prepareWorkspaceCapabilities: vi.fn(async () => {
        throw new ProfileUpgradeRequiredError()
      }) as never,
      registryStore,
    })
    await manager.open({ path: workspace.rootPath })

    await expect(manager.resolveClient(workspace.id)).rejects.toBeInstanceOf(
      ProfileUpgradeRequiredError,
    )
    await expect(registryStore.get()).resolves.toMatchObject({
      workspaces: {
        [workspace.id]: {
          latestError: {
            message: expect.stringContaining(
              'Valedictorian 0.1.0-alpha.43 through 0.1.0-alpha.46',
            ),
          },
        },
      },
    })
    await manager.close()
  })

  it('awaits an in-flight first resolution before closing its owner', async () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-capability-close-registry-'))
    const workspace = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-capability-close-')),
      { createId: () => 'workspace-close' },
    )
    cleanupPaths.push(registryRoot, workspace.rootPath)
    const registryStore = createFileWorkspaceRegistryStore(path.join(registryRoot, 'workspaces.json'))
    let releaseClient!: () => void
    const clientGate = new Promise<void>((resolve) => { releaseClient = resolve })
    const dispose = vi.fn(async () => undefined)
    const manager = createLocalWorkspaceManager({
      createClient: vi.fn(async () => {
        await clientGate
        return { workspaceId: workspace.id } as unknown as ValedictorianWorkspaceClient
      }) as never,
      prepareWorkspaceCapabilities: vi.fn(async () => ({
        dispose,
        profileService: {},
        secretService: {},
      })) as never,
      registryStore,
    })
    await manager.open({ path: workspace.rootPath })
    const resolution = manager.resolveClient(workspace.id)
    const closing = manager.close()

    expect(dispose).not.toHaveBeenCalled()
    releaseClient()
    await expect(resolution).resolves.toMatchObject({ workspaceId: workspace.id })
    await closing
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('reuses one registration when a rekey request names the same physical workspace', async () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-alias-registry-'))
    const workspace = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-alias-real-')),
      { createId: () => 'workspace-alias' },
    )
    const aliasParent = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-alias-link-'))
    const aliasPath = path.join(aliasParent, 'workspace')
    fs.symlinkSync(workspace.rootPath, aliasPath, 'dir')
    cleanupPaths.push(registryRoot, workspace.rootPath, aliasParent)
    const registryStore = createFileWorkspaceRegistryStore(path.join(registryRoot, 'workspaces.json'))
    const createId = vi.fn(() => 'workspace-duplicate')
    const manager = createLocalWorkspaceManager({ createId, registryStore })

    await manager.open({ path: workspace.rootPath })
    const reopened = await manager.open({ path: aliasPath, rekey: true })

    expect(reopened).toMatchObject({ id: workspace.id, path: workspace.rootPath })
    await expect(manager.list()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: workspace.id, path: workspace.rootPath })],
    })
    expect(createId).not.toHaveBeenCalled()
    await manager.close()
  })

  it('rejects a mismatched manifest id on an already registered physical workspace', async () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-alias-conflict-registry-'))
    const workspace = initializeWorkspace(
      fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-alias-conflict-real-')),
      { createId: () => 'workspace-original' },
    )
    const aliasParent = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-alias-conflict-link-'))
    const aliasPath = path.join(aliasParent, 'workspace')
    fs.symlinkSync(workspace.rootPath, aliasPath, 'dir')
    cleanupPaths.push(registryRoot, workspace.rootPath, aliasParent)
    const registryStore = createFileWorkspaceRegistryStore(path.join(registryRoot, 'workspaces.json'))
    const createId = vi.fn(() => 'workspace-rekeyed')
    const manager = createLocalWorkspaceManager({ createId, registryStore })
    await manager.open({ path: workspace.rootPath })
    const manifest = JSON.parse(fs.readFileSync(workspace.manifestPath, 'utf8')) as Record<string, unknown>
    fs.writeFileSync(
      workspace.manifestPath,
      `${JSON.stringify({ ...manifest, id: 'workspace-intruder' }, null, 2)}\n`,
      'utf8',
    )

    await expect(manager.open({ path: aliasPath, rekey: true })).rejects.toThrow(
      'Workspace path is already registered as workspace-original.',
    )
    expect(createId).not.toHaveBeenCalled()
    await expect(manager.list()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'workspace-original', path: workspace.rootPath })],
    })
    await manager.close()
  })
})
