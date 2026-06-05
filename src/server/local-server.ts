import http from 'node:http'
import {
  defaultLocalCapabilities,
  isApplicationListSort,
  isApplicationStatus,
  type ApplicationListQuery,
  type JobAppClient,
  type WorkMode,
} from 'job-app-sdk'

export interface CreateJobAppHttpServerOptions {
  client: JobAppClient
  host?: string
  port?: number
  token?: string
}

export interface StartedJobAppHttpServer {
  close(): Promise<void>
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

async function handleRequest({
  client,
  request,
  response,
  token,
}: {
  client: JobAppClient
  request: http.IncomingMessage
  response: http.ServerResponse
  token?: string
}) {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (request.method === 'GET' && requestUrl.pathname === '/v1/health') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/capabilities') {
      writeJson(response, 200, defaultLocalCapabilities)
      return
    }

    if (token && request.headers.authorization !== `Bearer ${token}`) {
      writeJson(response, 401, { message: 'Unauthorized' })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/applications') {
      writeJson(response, 200, await client.applications.list(parseApplicationListQuery(requestUrl)))
      return
    }

    const statusMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/status$/)

    if (request.method === 'PATCH' && statusMatch) {
      const body = await readJsonBody(request)
      const status = readStringField(body, 'status')

      if (!isApplicationStatus(status)) {
        writeJson(response, 400, { message: `Invalid application status: ${status}` })
        return
      }

      writeJson(
        response,
        200,
        await client.applications.updateStatus({
          applicationId: decodeURIComponent(statusMatch[1]),
          status,
          notes: readOptionalStringField(body, 'notes'),
        }),
      )
      return
    }

    const applicationMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)$/)

    if (request.method === 'GET' && applicationMatch) {
      const applicationId = decodeURIComponent(applicationMatch[1])
      const application = await client.applications.get(applicationId)

      if (!application) {
        writeJson(response, 404, { message: `Application not found: ${applicationId}` })
        return
      }

      writeJson(response, 200, application)
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/scores') {
      await client.scores.record((await readJsonBody(request)) as Parameters<
        JobAppClient['scores']['record']
      >[0])
      writeJson(response, 200, { ok: true })
      return
    }

    writeJson(response, 404, { message: 'Not found' })
  } catch (error) {
    writeJson(response, 400, {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function parseApplicationListQuery(requestUrl: URL): ApplicationListQuery {
  const query: ApplicationListQuery = {}

  setStringQuery(requestUrl, 'priorityBand', (value) => {
    query.priorityBand = value
  })
  setStringQuery(requestUrl, 'company', (value) => {
    query.company = value
  })
  setStringQuery(requestUrl, 'role', (value) => {
    query.role = value
  })
  setStringQuery(requestUrl, 'source', (value) => {
    query.source = value
  })
  setStringQuery(requestUrl, 'search', (value) => {
    query.search = value
  })
  setStringQuery(requestUrl, 'createdFrom', (value) => {
    query.createdFrom = value
  })
  setStringQuery(requestUrl, 'createdTo', (value) => {
    query.createdTo = value
  })
  setStringQuery(requestUrl, 'updatedFrom', (value) => {
    query.updatedFrom = value
  })
  setStringQuery(requestUrl, 'updatedTo', (value) => {
    query.updatedTo = value
  })

  const status = requestUrl.searchParams.get('status')

  if (status) {
    if (!isApplicationStatus(status)) {
      throw new Error(`Invalid application status: ${status}`)
    }

    query.status = status
  }

  const workMode = requestUrl.searchParams.get('workMode')

  if (workMode) {
    query.workMode = workMode as WorkMode
  }

  const sort = requestUrl.searchParams.get('sort')

  if (sort) {
    if (!isApplicationListSort(sort)) {
      throw new Error(`Invalid application list sort: ${sort}`)
    }

    query.sort = sort
  }

  setNumberQuery(requestUrl, 'minScore', (value) => {
    query.minScore = value
  })
  setNumberQuery(requestUrl, 'maxScore', (value) => {
    query.maxScore = value
  })
  setNumberQuery(requestUrl, 'limit', (value) => {
    query.limit = value
  })
  setNumberQuery(requestUrl, 'offset', (value) => {
    query.offset = value
  })

  const hasApplied = requestUrl.searchParams.get('hasApplied')

  if (hasApplied !== null) {
    query.hasApplied = hasApplied === 'true'
  }

  return query
}

function setStringQuery(requestUrl: URL, key: string, setter: (value: string) => void) {
  const value = requestUrl.searchParams.get(key)

  if (value !== null) {
    setter(value)
  }
}

function setNumberQuery(requestUrl: URL, key: string, setter: (value: number) => void) {
  const value = requestUrl.searchParams.get(key)

  if (value !== null) {
    setter(Number(value))
  }
}

function readJsonBody(request: http.IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []

    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('error', reject)
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')

      if (!text) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(text) as unknown)
      } catch (error) {
        reject(error)
      }
    })
  })
}

function readStringField(body: unknown, field: string) {
  const record = readRecord(body)

  if (typeof record[field] === 'string') {
    return record[field]
  }

  throw new Error(`Missing ${field}`)
}

function readOptionalStringField(body: unknown, field: string) {
  const record = readRecord(body)

  if (typeof record[field] === 'string') {
    return record[field]
  }

  return undefined
}

function readRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}

function writeJson(response: http.ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
  })
  response.end(JSON.stringify(body))
}
