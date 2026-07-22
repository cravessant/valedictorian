/**
 * In-process lifecycle facade — APPLICATIONS vertical, red-first pglite proofs (#304, item 3c).
 *
 * Proves the facade composes the Application aggregate service, the Application read-model,
 * the create orchestration (atomic create + initialLinks), and the removal orchestration
 * into the strict sparxie `applications` surface. Every result is re-parsed through the
 * concrete sparxie result schema (contract-valid output the routes and typed client
 * render). Covers create carrying atomic initialLinks (materialized as durable links AND
 * frozen in the snapshot), get/list, status/company/source updates bumping the revision,
 * link create/update/remove, refreshSnapshot honoring the caller preserve flags, the
 * deterministic-duplicate block (conflicting id + attach/merge resolutions), remove/restore,
 * history, the attempt/event technical lists, and workspace isolation.
 */
import { describe, expect, it } from 'vitest'
import {
  applicationAttemptsListResultSchema,
  applicationEventsListResultSchema,
  applicationMutationResultSchema,
  applicationSchema,
  lifecycleApplicationHistoryResultSchema,
  lifecycleApplicationListResultSchema,
  removalResultSchema,
  restoreResultSchema,
} from 'sparxie'
import { useResettablePgliteTestOwner } from '../test/pglite-test-owner'
import { workspaces } from '../db/workspaces.schema'
import { createLocalLifecycleMethods } from './local-lifecycle-methods'

const resettableOwner = useResettablePgliteTestOwner()

function monotonicClock(startMs = Date.UTC(2026, 6, 21, 0, 0, 0)) {
  let tick = 0
  return () => new Date(startMs + tick++ * 1000)
}

async function setup(workspaceId = 'ws-a') {
  const { database } = resettableOwner()
  for (const id of ['ws-a', 'ws-b']) {
    await database.insert(workspaces).values({ id, name: id, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' })
  }
  const now = monotonicClock()
  const methods = createLocalLifecycleMethods(database, { workspaceId, now })
  return { database, methods, now }
}

const USER = { id: 'u-1', type: 'user' as const }
const CAPTURE_INPUT = {
  evidenceMode: 'reported' as const,
  adapter: { id: 'cli', kind: 'cli' as const, version: '1.0.0' },
  observedAt: '2026-07-21T00:00:00.000Z',
  providerRecordId: null, providerSchema: null, payload: null,
  evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }],
}
const FACTS = {
  companyName: 'Acme', roleTitle: 'Engineer', sourceName: 'greenhouse', roleKind: 'experienced' as const,
  term: null, terms: [], timingMode: 'unknown' as const, startDate: null, endDate: null, location: null,
  workMode: 'remote' as const, employmentType: 'full_time' as const, seniority: 'senior' as const,
  compensation: null, postedAt: null, destination: null,
}
const AVAILABILITY = { state: 'open' as const, observedAt: '2026-07-21T00:00:00.000Z' }
const LINK = { kind: 'posting', label: 'Job posting', url: 'https://example.com/job' }

let keyCounter = 0
const key = () => `idem-${(keyCounter += 1)}`

type Methods = Awaited<ReturnType<typeof setup>>['methods']

async function createOpportunity(methods: Methods) {
  const capture = await methods.captures.create(CAPTURE_INPUT)
  if (capture.status !== 'succeeded') throw new Error('capture create failed')
  const job = await methods.jobs.create({
    idempotencyKey: key(), actor: USER, facts: FACTS, availability: AVAILABILITY,
    evidenceReferences: [{ captureId: capture.resource.id, captureRevision: capture.resource.revision, evidenceIndexes: [0] }],
    externalIdentities: [],
  })
  if (job.status !== 'succeeded') throw new Error('job create failed')
  const opp = await methods.opportunities.create({
    idempotencyKey: key(), actor: USER, jobId: job.resource.id, expectedJobFactsRevision: 1,
    fit: 'fit', rank: 1, cutoff: 'above', disposition: 'reviewing',
  })
  if (opp.status !== 'succeeded') throw new Error('opportunity create failed')
  return { opportunityId: opp.resource.id, jobId: job.resource.id }
}

async function createApplication(methods: Methods, initialLinks: { kind: string; label: string; url: string }[] = [LINK]) {
  const { opportunityId, jobId } = await createOpportunity(methods)
  const result = await methods.applications.create({
    idempotencyKey: key(), actor: USER, opportunityId, jobId, expectedJobFactsRevision: 1, initialLinks,
  })
  return { result, opportunityId, jobId }
}

