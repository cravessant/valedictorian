import { count } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  getTestLocalValedictorianDatabase,
  useResettablePgliteTestLocalValedictorianClient,
} from './local-valedictorian-client.test-harness'
import { jobCompanyAssignments } from '../modules/company/company.schema'

const createClient = useResettablePgliteTestLocalValedictorianClient()
const ACTOR = { id: 'user-1', type: 'user' as const }
const FACTS = {
  companyName: 'Runtime Company',
  roleTitle: 'Runtime Engineer',
  sourceName: 'manual',
  roleKind: 'experienced' as const,
  term: null,
  terms: [],
  timingMode: 'unknown' as const,
  startDate: null,
  endDate: null,
  location: null,
  workMode: 'remote' as const,
  employmentType: 'full_time' as const,
  seniority: 'senior' as const,
  compensation: null,
  postedAt: null,
  destination: null,
}

describe.sequential('local client Workspace Company coverage', () => {
  it('reports readiness and covers direct and promoted Job creation paths', async () => {
    const client = await createClient({ workspaceId: 'runtime-company-workspace' })
    expect(await client.companies.capability.get()).toEqual({ status: 'ready' })

    const capture = await client.captures.create({
      evidenceMode: 'reported',
      adapter: { id: 'cli', kind: 'cli', version: '1.0.0' },
      observedAt: '2026-07-23T00:00:00.000Z',
      providerRecordId: null,
      providerSchema: null,
      payload: null,
      evidence: [{ kind: 'title', label: 'Title', value: 'Runtime Engineer' }],
    })
    if (capture.status !== 'succeeded') throw new Error('capture create failed')
    const evidenceReference = {
      captureId: capture.resource.id,
      captureRevision: capture.resource.revision,
      evidenceIndexes: [0],
    }
    const direct = await client.jobs.create({
      idempotencyKey: 'direct-company-coverage',
      actor: ACTOR,
      facts: FACTS,
      availability: {
        state: 'open',
        observedAt: '2026-07-23T00:00:00.000Z',
      },
      evidenceReferences: [evidenceReference],
      externalIdentities: [],
    })
    expect(direct.status).toBe('succeeded')

    const promotionCapture = await client.captures.create({
      evidenceMode: 'reported',
      adapter: { id: 'cli', kind: 'cli', version: '1.0.0' },
      observedAt: '2026-07-23T00:01:00.000Z',
      providerRecordId: null,
      providerSchema: null,
      payload: null,
      evidence: [{
        kind: 'title',
        label: 'Title',
        value: 'Promoted Runtime Engineer',
      }],
    })
    if (promotionCapture.status !== 'succeeded') {
      throw new Error('promotion capture create failed')
    }
    const promotionEvidenceReference = {
      captureId: promotionCapture.resource.id,
      captureRevision: promotionCapture.resource.revision,
      evidenceIndexes: [0],
    }
    const promoted = await client.captures.promoteToJob({
      idempotencyKey: 'promoted-company-coverage',
      actor: ACTOR,
      captureId: promotionCapture.resource.id,
      captureRevision: promotionCapture.resource.revision,
      selectedFacts: {
        ...FACTS,
        companyName: 'Promoted Runtime Company',
        roleTitle: 'Promoted Runtime Engineer',
      },
      evidenceReferences: [promotionEvidenceReference],
      externalIdentities: [],
    })
    expect(promoted.status).toBe('promoted')

    const database = getTestLocalValedictorianDatabase(client)
    expect(await database.select({ value: count() }).from(jobCompanyAssignments))
      .toEqual([{ value: 2 }])
  })

  it('keeps Company mutations unavailable even after baseline readiness', async () => {
    const client = await createClient({ workspaceId: 'runtime-company-write-gate' })
    expect(await client.companies.capability.get()).toEqual({ status: 'ready' })
    await expect(client.companies.create({} as never))
      .rejects.toThrow('Companies is not available in the local workspace runtime.')
    await expect(client.companyAssignments.reassign({} as never))
      .rejects.toThrow('Company assignments is not available in the local workspace runtime.')
  })
})
