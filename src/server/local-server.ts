import http from 'node:http'
import type { ValedictorianWorkspaceClient } from 'sparxie'
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
  port: number
  url: string
}

export async function createValedictorianHttpServer({
  client,
  host = '127.0.0.1',
  port = 4317,
  resolveWorkspaceClient,
  token,
  workspaceManager,
}: CreateValedictorianHttpServerOptions): Promise<StartedValedictorianHttpServer> {
  const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      writeEmpty(response, 204)
      return
    }

    void handleRequest({ client, request, resolveWorkspaceClient, response, token, workspaceManager })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
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
    port: resolvedPort,
    url: `http://${host}:${resolvedPort}`,
  }
}
