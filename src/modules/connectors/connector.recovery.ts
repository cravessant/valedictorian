import fs from 'node:fs'
import path from 'node:path'
import { resolveDatabaseFilePath } from '../../workspace/workspace.paths'

export interface ConnectorRunRecoveryScope {
  pgliteDataPath: string
  workspaceId: string
}

export interface ConnectorRunRecoveryLifecycle {
  activate(
    scope: ConnectorRunRecoveryScope,
    recover: () => Promise<void> | void,
  ): Promise<boolean>
}

export function createConnectorRunRecoveryLifecycle(): ConnectorRunRecoveryLifecycle {
  const activeScopes = new Set<string>()

  return {
    async activate(scope, recover) {
      const key = JSON.stringify([
        scope.workspaceId,
        ...resolvePhysicalDatabaseIdentity(resolveDatabaseFilePath(scope.pgliteDataPath)),
      ])

      if (activeScopes.has(key)) {
        return false
      }

      activeScopes.add(key)
      try {
        await recover()
        return true
      } catch (error) {
        activeScopes.delete(key)
        throw error
      }
    },
  }
}

function resolvePhysicalDatabaseIdentity(databasePath: string): string[] {
  try {
    const stats = fs.statSync(databasePath, { bigint: true })

    return [
      'file',
      stats.dev.toString(),
      stats.ino.toString(),
      stats.birthtimeNs.toString(),
    ]
  } catch {
    const absolutePath = path.resolve(databasePath)
    const parentPath = path.dirname(absolutePath)
    let physicalParentPath = parentPath

    try {
      physicalParentPath = fs.realpathSync.native(parentPath)
    } catch {
      // The database owner creates the file before activation. Retain a stable
      // absolute identity for direct lifecycle use with a missing parent.
    }

    return ['path', path.join(physicalParentPath, path.basename(absolutePath))]
  }
}
