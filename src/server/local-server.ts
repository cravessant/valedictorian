import http from 'node:http'
import {
  unavailableConnectorSchedulingCapability,
  type ConnectorSchedulingCapability,
} from '@sparxie/sdk'
import { resolveConnectorSchedulingCapability } from '../modules/connectors/public'
import { writeEmpty, writeNoStoreEmpty } from './local-server.http'
import { handleRequest, isLocalSecretResolvePath } from './local-server.routes'
import {
  defaultValedictorianHttpRequestErrorLogger,
  type ValedictorianHttpRequestErrorLogger,
} from './local-server.error-boundary'
import type { LocalWorkspaceManager } from './local-workspaces'
import type { LocalValedictorianClient, LocalWorkspaceClient } from '../runtime/local-connector-client.contract'

export type WorkspaceClientResolver = (
  workspaceId: string,
) => Promise<LocalValedictorianClient> | LocalValedictorianClient

export interface CreateValedictorianHttpServerOptions {
  client: LocalValedictorianClient
  host?: string
  localSecretResolutionEnabled?: boolean
  onRequestError?: ValedictorianHttpRequestErrorLogger
  port?: number
  resolveWorkspaceClient?: WorkspaceClientResolver
  token?: string
  workspaceManager?: LocalWorkspaceManager
}

export interface StartedValedictorianHttpServer {
  close: () => Promise<void>
  host: string
  onClosed: (listener: () => void) => () => void
  onError: (listener: () => void) => () => void
  port: number
  url: string
}

/** Read the authoritative scheduling capability from a local workspace client. */
export function readClientConnectorScheduling(
  client: LocalWorkspaceClient,
): ConnectorSchedulingCapability {
  if (
    client
    && typeof client === 'object'
    && 'connectorScheduling' in client
  ) {
    return resolveConnectorSchedulingCapability(
      (client as { connectorScheduling?: ConnectorSchedulingCapability }).connectorScheduling,
    )
  }

  return unavailableConnectorSchedulingCapability
}

export async function createValedictorianHttpServer({
  client,
  host = '127.0.0.1',
  localSecretResolutionEnabled = false,
  onRequestError = defaultValedictorianHttpRequestErrorLogger,
  port = 4317,
  resolveWorkspaceClient,
  token,
  workspaceManager,
}: CreateValedictorianHttpServerOptions): Promise<StartedValedictorianHttpServer> {
  const connectorScheduling = readClientConnectorScheduling(client)
  const errorListeners = new Set<() => void>()
  const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (isLocalSecretResolvePath(pathname)) {
        writeNoStoreEmpty(response, 204)
      } else {
        writeEmpty(response, 204)
      }
      return
    }

    void handleRequest({
      client,
      connectorScheduling,
      localSecretResolutionEnabled,
      onRequestError,
      request,
      resolveWorkspaceClient,
      response,
      token,
      workspaceManager,
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      server.on('error', () => errorListeners.forEach((listener) => listener()))
      resolve()
    })
  })

  const address = server.address()
  const resolvedPort = typeof address === 'object' && address ? address.port : port
  let closePromise: Promise<void> | null = null

  return {
    close() {
      if (closePromise) return closePromise
      closePromise = new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
      return closePromise
    },
    host,
    onClosed(listener) {
      server.on('close', listener)
      return () => server.off('close', listener)
    },
    onError(listener) {
      errorListeners.add(listener)
      return () => errorListeners.delete(listener)
    },
    port: resolvedPort,
    url: `http://${host}:${resolvedPort}`,
  }
}
