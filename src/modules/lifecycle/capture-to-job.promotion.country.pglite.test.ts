/**
 * Capture -> Job country-evidence promotion — focused proofs (#325, A7).
 *
 * A null caller-selected location is prefilled only from a completed current-version resolved
 * outcome whose country is exactly US or CA; a non-null caller location is preserved; conflicting/
 * country-free/remote-only evidence stays unknown; promotion stays explicit; and replay or a later
 * resolver run never edits an existing Job (durable user corrections remain authoritative).
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createJobrightProviderFieldResolver } from '@sparxie/valedictorian-connectors-jobright'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { createPgliteCaptureService, type JsonValue } from '../capture/capture.service'
import { createCaptureFieldOutcomeStore } from '../capture/capture.field-outcomes'
import { createPgliteJobServiceWithCompanies } from '../../test/job-service-with-companies'
import { jobs } from '../job/job.schema'
import { createPgliteJobPromotion } from './capture-to-job.promotion'
import {
  createNormalizationExecutor,
  createNormalizationWorkRepository,
  enqueueNormalizationWork,
} from '../scheduling/normalization-work'

const resettableOwner = useResettablePgliteTestOwner()
const WS = 'ws-promo'
const ACTOR = { type: 'user', id: 'user-1' } as const
const SYSTEM_ACTOR = { type: 'system' } as const
const RESOLVER_ID = 'jobright.provider-fields'
const RESOLVER_VERSION = 'jobright-provider-fields@2'
const ADAPTER_ID = 'jobright.resolver'
const PROVIDER_SCHEMA = 'jobright-authenticated-search@1'

function clock() {
  return new Date(Date.UTC(2026, 6, 22, 12, 0, 0))
}

function validFacts(location: JsonValue): JsonValue {
  return {
    companyName: 'Acme', roleTitle: 'Engineer', sourceName: 'Jobright', roleKind: 'experienced',
    term: null, terms: [], timingMode: 'unknown', startDate: null, endDate: null,
    location, workMode: 'unknown', employmentType: 'unknown', seniority: 'unknown',
    compensation: null, postedAt: null, destination: null,
  }
}

type Database = Awaited<ReturnType<typeof seedWorkspace>>

async function seedWorkspace() {
  const { database } = resettableOwner()
  await database.insert(workspaces).values({ id: WS, name: WS, createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z' })
  return database
}

async function seedJobrightCapture(database: Database, jobResult: Record<string, unknown>, recordId: string) {
  const captures = createPgliteCaptureService(database, { now: clock })
  const accepted = await captures.accept({
    workspaceId: WS,
    provenance: { adapterId: ADAPTER_ID, adapterKind: 'connector', adapterVersion: '0.18.1', providerRecordId: recordId, providerSchema: PROVIDER_SCHEMA, observedAt: '2026-07-22T10:00:00.000Z' },
    evidenceMode: 'reported',
    evidence: [{ kind: 'provider_api_record', label: 'Jobright row', value: { providerRecordId: recordId } }],
    payload: { providerRow: { jobResult: { jobId: recordId, ...jobResult } } },
    connectorProvenance: { connectorInstanceId: 'instance-1', connectorRunId: 'run-1', executionScopeId: 'connector.jobright-test', reportedOrigin: { kind: 'aggregator', name: 'Jobright', providerId: 'jobright' } },
    actor: SYSTEM_ACTOR,
  })
  if (!accepted.ok || !accepted.connectorRevision) throw new Error(`capture accept failed: ${accepted.ok ? 'no revision' : `${accepted.code}: ${accepted.message}`}`)
  return { capture: accepted.capture, contentHash: accepted.connectorRevision.contentHash, revision: accepted.connectorRevision.revision }
}

/** Run the provider-field resolver for the capture and persist outcomes (the scheduling slice). */
async function resolveAndPersist(database: Database, seeded: { capture: { id: string }; revision: number; contentHash: string }) {
  const fieldOutcomes = createCaptureFieldOutcomeStore(database)
  const repository = createNormalizationWorkRepository(database, { now: clock })
  const executor = createNormalizationExecutor({ database, fieldOutcomes, getResolver: () => createJobrightProviderFieldResolver(), repository, workspaceId: WS, now: clock })
  await enqueueNormalizationWork(repository, { workspaceId: WS, captureId: seeded.capture.id, captureRevision: seeded.revision, resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, inputHash: seeded.contentHash })
  const claim = await repository.claimDue(clock().toISOString())
  if (claim) await executor(claim)
  return { fieldOutcomes, repository, executor }
}

function promotion(database: Database, fieldOutcomes: ReturnType<typeof createCaptureFieldOutcomeStore>) {
  const captureService = createPgliteCaptureService(database, { now: clock })
  const jobService = createPgliteJobServiceWithCompanies(database, { now: clock })
  return {
    jobService,
    promotion: createPgliteJobPromotion(database, captureService, jobService, {
      now: clock,
      locationEvidence: {
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        readResolvedLocation: (exec, ws, captureId, captureRevision, resolverId, resolverVersion) =>
          fieldOutcomes.readResolvedLocation(exec, ws, captureId, captureRevision, resolverId, resolverVersion),
      },
    }),
  }
}

