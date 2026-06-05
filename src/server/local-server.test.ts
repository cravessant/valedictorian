import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalJobAppClient } from '../runtime/local-job-app-client'
import { createJobAppHttpServer, type StartedJobAppHttpServer } from './local-server'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'job-app-server-')), 'job-app.sqlite')
}

async function readJson(response: Response) {
  return (await response.json()) as unknown
}

describe('local Job App HTTP server', () => {
  let server: StartedJobAppHttpServer | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('serves health and local capabilities', async () => {
    server = await createJobAppHttpServer({
      client: createLocalJobAppClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    await expect(fetch(`${server.url}/v1/health`).then(readJson)).resolves.toEqual({ ok: true })
    await expect(fetch(`${server.url}/v1/capabilities`).then(readJson)).resolves.toMatchObject({
      localSqlite: true,
      hostedSync: false,
    })
  })

  it('lists and gets applications with auth, filters, and pagination', async () => {
    server = await createJobAppHttpServer({
      client: createLocalJobAppClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const listResponse = await fetch(
      `${server.url}/v1/applications?status=needs_user_info&minScore=6&source=linkedin&limit=25&offset=0`,
      { headers: { authorization: 'Bearer server-token' } },
    )
    const listPayload = (await readJson(listResponse)) as {
      items: Array<{ companyName: string; id: string; status: string }>
      total: number
    }

    expect(listResponse.status).toBe(200)
    expect(listPayload.total).toBe(1)
    expect(listPayload.items[0]).toMatchObject({
      companyName: 'Astranis Space Technologies',
      status: 'needs_user_info',
    })

    const getResponse = await fetch(`${server.url}/v1/applications/${listPayload.items[0].id}`, {
      headers: { authorization: 'Bearer server-token' },
    })

    await expect(readJson(getResponse)).resolves.toMatchObject({
      id: listPayload.items[0].id,
      companyName: 'Astranis Space Technologies',
    })
  })

  it('updates application status and records scores through the API', async () => {
    server = await createJobAppHttpServer({
      client: createLocalJobAppClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const statusResponse = await fetch(
      `${server.url}/v1/applications/application-versant-platform/status`,
      {
        body: JSON.stringify({ status: 'submitted', notes: 'Submitted from HTTP test.' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )

    await expect(readJson(statusResponse)).resolves.toMatchObject({
      id: 'application-versant-platform',
      notes: 'Submitted from HTTP test.',
      status: 'submitted',
    })

    const scoreResponse = await fetch(`${server.url}/v1/scores`, {
      body: JSON.stringify({
        applicationId: 'application-versant-platform',
        score: 8,
        band: 'high',
        roleRelevance: 3,
        careerSignal: 2,
        cityWorkMode: 2,
        compensationLogistics: 1,
        penalties: [],
        rationale: 'Strong fit.',
        rubricVersion: 'http-test',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    await expect(readJson(scoreResponse)).resolves.toEqual({ ok: true })

    const applicationResponse = await fetch(
      `${server.url}/v1/applications/application-versant-platform`,
    )

    await expect(readJson(applicationResponse)).resolves.toMatchObject({
      currentPriorityBand: 'high',
      currentPriorityScore: 8,
    })
  })

  it('returns useful HTTP statuses for unauthorized and missing resources', async () => {
    server = await createJobAppHttpServer({
      client: createLocalJobAppClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const unauthorized = await fetch(`${server.url}/v1/applications`)
    const missing = await fetch(`${server.url}/v1/applications/missing`, {
      headers: { authorization: 'Bearer server-token' },
    })

    expect(unauthorized.status).toBe(401)
    await expect(readJson(unauthorized)).resolves.toEqual({ message: 'Unauthorized' })
    expect(missing.status).toBe(404)
    await expect(readJson(missing)).resolves.toEqual({ message: 'Application not found: missing' })
  })
})