describe.sequential('local lifecycle facade — applications', () => {
  it('creates an application with atomic initialLinks (durable links + frozen snapshot; contract-valid)', async () => {
    const { methods } = await setup()
    const { result } = await createApplication(methods)
    expect(() => applicationMutationResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe('succeeded')
    if (result.status !== 'succeeded') throw new Error('unreachable')
    // Durable link row materialized in the same transaction as the head.
    expect(result.resource.links.map((l) => l.url)).toContain('https://example.com/job')
    // Creation-time link frozen additively in the snapshot blob.
    expect(result.resource.snapshot.initialLinks).toEqual([LINK])
    expect(result.audit.actor).toEqual({ id: 'u-1', type: 'user' })
  })

  it('reads an application back via get and list (contract-valid)', async () => {
    const { methods } = await setup()
    const { result } = await createApplication(methods)
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const fetched = await methods.applications.get(result.resource.id)
    expect(() => applicationSchema.parse(fetched)).not.toThrow()
    const listed = await methods.applications.list()
    expect(() => lifecycleApplicationListResultSchema.parse(listed)).not.toThrow()
    expect(listed.items.map((a) => a.id)).toContain(result.resource.id)
  })

  it('updates status, company, and source, bumping the resource revision each time', async () => {
    const { methods } = await setup()
    const { result } = await createApplication(methods, [])
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const id = result.resource.id

    const statused = await methods.applications.updateStatus({ applicationId: id, expectedRevision: 1, actor: USER, status: 'submitted', rationale: 'sent' })
    expect(() => applicationMutationResultSchema.parse(statused)).not.toThrow()
    if (statused.status !== 'succeeded') throw new Error('unreachable')
    expect(statused.resource.status).toBe('submitted')
    expect(statused.resource.revision).toBe(2)

    const company = await methods.applications.updateCompany({ applicationId: id, expectedRevision: 2, actor: USER, companyName: 'Custom Co', rationale: 'rename' })
    if (company.status !== 'succeeded') throw new Error('unreachable')
    expect(company.resource.companyName).toBe('Custom Co')
    expect(company.resource.revision).toBe(3)

    const source = await methods.applications.updateSource({ applicationId: id, expectedRevision: 3, actor: USER, sourceName: 'Referral', rationale: 'src' })
    if (source.status !== 'succeeded') throw new Error('unreachable')
    expect(source.resource.sourceName).toBe('Referral')
    expect(source.resource.revision).toBe(4)
  })

  it('creates, updates, and removes a pursuit link (contract-valid)', async () => {
    const { methods } = await setup()
    const { result } = await createApplication(methods, [])
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const id = result.resource.id

    const created = await methods.applications.links.create({ applicationId: id, expectedRevision: 1, actor: USER, link: { kind: 'careers', label: 'Careers', url: 'https://example.com/careers' }, primary: true })
    expect(() => applicationMutationResultSchema.parse(created)).not.toThrow()
    if (created.status !== 'succeeded') throw new Error('unreachable')
    const linkId = created.resource.links.find((l) => l.url === 'https://example.com/careers')?.id
    expect(linkId).toBeDefined()

    const updated = await methods.applications.links.update({ applicationId: id, expectedRevision: 2, actor: USER, linkId: linkId!, link: { kind: 'careers', label: 'Careers page', url: 'https://example.com/careers2' }, primary: false })
    if (updated.status !== 'succeeded') throw new Error('unreachable')
    expect(updated.resource.links.find((l) => l.id === linkId)?.url).toBe('https://example.com/careers2')

    const removed = await methods.applications.links.remove({ applicationId: id, expectedRevision: 3, actor: USER, linkId: linkId!, rationale: 'drop' })
    if (removed.status !== 'succeeded') throw new Error('unreachable')
    expect(removed.resource.links.some((l) => l.id === linkId)).toBe(false)
  })

  it('refreshSnapshot adopts refreshed facts when preserve flags are false, and keeps edits when true', async () => {
    const { methods } = await setup()
    const { result } = await createApplication(methods, [])
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const id = result.resource.id

    // Edit the company, then refresh preserving the edit — the edit survives.
    const edited = await methods.applications.updateCompany({ applicationId: id, expectedRevision: 1, actor: USER, companyName: 'Hand Edited', rationale: 'edit' })
    if (edited.status !== 'succeeded') throw new Error('unreachable')
    const preserved = await methods.applications.refreshSnapshot({ applicationId: id, expectedRevision: 2, actor: USER, expectedJobFactsRevision: 1, preserveCompanyEdit: true, preserveSourceEdit: true, preserveLinkEdits: true, rationale: 'r' })
    expect(() => applicationMutationResultSchema.parse(preserved)).not.toThrow()
    if (preserved.status !== 'succeeded') throw new Error('unreachable')
    expect(preserved.resource.companyName).toBe('Hand Edited')

    // Refresh again NOT preserving — the head adopts the Job's company from facts.
    const adopted = await methods.applications.refreshSnapshot({ applicationId: id, expectedRevision: 3, actor: USER, expectedJobFactsRevision: 1, preserveCompanyEdit: false, preserveSourceEdit: false, preserveLinkEdits: false, rationale: 'r' })
    if (adopted.status !== 'succeeded') throw new Error('unreachable')
    expect(adopted.resource.companyName).toBe('Acme')
  })

  it('blocks a duplicate application for the same opportunity with the conflicting id + resolutions', async () => {
    const { methods } = await setup()
    const { opportunityId, jobId } = await createApplication(methods, [])
    const duplicate = await methods.applications.create({
      idempotencyKey: key(), actor: USER, opportunityId, jobId, expectedJobFactsRevision: 1, initialLinks: [],
    })
    expect(() => applicationMutationResultSchema.parse(duplicate)).not.toThrow()
    expect(duplicate.status).toBe('blocked')
    if (duplicate.status !== 'blocked') throw new Error('unreachable')
    expect(duplicate.blocker.code).toBe('deterministic_duplicate')
    expect(typeof duplicate.blocker.conflictingResourceId).toBe('string')
    expect(duplicate.blocker.allowedDuplicateResolutions).toEqual(expect.arrayContaining(['attach', 'merge']))
  })

  it('removes and restores an application (contract-valid)', async () => {
    const { methods } = await setup()
    const { result } = await createApplication(methods, [])
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const id = result.resource.id

    const removed = await methods.applications.remove({ id, choice: 'cascade_tombstone', actor: USER, rationale: 'drop' })
    expect(() => removalResultSchema.parse(removed)).not.toThrow()
    expect(removed.status).toBe('removed')

    const restored = await methods.applications.restore({ id, actor: USER, rationale: 'back' })
    expect(() => restoreResultSchema.parse(restored)).not.toThrow()
    expect(restored.status).toBe('restored')
  })

  it('reconstructs application history (contract-valid)', async () => {
    const { methods } = await setup()
    const { result } = await createApplication(methods, [])
    if (result.status !== 'succeeded') throw new Error('unreachable')
    await methods.applications.updateStatus({ applicationId: result.resource.id, expectedRevision: 1, actor: USER, status: 'submitted', rationale: 'sent' })
    const history = await methods.applications.history({ id: result.resource.id })
    expect(() => lifecycleApplicationHistoryResultSchema.parse(history)).not.toThrow()
    expect(history.items.map((h) => h.kind)).toEqual(expect.arrayContaining(['created', 'status_changed']))
  })

  it('serves the attempt and event technical lists (contract-valid)', async () => {
    const { methods } = await setup()
    const { result } = await createApplication(methods, [])
    if (result.status !== 'succeeded') throw new Error('unreachable')
    const attempts = await methods.applications.attempts.list({ applicationId: result.resource.id })
    expect(() => applicationAttemptsListResultSchema.parse(attempts)).not.toThrow()
    const events = await methods.applications.events.list({ applicationId: result.resource.id })
    expect(() => applicationEventsListResultSchema.parse(events)).not.toThrow()
  })

  it('isolates applications across workspaces', async () => {
    const { database, now } = await setup()
    const wsA = createLocalLifecycleMethods(database, { workspaceId: 'ws-a', now })
    const wsB = createLocalLifecycleMethods(database, { workspaceId: 'ws-b', now })
    const { result } = await createApplication(wsA, [])
    if (result.status !== 'succeeded') throw new Error('unreachable')
    expect(await wsB.applications.get(result.resource.id)).toBeNull()
    expect((await wsB.applications.list()).items).toEqual([])
  })
})
