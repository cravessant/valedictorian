import type { ValedictorianHttpTransportRequest, ValedictorianHttpTransportResponse } from './valedictorian-http.transport'
import {
  VALEDICTORIAN_HTTP_CANCEL_CHANNEL,
  VALEDICTORIAN_HTTP_REQUEST_CHANNEL,
} from './valedictorian-http.ipc'

interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on?(channel: string, listener: (_event: unknown, state: unknown) => void): void
}

export type RendererBackendState =
  | { status: 'starting' | 'unavailable' | 'stopped' }
  | { status: 'available'; origin: string }

export const VALEDICTORIAN_BACKEND_STATE_CHANGED_CHANNEL =
  'valedictorian-backend:state-changed'
export const VALEDICTORIAN_BACKEND_RETRY_CHANNEL = 'valedictorian-backend:retry'
export type RendererValedictorianHttpConfig = {
  apiBaseUrl: string
  getBackendState(): RendererBackendState
  onBackendStateChanged(listener: (state: RendererBackendState) => void): () => void
  retryBackend(): Promise<void>
  workspaceId: string
  request?: typeof fetch
}

export function createValedictorianHttpPreloadApi(
  ipcRenderer: IpcRendererLike,
  config: {
    apiBaseUrl: string
    backendStatus?: 'available' | 'unavailable'
    workspaceId: string
    usePrivilegedTransport: boolean
  },
): RendererValedictorianHttpConfig {
  let backendState: RendererBackendState = config.backendStatus === 'unavailable'
    ? { status: 'unavailable' }
    : { origin: config.apiBaseUrl, status: 'available' }
  const stateListeners = new Set<(state: RendererBackendState) => void>()
  const exposed: RendererValedictorianHttpConfig = {
    apiBaseUrl: config.apiBaseUrl,
    getBackendState: () => backendState,
    onBackendStateChanged(listener) {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
    retryBackend: () => ipcRenderer.invoke(VALEDICTORIAN_BACKEND_RETRY_CHANNEL) as Promise<void>,
    workspaceId: config.workspaceId,
  }

  ipcRenderer.on?.(VALEDICTORIAN_BACKEND_STATE_CHANGED_CHANNEL, (_event, value) => {
    const nextState = parseRendererBackendState(value)
    if (!nextState) {
      return
    }
    backendState = nextState
    if (nextState.status === 'available') {
      exposed.apiBaseUrl = nextState.origin
    }
    for (const listener of stateListeners) {
      listener(nextState)
    }
  })

  if (!config.usePrivilegedTransport) {
    return exposed
  }

  exposed.request = createPreloadValedictorianFetch(ipcRenderer)
  return exposed
}

function parseRendererBackendState(value: unknown): RendererBackendState | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const state = value as { origin?: unknown; status?: unknown }
  if (state.status === 'available' && typeof state.origin === 'string') {
    try {
      const origin = new URL(state.origin)
      if ((origin.protocol === 'http:' || origin.protocol === 'https:') && origin.origin === state.origin) {
        return { origin: state.origin, status: 'available' }
      }
    } catch {
      return null
    }
  }
  if (state.status === 'starting' || state.status === 'unavailable' || state.status === 'stopped') {
    return { status: state.status }
  }
  return null
}

function createPreloadValedictorianFetch(ipcRenderer: IpcRendererLike): typeof fetch {
  let nextRequestId = 0
  return (async (input, init) => {
    const request = new Request(input, init)
    if (request.signal.aborted) throw abortError()
    const requestId = `renderer-${Date.now().toString(36)}-${(++nextRequestId).toString(36)}`
    let dispatched = false
    const cancel = () => {
      if (!dispatched) return
      void ipcRenderer.invoke(VALEDICTORIAN_HTTP_CANCEL_CHANNEL, requestId).catch(() => undefined)
    }
    request.signal.addEventListener('abort', cancel, { once: true })
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })
    let response: ValedictorianHttpTransportResponse
    try {
      const payload: ValedictorianHttpTransportRequest = {
        body: request.method === 'GET' || request.method === 'HEAD'
          ? null
          : await request.text(),
        headers,
        method: request.method,
        url: request.url,
      }
      if (request.signal.aborted) throw abortError()
      dispatched = true
      response = await ipcRenderer.invoke(
        VALEDICTORIAN_HTTP_REQUEST_CHANNEL,
        { ...payload, requestId },
      ) as ValedictorianHttpTransportResponse
    } finally {
      request.signal.removeEventListener('abort', cancel)
    }

    return new Response(response.body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
  }) as typeof fetch
}

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}

export function readRendererHttpConfig(argv: string[]) {
  const apiBaseUrl = readArgumentValue(argv, '--valedictorian-api-url=')
  const backendStatus = readArgumentValue(argv, '--valedictorian-backend-status=')
  const workspaceId = readArgumentValue(argv, '--valedictorian-workspace-id=')
  const transportMode = readArgumentValue(argv, '--valedictorian-http-transport=')

  if (!workspaceId || (!apiBaseUrl && backendStatus !== 'unavailable')) {
    return null
  }

  return {
    apiBaseUrl: apiBaseUrl ?? '',
    ...(backendStatus === 'unavailable' ? { backendStatus: 'unavailable' as const } : {}),
    workspaceId,
    usePrivilegedTransport: transportMode === 'privileged',
  }
}

function readArgumentValue(argv: string[], prefix: string) {
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}
