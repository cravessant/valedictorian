import http from 'node:http'
import {
  unavailableConnectorSchedulingCapability,
  type ConnectorSchedulingCapability,
  type ValedictorianWorkspaceClient,
} from 'sparxie'
import { resolveConnectorSchedulingCapability } from '../modules/connectors/connector-schedule.capability'
import { writeEmpty } from './local-server.http'
import { handleRequest } from './local-server.routes'
import type { LocalWorkspaceManager } from './local-workspaces'

export type WorkspaceClientResolver = (
  workspaceId: string,
) => Promise<ValedictorianWorkspaceClient> | ValedictorianWorkspaceClient

export interface CreateValedictorianHttpServerOptions {
  client: ValedictorianWorkspaceClient
  host?: string
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
  client: ValedictorianWorkspaceClient,
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
  port = 4317,
  resolveWorkspaceClient,
  token,
  workspaceManager,
}: CreateValedictorianHttpServerOptions): Promise<StartedValedictorianHttpServer> {
  const connectorScheduling = readClientConnectorScheduling(client)
  const errorListeners = new Set<() => void>()
  const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      writeEmpty(response, 204)
      return
    }

    void handleRequest({
      client,
      connectorScheduling,
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

  return {
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
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
