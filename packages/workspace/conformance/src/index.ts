import { createHash } from 'node:crypto'
import {
  sortWorkspaceRoutes,
  workspaceRouteRegistry,
  type WorkspaceRoute,
} from '@sparxie/valedictorian-workspace-server'
import {
  createReleasedWorkspaceCompatibilitySnapshot,
} from '@sparxie/valedictorian-workspace-server/generator'
import {
  workspaceClientOperations,
  type WorkspaceOperation,
} from '@sparxie/valedictorian-workspace-client'

export type WorkspaceContractSnapshot = Readonly<{
  routeCount: number
  operationCount: number
  paths: readonly string[]
}>

export const releasedWorkspaceSdkBaseline = Object.freeze({
  contractDigest: '2ad7cf56a121577cfc581623d81f0aa58ce7e67bf7f635e33e5b1f2e538c3032',
  operationCount: 125,
  sourceCommit: 'aafd5ae1a4a92288032b880f6b7d299ada3e80a9',
  sdkVersion: '0.36.0',
})

function routeKey(route: Pick<WorkspaceRoute, 'method' | 'path'>): string {
  return `${route.method} ${route.path}`
}

function operationKey(operation: Pick<WorkspaceOperation, 'method' | 'path'>): string {
  return `${operation.method} ${operation.path}`
}

export function assertWorkspaceContract(): WorkspaceContractSnapshot {
  const routes = sortWorkspaceRoutes(workspaceRouteRegistry)
  const routeKeys = routes.map(routeKey)
  if (new Set(routeKeys).size !== routeKeys.length) {
    throw new Error('Workspace route registry contains duplicate method/path entries')
  }
  const operationIds = routes.map((route) => route.operationId)
  if (new Set(operationIds).size !== operationIds.length) {
    throw new Error('Workspace route registry contains duplicate operation ids')
  }
  const clientKeys = workspaceClientOperations.map(operationKey)
  if (new Set(clientKeys).size !== clientKeys.length) {
    throw new Error('Generated workspace client contains duplicate method/path entries')
  }
  if ([...routeKeys].sort().join('\n') !== [...clientKeys].sort().join('\n')) {
    throw new Error('Workspace route registry and generated client are not bijective')
  }
  return {
    routeCount: routes.length,
    operationCount: workspaceClientOperations.length,
    paths: [...new Set(routes.map((route) => route.path))],
  }
}

/** Fail closed when a released operation's path, method, status, or auth changes. */
export function assertReleasedWorkspaceCompatibility(): typeof releasedWorkspaceSdkBaseline {
  const contract = createReleasedWorkspaceCompatibilitySnapshot()
  const digest = createHash('sha256').update(JSON.stringify(contract)).digest('hex')
  if (
    workspaceRouteRegistry.length < releasedWorkspaceSdkBaseline.operationCount
    || digest !== releasedWorkspaceSdkBaseline.contractDigest
  ) {
    throw new Error(
      `Workspace API is incompatible with released SDK ${releasedWorkspaceSdkBaseline.sdkVersion}`,
    )
  }
  return releasedWorkspaceSdkBaseline
}
