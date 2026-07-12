import type { ValedictorianHttpTransportRequest, ValedictorianHttpTransportResponse } from './valedictorian-http.transport'
import { VALEDICTORIAN_HTTP_REQUEST_CHANNEL } from './valedictorian-http.ipc'

interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

export type RendererValedictorianHttpConfig = {
  apiBaseUrl: string
  workspaceId: string
  request?: typeof fetch
}

export function createValedictorianHttpPreloadApi(
  ipcRenderer: IpcRendererLike,
  config: { apiBaseUrl: string; workspaceId: string; usePrivilegedTransport: boolean },
): RendererValedictorianHttpConfig {
  const exposed: RendererValedictorianHttpConfig = {
    apiBaseUrl: config.apiBaseUrl,
    workspaceId: config.workspaceId,
  }

  if (!config.usePrivilegedTransport) {
    return exposed
  }

  exposed.request = createPreloadValedictorianFetch(ipcRenderer)
  return exposed
}

function createPreloadValedictorianFetch(ipcRenderer: IpcRendererLike): typeof fetch {
  return (async (input, init) => {
    const request = new Request(input, init)
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })

    const payload: ValedictorianHttpTransportRequest = {
      body: request.method === 'GET' || request.method === 'HEAD'
        ? null
        : await request.text(),
      headers,
      method: request.method,
      url: request.url,
    }

    const response = await ipcRenderer.invoke(
      VALEDICTORIAN_HTTP_REQUEST_CHANNEL,
      payload,
    ) as ValedictorianHttpTransportResponse

    return new Response(response.body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
  }) as typeof fetch
}

export function readRendererHttpConfig(argv: string[]) {
  const apiBaseUrl = readArgumentValue(argv, '--valedictorian-api-url=')
  const workspaceId = readArgumentValue(argv, '--valedictorian-workspace-id=')
  const transportMode = readArgumentValue(argv, '--valedictorian-http-transport=')

  if (!apiBaseUrl || !workspaceId) {
    return null
  }

  return {
    apiBaseUrl,
    workspaceId,
    usePrivilegedTransport: transportMode === 'privileged',
  }
}

function readArgumentValue(argv: string[], prefix: string) {
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}
