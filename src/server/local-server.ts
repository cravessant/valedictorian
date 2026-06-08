import http from 'node:http'
import type { JobAppClient } from 'sparxie'
import { handleRequest } from './local-server.routes'

export interface CreateJobAppHttpServerOptions {
  client: JobAppClient
  host?: string
  port?: number
  token?: string
}

export interface StartedJobAppHttpServer {
  close: () => Promise<void>
  host: string
  port: number
  url: string
}

export async function createJobAppHttpServer({
  client,
  host = '127.0.0.1',
  port = 4317,
  token,
}: CreateJobAppHttpServerOptions): Promise<StartedJobAppHttpServer> {
  const server = http.createServer((request, response) => {
    void handleRequest({ client, request, response, token })
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
