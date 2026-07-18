import fs from 'node:fs'
import path from 'node:path'

export interface ConnectorRunRecoveryScope {
  pgliteDataPath: string
  workspaceId: string
}

export interface ConnectorRunRecoveryLifecycle {
  activate(
    scope: ConnectorRunRecoveryScope,
    recover: () => Promise<void> | void,
  ): Promise<boolean>
  deactivate(scope: ConnectorRunRecoveryScope): void
}

export function createConnectorRunRecoveryLifecycle(): ConnectorRunRecoveryLifecycle {
  const activeScopes = new Set<string>()

  return {
    async activate(scope, recover) {
      const key = resolveRecoveryScopeKey(scope)

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
    deactivate(scope) {
      activeScopes.delete(resolveRecoveryScopeKey(scope))
    },
  }
}

function resolveRecoveryScopeKey(scope: ConnectorRunRecoveryScope) {
  return JSON.stringify([
    scope.workspaceId,
    ...resolvePhysicalPgliteIdentity(scope.pgliteDataPath),
  ])
}

function resolvePhysicalPgliteIdentity(pgliteDataPath: string): string[] {
  try {
    const stats = fs.statSync(pgliteDataPath, { bigint: true })

    return [
      'file',
      stats.dev.toString(),
      stats.ino.toString(),
      stats.birthtimeNs.toString(),
    ]
  } catch {
    const absolutePath = path.resolve(pgliteDataPath)
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
