/**
 * Production-consumption proof for the shared lifecycle representations (issue #389).
 *
 * Every extracted representation is exercised through the PUBLIC service of two or more
 * aggregates — not through a re-export identity check and not through a test helper.
 * Also pins `promoteCaptureOn`'s legacy error precedence: the composable core performs
 * no actor parsing, so empty-evidence, cardinality and existing-identity no-op paths
 * behave exactly as they did before the core started taking an admitted actor.
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { jobExternalIdentities, jobHistory } from '../job/job.schema'
import { createPgliteCaptureService, type CaptureService } from '../capture/capture.service'
import { createCoveredPgliteJobService } from '../../test/covered-job-service'
import { createPgliteOpportunityService } from '../opportunity/opportunity.service'
import { createPgliteApplicationAggregateService } from '../applications/application.aggregate.service'
import { createPgliteJobPromotion } from './capture-to-job.promotion'
import { requireActor } from '../job/job.validation'
import { LIFECYCLE_ID_MAX } from './lifecycle-representation'

const resettableOwner = useResettablePgliteTestOwner()
const ACTOR = { type: 'user', id: 'u' } as const
const OVER_LONG_ID = 'x'.repeat(LIFECYCLE_ID_MAX + 1)
const AT_BOUND_ID = 'x'.repeat(LIFECYCLE_ID_MAX)

function monotonicClock(startMs = Date.UTC(2026, 6, 21, 0, 0, 0)) {
  let tick = 0
  return () => new Date(startMs + tick++ * 1000)
}

async function setup() {
  const { database } = resettableOwner()
  await database.insert(workspaces).values({ id: 'ws-a', name: 'ws-a', createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z' })
  const clock = monotonicClock()
  const captures = createPgliteCaptureService(database, { now: clock })
  const jobs = createCoveredPgliteJobService(database, { now: clock })
  const opportunities = createPgliteOpportunityService(database, { now: clock })
  const applications = createPgliteApplicationAggregateService(database, { now: clock })
  const promotion = createPgliteJobPromotion(database, captures, jobs, {
    now: clock,
    resolutionPort: { resolveDestination: async () => ({ status: 'unavailable' as const }) },
  })
  return { database, captures, jobs, opportunities, applications, promotion }
}

async function acceptCapture(captures: CaptureService, providerRecordId = 'rec-1') {
  const result = await captures.accept({
    workspaceId: 'ws-a',
    provenance: { adapterId: 'jobright.resolver', adapterKind: 'connector', adapterVersion: '1.0.0', providerRecordId, providerSchema: 'jobright.v1', observedAt: '2026-07-20T10:00:00.000Z' },
    evidenceMode: 'ats_details_provided',
    evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }],
    actor: ACTOR,
  })
  if (!result.ok) throw new Error(`accept failed: ${result.code}`)
  return result.capture
}

describe.sequential('shared lifecycle representations — production consumption (#389)', () => {
  it('admits the lifecycle id through every aggregate that owns a workspace-scoped command', async () => {
    const { captures, jobs, opportunities, applications } = await setup()
    const rejections = [
      await captures.correct({ workspaceId: OVER_LONG_ID, captureId: 'c', correction: {}, actor: ACTOR }),
      await jobs.remove({ workspaceId: OVER_LONG_ID, jobId: 'j', actor: ACTOR }),
      await opportunities.remove({ workspaceId: OVER_LONG_ID, opportunityId: 'o', actor: ACTOR }),
      await applications.remove({ workspaceId: OVER_LONG_ID, applicationId: 'a', actor: ACTOR, dependentChoice: 'cascade' }),
    ]
    for (const rejection of rejections) {
      expect(rejection).toMatchObject({
        ok: false,
        code: 'bounded_data_violation',
        message: `workspaceId exceeds ${LIFECYCLE_ID_MAX} characters`,
      })
    }
    // At the bound the id is admitted, so each aggregate proceeds to its own rules.
    expect(await jobs.remove({ workspaceId: AT_BOUND_ID, jobId: 'j', actor: ACTOR })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await opportunities.remove({ workspaceId: AT_BOUND_ID, opportunityId: 'o', actor: ACTOR })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('admits the command actor through every aggregate, keeping each error vocabulary', async () => {
    const { captures, jobs, opportunities, applications } = await setup()
    const overLongActor = { type: 'user', id: OVER_LONG_ID } as const
    const rejections = [
      await captures.correct({ workspaceId: 'ws-a', captureId: 'c', correction: {}, actor: overLongActor }),
      await jobs.remove({ workspaceId: 'ws-a', jobId: 'j', actor: overLongActor }),
      await opportunities.remove({ workspaceId: 'ws-a', opportunityId: 'o', actor: overLongActor }),
      await applications.remove({ workspaceId: 'ws-a', applicationId: 'a', actor: overLongActor, dependentChoice: 'cascade' }),
    ]
    for (const rejection of rejections) {
      expect(rejection).toMatchObject({
        ok: false,
        code: 'bounded_data_violation',
        message: `actor.id exceeds ${LIFECYCLE_ID_MAX} characters`,
      })
    }
    for (const badType of [{ type: 'robot' }, null]) {
      expect(await jobs.remove({ workspaceId: 'ws-a', jobId: 'j', actor: badType as never })).toMatchObject({ ok: false, code: 'invalid_input' })
      expect(await opportunities.remove({ workspaceId: 'ws-a', opportunityId: 'o', actor: badType as never })).toMatchObject({ ok: false, code: 'invalid_input' })
    }
  })

  it('admits bounded JSON — with the sensitive-key rule — through every aggregate that stores a payload', async () => {
    const { captures, jobs } = await setup()
    const secret = { access_token: 'leak' }
    expect(await captures.accept({
      workspaceId: 'ws-a',
      provenance: { adapterId: 'a', adapterKind: 'manual', adapterVersion: '1', providerRecordId: null, providerSchema: null, observedAt: '2026-07-20T10:00:00.000Z' },
      evidenceMode: 'reported',
      evidence: [{ kind: 'k', label: 'l', value: 'v' }],
      payload: secret,
      actor: ACTOR,
    })).toMatchObject({ ok: false, code: 'security_violation' })
    expect(await jobs.create({ workspaceId: 'ws-a', facts: secret, actor: ACTOR })).toMatchObject({
      ok: false,
      code: 'security_violation',
      message: 'facts contains a forbidden sensitive key',
    })

    const created = await jobs.create({ workspaceId: 'ws-a', facts: { title: 'Engineer' }, actor: ACTOR })
    if (!created.ok) throw new Error(created.message)
    expect(await jobs.correctFacts({ workspaceId: 'ws-a', jobId: created.job.id, facts: secret, actor: ACTOR }))
      .toMatchObject({ ok: false, code: 'security_violation' })
  })

  it('persists the admitted audit envelope every aggregate history shares', async () => {
    const { database, jobs, opportunities } = await setup()
    const created = await jobs.create({ workspaceId: 'ws-a', facts: { title: 'Engineer' }, actor: { type: 'agent', id: 'a-1' } })
    if (!created.ok) throw new Error(created.message)
    const [row] = await database.select().from(jobHistory).where(eq(jobHistory.jobId, created.job.id))
    expect(row?.auditJson).toBe('{"actor":{"type":"agent","id":"a-1"}}')

    const opportunity = await opportunities.create({ workspaceId: 'ws-a', jobId: created.job.id, actor: { type: 'system' } })
    if (!opportunity.ok) throw new Error(opportunity.message)
    expect((await opportunities.history('ws-a', opportunity.opportunity.id))[0]?.actor).toEqual({ type: 'system', id: null })
  })
})

describe.sequential('promoteCaptureOn error precedence (#389)', () => {
  it('rejects empty evidence references before touching the actor', async () => {
    const { database, captures, jobs, promotion } = await setup()
    const capture = await acceptCapture(captures)
    const created = await jobs.create({ workspaceId: 'ws-a', facts: { title: 'Engineer' }, actor: ACTOR })
    if (!created.ok) throw new Error(created.message)
    const finalized = await database.transaction((tx) => promotion.promoteCaptureOn(tx, {
      workspaceId: 'ws-a',
      captureId: capture.id,
      jobId: created.job.id,
      actor: requireActor(ACTOR),
      evidenceReferences: [],
      externalIdentities: [],
    }))
    expect(finalized).toEqual({ ok: false, code: 'invalid_input', message: 'promotion requires at least one evidence reference' })
  })

  it('rejects an empty evidence-index cardinality with its own message', async () => {
    const { database, captures, jobs, promotion } = await setup()
    const capture = await acceptCapture(captures)
    const created = await jobs.create({ workspaceId: 'ws-a', facts: { title: 'Engineer' }, actor: ACTOR })
    if (!created.ok) throw new Error(created.message)
    const finalized = await database.transaction((tx) => promotion.promoteCaptureOn(tx, {
      workspaceId: 'ws-a',
      captureId: capture.id,
      jobId: created.job.id,
      actor: requireActor(ACTOR),
      evidenceReferences: [{ captureId: capture.id, captureRevision: capture.revision, evidenceIndexes: [] }],
      externalIdentities: [],
    }))
    expect(finalized).toEqual({ ok: false, code: 'invalid_input', message: 'an evidence reference must name at least one evidence item' })
  })

  it('treats an already-established identity as a no-op that appends no history', async () => {
    const { database, captures, jobs, promotion } = await setup()
    const capture = await acceptCapture(captures)
    const promoted = await promotion.promoteCapture({ workspaceId: 'ws-a', captureId: capture.id, actor: ACTOR })
    if (!promoted.ok) throw new Error(promoted.message)
    const identities = await database.select().from(jobExternalIdentities).where(eq(jobExternalIdentities.jobId, promoted.jobId))
    expect(identities.length).toBeGreaterThan(0)
    const before = await jobs.history('ws-a', promoted.jobId)

    const replayed = await database.transaction((tx) => promotion.promoteCaptureOn(tx, {
      workspaceId: 'ws-a',
      captureId: capture.id,
      jobId: promoted.jobId,
      actor: requireActor(ACTOR),
      evidenceReferences: [{ captureId: capture.id, captureRevision: capture.revision, evidenceIndexes: [0] }],
      externalIdentities: identities.map((identity) => ({
        kind: identity.kind as 'ats_job',
        provider: identity.provider,
        account: identity.account,
        value: identity.value,
        strength: identity.strength as 'strong',
      })),
    }))
    expect(replayed).toEqual({ ok: true })
    expect(await jobs.history('ws-a', promoted.jobId)).toEqual(before)
  })
})
