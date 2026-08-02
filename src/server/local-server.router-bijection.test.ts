import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertWorkspaceRouterBijection,
  workspaceRouteKey,
  WorkspaceRouterContractError,
  workspaceRouteRegistry,
} from '@sparxie/valedictorian-workspace-server'
import {
  createBoundaryWorkspaceClient,
  createLocalServerHttpTestFixture,
} from './local-server.http-test-harness'

const rootOperations = new Set([
  'health.get',
  'capabilities.get',
  'workspaces.list',
  'workspaces.open',
  'workspaces.create',
])

describe.sequential('live workspace router bijection', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  it('observes one real handler for every declared route and catches both drift directions', async () => {
    const routerErrors: WorkspaceRouterContractError[] = []
    const client = createBoundaryWorkspaceClient(() => {})
    const server = await fixture.start({
      client,
      onRequestError: ({ error }) => {
        if (error instanceof WorkspaceRouterContractError) routerErrors.push(error)
      },
      resolveWorkspaceClient: () => client,
    })
    const observedHandlers = new Set<string>()

    for (const route of workspaceRouteRegistry) {
      const before = routerErrors.length
      const canonicalPath = route.path.replace(/\{[^}]+\}/g, 'fixture')
      const pathname = rootOperations.has(route.operationId)
        ? canonicalPath
        : canonicalPath.replace(/^\/v([12])/, '/v$1/workspaces/workspace-1')
      const response = await fetch(`${server.url}${pathname}`, {
        ...(route.requestBody ? { body: '{}' } : {}),
        headers: route.requestBody ? { 'content-type': 'application/json' } : {},
        method: route.method,
      })
      await response.arrayBuffer()
      if (routerErrors.length === before) observedHandlers.add(workspaceRouteKey(route))
    }

    expect(routerErrors).toEqual([])
    expect(observedHandlers.size).toBe(workspaceRouteRegistry.length)
    expect(() => assertWorkspaceRouterBijection(
      workspaceRouteRegistry,
      observedHandlers,
    )).not.toThrow()

    const handlerRemoved = new Set(observedHandlers)
    handlerRemoved.delete(workspaceRouteKey(workspaceRouteRegistry[0]!))
    expect(() => assertWorkspaceRouterBijection(workspaceRouteRegistry, handlerRemoved))
      .toThrow(/declared-without-handler/i)

    expect(() => assertWorkspaceRouterBijection(
      workspaceRouteRegistry.slice(1),
      observedHandlers,
    )).toThrow(/handler-without-registry/i)
  })
})
