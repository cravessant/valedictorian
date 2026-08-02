import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WorkspaceAuthorityAdmissionController,
  WorkspaceProtocolError,
} from '@sparxie/valedictorian-workspace-server'
import { createLocalServerHttpTestFixture } from '../server/local-server.http-test-harness'
import { createTestLocalValedictorianClient } from './local-valedictorian-client.test-harness'
import type { LocalScheduledWorkSource } from '../modules/scheduling/public'

const workspaceId = 'authority-admission-workspace'
const captureInput = {
  evidenceMode: 'reported' as const,
  adapter: { id: 'admission-test', kind: 'manual' as const, version: '1.0.0' },
  observedAt: '2026-08-01T12:00:00.000Z',
  providerRecordId: null,
  providerSchema: null,
  payload: { title: 'Controls Intern' },
  evidence: [],
}

describe.sequential('live workspace authority admission', () => {
  const serverFixture = createLocalServerHttpTestFixture()

  beforeEach(() => serverFixture.setup())
  afterEach(() => serverFixture.teardown())

  it('blocks direct mutations without writing after the authority is fenced', async () => {
    const admission = new WorkspaceAuthorityAdmissionController({ workspaceId })
    const client = await createTestLocalValedictorianClient({
      authorityAdmissionController: admission,
      seedDataMode: 'none',
      workspaceId,
    })
    await expect(client.captures.create(captureInput)).resolves.toMatchObject({
      status: 'succeeded',
    })

    admission.updateState({ replicaState: 'fenced' })
    await expect(client.captures.create({
      ...captureInput,
      providerRecordId: 'must-not-be-written',
    })).rejects.toMatchObject({
      failure: { code: 'workspace_fenced', httpStatus: 409 },
    })
    await expect(client.captures.list({ limit: 10 })).resolves.toMatchObject({
      items: [{ providerRecordId: null }],
    })
  })

  it('uses the same fence before scheduler claims and HTTP mutations', async () => {
    const admission = new WorkspaceAuthorityAdmissionController({ workspaceId })
    const sources: LocalScheduledWorkSource[] = []
    const client = await createTestLocalValedictorianClient({
      authorityAdmissionController: admission,
      registerScheduledWorkSource: (source) => sources.push(source),
      seedDataMode: 'none',
      workspaceId,
    })
    const server = await serverFixture.start({ client })
    admission.updateState({ replicaState: 'fenced' })

    expect(sources.length).toBeGreaterThan(0)
    await expect(sources[0]!.runDue()).rejects.toBeInstanceOf(WorkspaceProtocolError)
    const response = await fetch(`${server.url}/v1/workspaces/${workspaceId}/captures`, {
      body: JSON.stringify(captureInput),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'workspace_fenced',
      httpStatus: 409,
    })
    await expect(client.captures.list({ limit: 10 })).resolves.toMatchObject({ items: [] })
  })

  it('requires and honors portable HTTP admission metadata', async () => {
    const admission = new WorkspaceAuthorityAdmissionController({
      authorityEpoch: 4,
      authorityId: 'authority-portable',
      mode: 'portable',
      workspaceId,
    })
    const client = await admission.runWithContext({
      authorityEpoch: 4,
      idempotencyKey: 'initialize',
      operation: 'internal.workspace.initialize',
      requestFingerprint: 'sha256:initialize',
      workspaceId,
    }, () => createTestLocalValedictorianClient({
      authorityAdmissionController: admission,
      seedDataMode: 'none',
      workspaceId,
    }))
    const server = await serverFixture.start({ client })
    const url = `${server.url}/v1/workspaces/${workspaceId}/captures`

    const missing = await fetch(url, {
      body: JSON.stringify(captureInput),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(missing.status).toBe(401)
    await expect(missing.json()).resolves.toMatchObject({ code: 'authentication_required' })

    const admitted = await fetch(url, {
      body: JSON.stringify(captureInput),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'capture-1',
        'x-request-fingerprint': 'sha256:capture-1',
        'x-workspace-authority-epoch': '4',
      },
      method: 'POST',
    })
    expect(admitted.status).toBe(200)
    await expect(admitted.json()).resolves.toMatchObject({ status: 'succeeded' })
    await expect(client.captures.list({ limit: 10 })).resolves.toMatchObject({
      items: [{ providerRecordId: null }],
    })
  })
})
