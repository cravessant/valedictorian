import {
  createHttpValedictorianClient,
  type ValedictorianClient,
  type ValedictorianWorkspaceClient,
} from '@sparxie/sdk'

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

export function getRendererHttpRootClient(): ValedictorianClient | null {
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

export function getRendererHttpWorkspaceClient(): ValedictorianWorkspaceClient | null {
  const config = getRendererHttpConfig()
  const rootClient = getRendererHttpRootClient()

  if (!config || !rootClient) {
    return null
  }

  return rootClient.forWorkspace(config.workspaceId)
}

export function onRendererBackendStateChanged(
  listener: (state: { status: string }) => void,
): () => void {
  return getRendererHttpConfig()?.onBackendStateChanged?.(listener) ?? (() => {})
}

export function requireRendererHttpWorkspaceClient(): ValedictorianWorkspaceClient {
  const workspaceClient = getRendererHttpWorkspaceClient()

  if (!workspaceClient) {
    throw new Error('Workspace HTTP client is unavailable.')
  }

  return workspaceClient
}
