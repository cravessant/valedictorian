import {
  createHttpValedictorianClient,
  type ValedictorianClientV2,
} from '@sparxie/sdk'
import type { LocalWorkspaceClientV2 } from '../runtime/local-connector-client.contract'

interface RendererHttpConfig {
  apiBaseUrl: string
  getBackendState?: () =>
    | { status: 'starting' | 'unavailable' | 'stopped' }
    | { status: 'available'; origin: string }
  onBackendStateChanged?: (listener: (state: { status: string }) => void) => () => void
  token?: string
  workspaceId: string
  request?: typeof fetch
}

function getRendererHttpConfig(): RendererHttpConfig | null {
  return (window as Window & { valedictorianHttp?: RendererHttpConfig }).valedictorianHttp ?? null
}

export function getRendererHttpRootClient(): ValedictorianClientV2 | null {
  const config = getRendererHttpConfig()

  if (!config) {
    return null
  }

  const backendState = config.getBackendState?.()
  if (backendState && backendState.status !== 'available') {
    return null
  }

  return createHttpValedictorianClient({
    baseUrl: backendState?.status === 'available'
      ? backendState.origin
      : config.apiBaseUrl,
    fetch: config.request ?? globalThis.fetch.bind(globalThis),
    token: config.token,
  })
}

export function rendererBackendUnavailable() {
  const state = getRendererHttpConfig()?.getBackendState?.()
  return Boolean(state && state.status !== 'available')
}

export function backendUnavailableError() {
  return new Error('Workspace backend unavailable.')
}

export function getRendererHttpWorkspaceClient(): LocalWorkspaceClientV2 | null {
  const config = getRendererHttpConfig()
  const rootClient = getRendererHttpRootClient()

  if (!config || !rootClient) {
    return null
  }

  return rootClient.forWorkspace(config.workspaceId)
}

const connectionIds = new WeakMap<object, number>()
let lastConnectionId = 0

/**
 * A renderer-lifetime identity for one workspace client instance.
 *
 * The counter is monotonic and module-owned, so an id survives any component
 * unmounting and is never reused: a query scope keyed by it cannot alias a
 * request issued against a replaced backend, even when the same workspace is
 * reopened later. A missing client keeps the reserved id `0`.
 */
export function workspaceConnectionId(client: object | null): number {
  if (!client) return 0
  const known = connectionIds.get(client)
  if (known !== undefined) return known
  lastConnectionId += 1
  connectionIds.set(client, lastConnectionId)
  return lastConnectionId
}

export function onRendererBackendStateChanged(
  listener: (state: { status: string }) => void,
): () => void {
  return getRendererHttpConfig()?.onBackendStateChanged?.(listener) ?? (() => {})
}

export function requireRendererHttpWorkspaceClient(): LocalWorkspaceClientV2 {
  const workspaceClient = getRendererHttpWorkspaceClient()

  if (!workspaceClient) {
    throw new Error('Workspace HTTP client is unavailable.')
  }

  return workspaceClient
}
