import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createConnectorRunRecoveryLifecycle } from './connector.recovery'

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-connector-recovery-'))
}

function createPgliteDataPath(parent: string, name: string) {
  const pgliteDataPath = path.join(parent, name)
  fs.mkdirSync(pgliteDataPath, { recursive: true })
  return pgliteDataPath
}

describe('connector run recovery lifecycle', () => {
  it('activates recovery once for symlink aliases of the same PGlite directory', async () => {
    const directory = createTempDirectory()
    const pgliteDataPath = createPgliteDataPath(directory, 'primary')
    const symlinkDir = path.join(directory, 'symlink-dir')
    fs.symlinkSync(pgliteDataPath, symlinkDir, 'dir')
    const recover = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(await lifecycle.activate({ pgliteDataPath: symlinkDir, workspaceId: 'workspace-a' }, recover))
      .toBe(true)
    expect(await lifecycle.activate({ pgliteDataPath, workspaceId: 'workspace-a' }, recover)).toBe(false)
    expect(recover).toHaveBeenCalledOnce()
  })

  it('keeps workspace identity explicit even when two scopes reference the same database', async () => {
    const directory = createTempDirectory()
    const pgliteDataPath = createPgliteDataPath(directory, 'shared')
    const recoverA = vi.fn()
    const recoverB = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(await lifecycle.activate({ pgliteDataPath, workspaceId: 'workspace-a' }, recoverA)).toBe(true)
    expect(await lifecycle.activate({ pgliteDataPath, workspaceId: 'workspace-b' }, recoverB)).toBe(true)
    expect(recoverA).toHaveBeenCalledOnce()
    expect(recoverB).toHaveBeenCalledOnce()
  })

  it('activates recovery again when the PGlite directory is replaced at the same path', async () => {
    const directory = createTempDirectory()
    const pgliteDataPath = createPgliteDataPath(directory, 'replaceable')
    const recover = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(await lifecycle.activate({ pgliteDataPath, workspaceId: 'workspace-a' }, recover)).toBe(true)
    fs.renameSync(pgliteDataPath, path.join(directory, 'replaced-pglite'))
    fs.mkdirSync(pgliteDataPath)

    expect(await lifecycle.activate({ pgliteDataPath, workspaceId: 'workspace-a' }, recover)).toBe(true)
    expect(recover).toHaveBeenCalledTimes(2)
  })

  it('canonicalizes a symlink alias and recognizes a replacement directory', async () => {
    const realDirectory = createTempDirectory()
    const aliasDirectory = path.join(createTempDirectory(), 'workspace')
    fs.symlinkSync(realDirectory, aliasDirectory, 'dir')
    const realPgliteDataPath = createPgliteDataPath(realDirectory, 'pglite')
    const aliasPgliteDataPath = path.join(aliasDirectory, 'pglite')
    const recover = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(await lifecycle.activate({
      pgliteDataPath: aliasPgliteDataPath,
      workspaceId: 'workspace-a',
    }, recover)).toBe(true)
    expect(await lifecycle.activate({
      pgliteDataPath: realPgliteDataPath,
      workspaceId: 'workspace-a',
    }, recover)).toBe(false)

    fs.renameSync(realPgliteDataPath, path.join(realDirectory, 'old-pglite'))
    fs.mkdirSync(realPgliteDataPath)
    expect(await lifecycle.activate({
      pgliteDataPath: realPgliteDataPath,
      workspaceId: 'workspace-a',
    }, recover)).toBe(true)
    expect(recover).toHaveBeenCalledTimes(2)
  })

  it('releases a closed owner so reopening performs recovery again', async () => {
    const pgliteDataPath = createPgliteDataPath(createTempDirectory(), 'reopen')
    const scope = { pgliteDataPath, workspaceId: 'workspace-reopen' }
    const recover = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    await expect(lifecycle.activate(scope, recover)).resolves.toBe(true)
    await expect(lifecycle.activate(scope, recover)).resolves.toBe(false)
    lifecycle.deactivate(scope)
    await expect(lifecycle.activate(scope, recover)).resolves.toBe(true)
    expect(recover).toHaveBeenCalledTimes(2)
  })
})
