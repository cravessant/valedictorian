import type { WorkspaceRoute } from './contract.js'

export class WorkspaceRouterContractError extends Error {
  readonly kind: 'declared-without-handler' | 'handler-without-registry'

  constructor(kind: WorkspaceRouterContractError['kind'], detail: string) {
    super(`Workspace router contract violation (${kind}): ${detail}`)
    this.name = 'WorkspaceRouterContractError'
    this.kind = kind
  }
}

/**
 * Shared negative oracle used by the live router and conformance fixtures.
 * A live router must gate dispatch before handlers, then invoke this oracle if
 * a declared operation falls through every real handler.
 */
export function assertWorkspaceRouterCoverage(
  declaredRoute: WorkspaceRoute | undefined,
  handlerRan: boolean,
): void {
  if (!declaredRoute && handlerRan) {
    throw new WorkspaceRouterContractError(
      'handler-without-registry',
      'an undeclared method/path pair reached a handler',
    )
  }
  if (declaredRoute && !handlerRan) {
    throw new WorkspaceRouterContractError(
      'declared-without-handler',
      declaredRoute.operationId,
    )
  }
}

export function workspaceRouteKey(
  route: Pick<WorkspaceRoute, 'method' | 'path'>,
): string {
  return `${route.method} ${route.path}`
}

/**
 * Compares the producer registry with route keys observed by exercising the
 * real router. The caller owns observation so the proof cannot manufacture its
 * handler set from the registry under test.
 */
export function assertWorkspaceRouterBijection(
  declaredRoutes: readonly WorkspaceRoute[],
  observedHandlerKeys: ReadonlySet<string>,
): void {
  const declaredKeys = new Set(declaredRoutes.map(workspaceRouteKey))
  for (const route of declaredRoutes) {
    if (!observedHandlerKeys.has(workspaceRouteKey(route))) {
      throw new WorkspaceRouterContractError('declared-without-handler', route.operationId)
    }
  }
  for (const key of observedHandlerKeys) {
    if (!declaredKeys.has(key)) {
      throw new WorkspaceRouterContractError('handler-without-registry', key)
    }
  }
}
