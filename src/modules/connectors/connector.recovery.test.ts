import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createConnectorRunRecoveryLifecycle } from './connector.recovery'

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-connector-recovery-'))
}

describe('connector run recovery lifecycle', () => {
  it('activates recovery once for symlink and hard-link aliases of the same database', () => {
    const directory = createTempDirectory()
    const sqlitePath = path.join(directory, 'valedictorian.sqlite')
    const symlinkPath = path.join(directory, 'symlink.sqlite')
    const hardLinkPath = path.join(directory, 'hard-link.sqlite')
    fs.writeFileSync(sqlitePath, '')
    fs.symlinkSync(sqlitePath, symlinkPath, 'file')
    fs.linkSync(sqlitePath, hardLinkPath)
    const recover = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(lifecycle.activate({ sqlitePath: symlinkPath, workspaceId: 'workspace-a' }, recover))
      .toBe(true)
    expect(lifecycle.activate({ sqlitePath, workspaceId: 'workspace-a' }, recover)).toBe(false)
    expect(lifecycle.activate({ sqlitePath: hardLinkPath, workspaceId: 'workspace-a' }, recover))
      .toBe(false)
    expect(recover).toHaveBeenCalledOnce()
  })

  it('keeps workspace identity explicit even when two scopes reference the same database', () => {
    const directory = createTempDirectory()
    const sqlitePath = path.join(directory, 'valedictorian.sqlite')
    fs.writeFileSync(sqlitePath, '')
    const recoverA = vi.fn()
    const recoverB = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(lifecycle.activate({ sqlitePath, workspaceId: 'workspace-a' }, recoverA)).toBe(true)
    expect(lifecycle.activate({ sqlitePath, workspaceId: 'workspace-b' }, recoverB)).toBe(true)
    expect(recoverA).toHaveBeenCalledOnce()
    expect(recoverB).toHaveBeenCalledOnce()
  })

  it('activates recovery again when the database file is replaced at the same path', () => {
    const directory = createTempDirectory()
    const sqlitePath = path.join(directory, 'valedictorian.sqlite')
    fs.writeFileSync(sqlitePath, 'first')
    const recover = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(lifecycle.activate({ sqlitePath, workspaceId: 'workspace-a' }, recover)).toBe(true)
    fs.renameSync(sqlitePath, path.join(directory, 'replaced.sqlite'))
    fs.writeFileSync(sqlitePath, 'second')

    expect(lifecycle.activate({ sqlitePath, workspaceId: 'workspace-a' }, recover)).toBe(true)
    expect(recover).toHaveBeenCalledTimes(2)
  })

  it('canonicalizes an existing parent for a missing database and recognizes its later creation', () => {
    const realDirectory = createTempDirectory()
    const aliasDirectory = path.join(createTempDirectory(), 'workspace')
    fs.symlinkSync(realDirectory, aliasDirectory, 'dir')
    const realSqlitePath = path.join(realDirectory, 'valedictorian.sqlite')
    const aliasSqlitePath = path.join(aliasDirectory, 'valedictorian.sqlite')
    const recover = vi.fn()
    const lifecycle = createConnectorRunRecoveryLifecycle()

    expect(lifecycle.activate({
      sqlitePath: aliasSqlitePath,
      workspaceId: 'workspace-a',
    }, recover)).toBe(true)
    expect(lifecycle.activate({
      sqlitePath: realSqlitePath,
      workspaceId: 'workspace-a',
    }, recover)).toBe(false)

    fs.writeFileSync(realSqlitePath, '')
    expect(lifecycle.activate({
      sqlitePath: realSqlitePath,
      workspaceId: 'workspace-a',
    }, recover)).toBe(true)
    expect(recover).toHaveBeenCalledTimes(2)
  })
})