async function jobLocation(database: Database, jobId: string) {
  const [row] = await database.select({ factsJson: jobs.factsJson }).from(jobs).where(eq(jobs.id, jobId)).limit(1)
  if (!row) throw new Error('job not found')
  return (JSON.parse(row.factsJson) as { location: unknown }).location
}

describe.sequential('Capture -> Job country evidence (#325)', () => {
  it('prefills a null caller location from resolved US evidence', async () => {
    const database = await seedWorkspace()
    const seeded = await seedJobrightCapture(database, { jobLocation: 'San Francisco, CA, United States' }, 'rec-us')
    const { fieldOutcomes } = await resolveAndPersist(database, seeded)
    const { promotion: promo } = promotion(database, fieldOutcomes)

    const result = await promo.promoteCapture({ workspaceId: WS, captureId: seeded.capture.id, actor: ACTOR, selectedFacts: validFacts(null) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await jobLocation(database, result.jobId)).toEqual({ display: 'San Francisco, CA, United States', city: null, region: null, country: 'US' })
  })

  it('preserves a non-null caller location even when evidence resolves another country', async () => {
    const database = await seedWorkspace()
    const seeded = await seedJobrightCapture(database, { jobLocation: 'San Francisco, CA, United States' }, 'rec-preserve')
    const { fieldOutcomes } = await resolveAndPersist(database, seeded)
    const { promotion: promo } = promotion(database, fieldOutcomes)

    const callerLocation = { display: 'Toronto, ON, Canada', city: 'Toronto', region: 'ON', country: 'CA' }
    const result = await promo.promoteCapture({ workspaceId: WS, captureId: seeded.capture.id, actor: ACTOR, selectedFacts: validFacts(callerLocation) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await jobLocation(database, result.jobId)).toEqual(callerLocation)
  })

  it('keeps conflicting/country-free/remote-only evidence unknown (location stays null)', async () => {
    const database = await seedWorkspace()
    for (const [recordId, jobResult] of [
      ['rec-conflict', { jobLocations: ['New York, US', 'Toronto, Canada'] }],
      ['rec-remote', { jobLocation: 'Remote' }],
      ['rec-countryfree', { jobLocation: 'San Francisco, CA' }],
    ] as const) {
      const seeded = await seedJobrightCapture(database, jobResult, recordId)
      const { fieldOutcomes } = await resolveAndPersist(database, seeded)
      const { promotion: promo } = promotion(database, fieldOutcomes)
      const result = await promo.promoteCapture({ workspaceId: WS, captureId: seeded.capture.id, actor: ACTOR, selectedFacts: validFacts(null) })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(await jobLocation(database, result.jobId)).toBeNull()
    }
  })

  it('declines resolved evidence that exceeds canonical Job location bounds', async () => {
    const database = await seedWorkspace()
    const oversizedLocation = `${'A'.repeat(501)}, United States`
    const seeded = await seedJobrightCapture(database, { jobLocation: oversizedLocation }, 'rec-oversized')
    const { fieldOutcomes } = await resolveAndPersist(database, seeded)
    expect(await fieldOutcomes.readResolvedLocation(database, WS, seeded.capture.id, seeded.revision, RESOLVER_ID, RESOLVER_VERSION))
      .toMatchObject({ country: 'US', display: oversizedLocation })
    const { promotion: promo } = promotion(database, fieldOutcomes)

    const result = await promo.promoteCapture({ workspaceId: WS, captureId: seeded.capture.id, actor: ACTOR, selectedFacts: validFacts(null) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await jobLocation(database, result.jobId)).toBeNull()
  })

  it('replay never edits an existing Job; a later user correction stays authoritative', async () => {
    const database = await seedWorkspace()
    const seeded = await seedJobrightCapture(database, { jobLocation: 'Austin, TX, United States' }, 'rec-correct')
    const { fieldOutcomes, repository, executor } = await resolveAndPersist(database, seeded)
    const { jobService, promotion: promo } = promotion(database, fieldOutcomes)

    const result = await promo.promoteCapture({ workspaceId: WS, captureId: seeded.capture.id, actor: ACTOR, selectedFacts: validFacts(null) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const jobId = result.jobId
    expect(await jobLocation(database, jobId)).toMatchObject({ country: 'US' })

    // User corrects the location to Canada; this is authoritative.
    const corrected = await jobService.correctFacts({ workspaceId: WS, jobId, actor: ACTOR, facts: validFacts({ display: 'Vancouver, BC, Canada', city: 'Vancouver', region: 'BC', country: 'CA' }) })
    expect(corrected.ok).toBe(true)
    expect(await jobLocation(database, jobId)).toMatchObject({ country: 'CA' })

    // Re-running the resolver (replay) only re-persists Capture outcomes; the Job is untouched.
    await enqueueNormalizationWork(repository, { workspaceId: WS, captureId: seeded.capture.id, captureRevision: seeded.revision, resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, inputHash: seeded.contentHash })
    const claim = await repository.claimDue(clock().toISOString())
    if (claim) await executor(claim)
    expect(await jobLocation(database, jobId)).toMatchObject({ country: 'CA' })
  })
})
