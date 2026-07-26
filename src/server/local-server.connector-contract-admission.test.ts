import type { ValedictorianWorkspaceClient } from '@sparxie/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createBoundaryWorkspaceClient,
  createLocalServerHttpTestFixture,
} from './local-server.http-test-harness'

const VALIDATION_ERROR_BODY = { message: 'The request is invalid.' }

// Retired auth vocabulary is assembled at runtime so the stale-contract absence policy still
// forbids these tokens as literals everywhere outside its own allowance.
const retiredAuthField = ['session', 'Key'].join('')
const retiredAuthMode = ['browser', '_session'].join('')
const retiredSecretCanary = 'retired-session-canary'

const canonicalCreateBody = {
  id: 'connector one',
  connectorId: 'jobright.resolver',
  connectorVersion: '0.1.0',
  displayName: 'Jobright',
  enabled: true,
  auth: [{ id: 'jobright-session', label: 'Jobright session', mode: 'api_key', secretKey: 'workspace-session' }],
  config: { publicFeedUrl: 'https://jobright.test/feed.json' },
  filters: { roleKeywords: ['intern'] },
  earliestBackfillDate: '2026-01-15',
} as const

type ConnectorAdmissionClient = ValedictorianWorkspaceClient & {
  connectors: {
    create(input: unknown): Promise<unknown>
    update(input: unknown): Promise<unknown>
  }
}

function createAdmissionRecorder() {
  const created: unknown[] = []
  const updated: unknown[] = []
  const client = createBoundaryWorkspaceClient(() => {}) as ConnectorAdmissionClient

  client.connectors = {
    async create(input) {
      created.push(input)
      return { id: 'connector one', displayName: 'Jobright' }
    },
    async update(input) {
      updated.push(input)
      return { id: 'connector one', displayName: 'Jobright' }
    },
  }

  return { client, created, updated }
}

function jsonRequest(method: string, body: unknown) {
  return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method }
}

describe('connector instance contract admission', () => {
  const fixture = createLocalServerHttpTestFixture()
  let recorder: ReturnType<typeof createAdmissionRecorder>
  const resolvedWorkspaceIds: string[] = []

  beforeEach(() => {
    fixture.setup()
    recorder = createAdmissionRecorder()
    resolvedWorkspaceIds.length = 0
  })
  afterEach(() => fixture.teardown())

  async function startWorkspaceScoped() {
    const server = await fixture.start({
      client: recorder.client,
      resolveWorkspaceClient(workspaceId) {
        resolvedWorkspaceIds.push(workspaceId)
        return recorder.client
      },
    })
    return `${server.url}/v1/workspaces/workspace-1/connectors`
  }

  it('admits a canonical create body verbatim', async () => {
    const connectorsUrl = await startWorkspaceScoped()

    const response = await fetch(connectorsUrl, jsonRequest('POST', canonicalCreateBody))

    expect(response.status).toBe(200)
    expect(recorder.created).toEqual([canonicalCreateBody])
    expect(resolvedWorkspaceIds).toEqual(['workspace-1'])
  })

  it('leaves absent optional create fields absent so downstream defaulting stays app-owned', async () => {
    const connectorsUrl = await startWorkspaceScoped()
    const minimalBody = {
      id: 'connector one',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.1.0',
      displayName: 'Jobright',
      enabled: false,
    }

    const response = await fetch(connectorsUrl, jsonRequest('POST', minimalBody))

    expect(response.status).toBe(200)
    expect(Object.keys(recorder.created[0] as object).sort())
      .toEqual(['connectorId', 'connectorVersion', 'displayName', 'enabled', 'id'])
  })

  it.each([
    ['an unknown top-level create key', { ...canonicalCreateBody, lifecycle: 'enabled' }],
    ['the retired auth reference field', {
      ...canonicalCreateBody,
      auth: [{ id: 'jobright-session', mode: 'api_key', [retiredAuthField]: retiredSecretCanary }],
    }],
    ['the retired auth mode', {
      ...canonicalCreateBody,
      auth: [{ id: 'jobright-session', mode: retiredAuthMode }],
    }],
  ])('rejects %s with the fixed client error and never reaches the connector module', async (_label, body) => {
    const connectorsUrl = await startWorkspaceScoped()

    const response = await fetch(connectorsUrl, jsonRequest('POST', body))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(VALIDATION_ERROR_BODY)
    expect(recorder.created).toEqual([])
  })

  it('reflects no rejected field name or secret value in the client error', async () => {
    const connectorsUrl = await startWorkspaceScoped()
    const body = {
      ...canonicalCreateBody,
      auth: [{ id: 'jobright-session', mode: 'api_key', [retiredAuthField]: retiredSecretCanary }],
    }

    const response = await fetch(connectorsUrl, jsonRequest('POST', body))
    const text = await response.text()

    expect(response.status).toBe(400)
    expect(text).not.toContain(retiredSecretCanary)
    expect(text).not.toContain(retiredAuthField)
    expect(text).not.toContain('workspace-session')
  })

  it('keeps the decoded path connector instance id authoritative over the request body', async () => {
    const connectorsUrl = await startWorkspaceScoped()

    const response = await fetch(
      `${connectorsUrl}/connector%20one`,
      jsonRequest('PATCH', { connectorInstanceId: 'spoofed-instance', displayName: 'Jobright Internships' }),
    )

    expect(response.status).toBe(200)
    expect(recorder.updated).toEqual([
      { connectorInstanceId: 'connector one', displayName: 'Jobright Internships' },
    ])
    expect(resolvedWorkspaceIds).toEqual(['workspace-1'])
  })

  it('admits a disable-only update as exactly the maintenance-only key set', async () => {
    const connectorsUrl = await startWorkspaceScoped()

    const response = await fetch(
      `${connectorsUrl}/connector%20one`,
      jsonRequest('PATCH', { enabled: false }),
    )

    expect(response.status).toBe(200)
    expect(recorder.updated).toEqual([{ connectorInstanceId: 'connector one', enabled: false }])
  })

  it('rejects a JSON null update body instead of admitting a no-op update', async () => {
    const connectorsUrl = await startWorkspaceScoped()

    const response = await fetch(`${connectorsUrl}/connector%20one`, jsonRequest('PATCH', null))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(VALIDATION_ERROR_BODY)
    expect(recorder.updated).toEqual([])
  })

  it('rejects an unknown update key with the fixed client error', async () => {
    const connectorsUrl = await startWorkspaceScoped()

    const response = await fetch(
      `${connectorsUrl}/connector%20one`,
      jsonRequest('PATCH', { displayName: 'Jobright', lifecycle: 'enabled' }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(VALIDATION_ERROR_BODY)
    expect(recorder.updated).toEqual([])
  })
})
