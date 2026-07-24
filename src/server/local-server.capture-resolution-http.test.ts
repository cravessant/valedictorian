import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpValedictorianClient,
  ValedictorianHttpError,
} from '@sparxie/sdk'
import { createTestLocalValedictorianClient } from '../runtime/local-valedictorian-client.test-harness'
import { createLocalServerHttpTestFixture } from './local-server.http-test-harness'

const WORKSPACE = 'capture-resolution-http-workspace'

describe.sequential('Capture resolution HTTP surface', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  async function setup() {
    const local = await createTestLocalValedictorianClient({ workspaceId: WORKSPACE })
    const server = await fixture.start({ client: local })
    const client = createHttpValedictorianClient({
      baseUrl: server.url,
    }).forWorkspace(WORKSPACE)
    return { client, server }
  }

  it('serves only the canonical typed list and detail routes', async () => {
    const { client, server } = await setup()
    const created = await client.captures.create({
      evidenceMode: 'reported',
      adapter: { id: 'manual.capture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-23T00:00:00.000Z',
      providerRecordId: null,
      providerSchema: null,
      payload: { companyName: 'HTTP Labs', roleTitle: 'HTTP Engineer' },
      evidence: [{
        kind: 'title',
        label: 'Role title',
        value: 'HTTP Engineer',
      }],
    })
    if (created.status !== 'succeeded') throw new Error('expected Capture creation')

    const page = await client.captureResolution.list({
      filter: 'all',
      sort: 'observed_desc',
      limit: 50,
    })
    expect(page).toMatchObject({
      totalCount: 1,
      items: [{
        captureId: created.resource.id,
        readiness: 'ready',
        processingSummary: 'awaiting_information',
        primaryIntent: { kind: 'complete_job_information' },
      }],
    })
    expect(await client.captureResolution.get(created.resource.id)).toMatchObject({
      captureId: created.resource.id,
      destination: { status: 'not_required' },
      exactEvidenceReferences: [{
        captureId: created.resource.id,
        evidenceIndexes: [0],
      }],
    })

    expect((await fetch(
      `${server.url}/v1/workspaces/${WORKSPACE}/captures/resolution`,
    )).status).toBe(404)
    expect((await fetch(
      `${server.url}/v1/capture-resolution/captures`,
    )).status).toBe(404)
    await expect(client.captureResolution.get(
      '018f0000-0000-7000-8000-000000000099',
    )).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<ValedictorianHttpError>)
  })
})
