import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveDatabaseFilePath } from '../../workspace/workspace.paths'
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
  it('activates recovery once for symlink and hard-link aliases of the same database', () => {
    const directory = createTempDirectory()
    const pgliteDataPath = createPgliteDataPath(directory, 'primary')
    const symlinkDir = path.join(directory, 'symlink-dir')
    const hardLinkDir = createPgliteDataPath(directory, 'hard-link-dir')
    const databaseFilePath = resolveDatabaseFilePath(pgliteDataPath)
    fs.writeFileSync(databaseFilePath, '')
    fs.symlinkSync(pgliteDataPath, symlinkDir, 'dir')
    fs.linkSync(databaseFilePath, resolveDatabaseFilePath(hardLinkDir))
    const recover = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(lifecycle.activate({ pgliteDataPath: symlinkDir, workspaceId: 'workspace-a' }, recover))
      .toBe(true)
    expect(lifecycle.activate({ pgliteDataPath, workspaceId: 'workspace-a' }, recover)).toBe(false)
    expect(lifecycle.activate({ pgliteDataPath: hardLinkDir, workspaceId: 'workspace-a' }, recover))
      .toBe(false)
    expect(recover).toHaveBeenCalledOnce()
  })

  it('keeps workspace identity explicit even when two scopes reference the same database', () => {
    const directory = createTempDirectory()
    const pgliteDataPath = createPgliteDataPath(directory, 'shared')
    fs.writeFileSync(resolveDatabaseFilePath(pgliteDataPath), '')
    const recoverA = vi.fn()
    const recoverB = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(lifecycle.activate({ pgliteDataPath, workspaceId: 'workspace-a' }, recoverA)).toBe(true)
    expect(lifecycle.activate({ pgliteDataPath, workspaceId: 'workspace-b' }, recoverB)).toBe(true)
    expect(recoverA).toHaveBeenCalledOnce()
    expect(recoverB).toHaveBeenCalledOnce()
  })

  it('activates recovery again when the database file is replaced at the same path', () => {
    const directory = createTempDirectory()
    const pgliteDataPath = createPgliteDataPath(directory, 'replaceable')
    const databaseFilePath = resolveDatabaseFilePath(pgliteDataPath)
    fs.writeFileSync(databaseFilePath, 'first')
    const recover = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(lifecycle.activate({ pgliteDataPath, workspaceId: 'workspace-a' }, recover)).toBe(true)
    fs.renameSync(databaseFilePath, path.join(pgliteDataPath, 'replaced.sqlite'))
    fs.writeFileSync(databaseFilePath, 'second')

    expect(lifecycle.activate({ pgliteDataPath, workspaceId: 'workspace-a' }, recover)).toBe(true)
    expect(recover).toHaveBeenCalledTimes(2)
  })

  it('canonicalizes an existing parent for a missing database and recognizes its later creation', () => {
    const realDirectory = createTempDirectory()
    const aliasDirectory = path.join(createTempDirectory(), 'workspace')
    fs.symlinkSync(realDirectory, aliasDirectory, 'dir')
    const realPgliteDataPath = createPgliteDataPath(realDirectory, 'pglite')
    const aliasPgliteDataPath = path.join(aliasDirectory, 'pglite')
    const recover = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(lifecycle.activate({
      pgliteDataPath: aliasPgliteDataPath,
      workspaceId: 'workspace-a',
    }, recover)).toBe(true)
    expect(lifecycle.activate({
      pgliteDataPath: realPgliteDataPath,
      workspaceId: 'workspace-a',
    }, recover)).toBe(false)

    fs.writeFileSync(resolveDatabaseFilePath(realPgliteDataPath), '')
    expect(lifecycle.activate({
      pgliteDataPath: realPgliteDataPath,
      workspaceId: 'workspace-a',
    }, recover)).toBe(true)
    expect(recover).toHaveBeenCalledTimes(2)
  })
})
