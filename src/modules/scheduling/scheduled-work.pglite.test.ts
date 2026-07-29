/**
 * Scheduled-work module contract — red-first proofs through the PUBLIC scheduler seam
 * (issue #303). Each independently retryable lifecycle operation gets its own durable
 * identity, attempt budget, status, and next-eligible time on its OWN canonical table,
 * so one operation can never exhaust, complete, or delay another. Exercises atomic
 * due claiming (FOR UPDATE SKIP LOCKED), shared bounded backoff + sanitized Retry-After
 * (the same `scheduleRetry` policy #233 uses — integrated, not duplicated), exhaustion,
 * deterministic terminal failure, restart recovery of orphaned claims without duplicate
 * execution, idempotent enqueue, and separation of attempt budgets across operations.
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { connectorCaptureWork, connectorInstances } from '../connectors/connector.schema'
import { sourceExecutionScopes } from '../../db/schema'
import { createPgliteCaptureService } from '../capture/capture.service'
import { createLocalScheduler } from '../../runtime/local-scheduler'
import { createScheduledWorkSource } from './scheduled-work.source'
import {
  hostedResultPollingWork,
  hostedSubmissionWork,
  providerUrlResolutionWork,
} from './scheduling.schema'
import {
  connectorCaptureOperation,
  normalizationOperation,
  providerUrlResolutionOperation,
  createScheduledWorkRepository,
  type ScheduledWorkRepositoryOptions,
} from './scheduled-work'

const resettableOwner = useResettablePgliteTestOwner()
const WS = 'ws-a'
const ACTOR = { type: 'system' } as const

function seededClock(startMs = Date.UTC(2026, 6, 20, 0, 0, 0)) {
  let current = startMs
  const clock = () => new Date(current)
  return { clock, advance: (ms: number) => { current += ms }, set: (ms: number) => { current = ms }, nowMs: () => current }
}

function options(clock: () => Date, extra: Partial<ScheduledWorkRepositoryOptions> = {}): ScheduledWorkRepositoryOptions {
  let counter = 0
  return { now: clock, random: () => 0.5, newId: () => `id-${(counter += 1).toString().padStart(4, '0')}`, leaseMs: 60_000, ...extra }
}

async function seedWorkspace() {
  const { database } = resettableOwner()
  await database.insert(workspaces).values({ id: WS, name: WS, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' })
  return database
}

async function seedCapture(database: Awaited<ReturnType<typeof seedWorkspace>>, clock: () => Date) {
  const captures = createPgliteCaptureService(database, { now: clock })
  const accepted = await captures.accept({
    workspaceId: WS,
    provenance: { adapterId: 'jobright.resolver', adapterKind: 'connector', adapterVersion: '1.0.0', providerRecordId: `rec-${Math.random()}`, providerSchema: 'jobright.v1', observedAt: '2026-07-19T10:00:00.000Z' },
    evidenceMode: 'reported',
    evidence: [{ kind: 'title', label: 'Title', value: 'Engineer' }],
    actor: ACTOR,
  })
  if (!accepted.ok) throw new Error(`capture accept failed: ${accepted.code}`)
  return accepted.capture
}

async function seedConnector(database: Awaited<ReturnType<typeof seedWorkspace>>, id: string) {
  const ts = '2026-07-20T00:00:00.000Z'
  await database.insert(sourceExecutionScopes).values({ id: `scope-${id}`, createdAt: ts, updatedAt: ts })
  await database.insert(connectorInstances).values({ id, executionScopeId: `scope-${id}`, connectorId: 'jobright.resolver', connectorVersion: '1.0.0', displayName: 'Jobright', enabled: true, configJson: '{}', createdAt: ts, updatedAt: ts })
  return id
}

function providerSubject(captureId: string, suffix = '1') {
  return { captureId, resolverId: 'jobright.provider-url', resolverVersion: 'jobright-provider-url@1', intermediaryUrlHash: `sha256:intermediary-${suffix}` }
}

describe.sequential('Scheduled-work module contract (#303)', () => {
  it('gives each independent operation a distinct durable identity, budget, status, and next-eligible time', async () => {
    const database = await seedWorkspace()
    const { clock } = seededClock()
    const capture = await seedCapture(database, clock)
    const connectorId = await seedConnector(database, 'connector-one')

    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(clock))
    const connector = createScheduledWorkRepository(database, connectorCaptureOperation, options(clock))

    expect(await provider.enqueue({ workspaceId: WS, idempotencyKey: 'purl-1', ownerVersion: '1', subject: providerSubject(capture.id) })).toBe(true)
    expect(await connector.enqueue({ workspaceId: WS, idempotencyKey: 'cap-1', ownerVersion: '1', subject: { connectorInstanceId: connectorId, filterSignature: 'sig', checkpointSchemaVersion: 'v1', checkpointGeneration: 'g1' } })).toBe(true)

    const [purlRow] = await database.select().from(providerUrlResolutionWork)
    expect(purlRow).toMatchObject({ status: 'scheduled', attempt: 1, workspaceId: WS, captureId: capture.id })
    expect(purlRow?.nextEligibleAt).not.toBeNull()
    const [capRow] = await database.select().from(connectorCaptureWork)
    expect(capRow).toMatchObject({ status: 'scheduled', attempt: 1, connectorInstanceId: connectorId })
  })

  it('converges a duplicate enqueue by idempotency key', async () => {
    const database = await seedWorkspace()
    const { clock } = seededClock()
    const capture = await seedCapture(database, clock)
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(clock))
    expect(await provider.enqueue({ workspaceId: WS, idempotencyKey: 'k', ownerVersion: '1', subject: providerSubject(capture.id) })).toBe(true)
    expect(await provider.enqueue({ workspaceId: WS, idempotencyKey: 'k', ownerVersion: '1', subject: providerSubject(capture.id) })).toBe(false)
    expect((await database.select().from(providerUrlResolutionWork)).length).toBe(1)
  })

  it('claims only due work and completing a claim finalizes it and clears the schedule', async () => {
    const database = await seedWorkspace()
    const timeline = seededClock()
    const capture = await seedCapture(database, timeline.clock)
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(timeline.clock))
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'k', ownerVersion: '1', subject: providerSubject(capture.id) })

    const claim = await provider.claimDue(timeline.clock().toISOString())
    expect(claim).toMatchObject({ attempt: 1, maxAttempts: 3 })
    if (!claim) return
    expect(claim.subject).toMatchObject({ captureId: capture.id, intermediaryUrlHash: 'sha256:intermediary-1' })
    // a second claim finds nothing else due.
    expect(await provider.claimDue(timeline.clock().toISOString())).toBeNull()
    expect(await provider.complete({ id: claim.id, token: claim.token })).toBe(true)
    const [row] = await database.select().from(providerUrlResolutionWork)
    expect(row).toMatchObject({ status: 'completed' })
    expect(row?.nextEligibleAt).toBeNull()
    expect(await provider.nextDueAt()).toBeNull()
  })

  it('reschedules a retryable failure under shared bounded backoff and honors a server Retry-After', async () => {
    const database = await seedWorkspace()
    const timeline = seededClock()
    const capture = await seedCapture(database, timeline.clock)
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(timeline.clock))
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'k', ownerVersion: '1', subject: providerSubject(capture.id) })
    const claim = await provider.claimDue(timeline.clock().toISOString())
    if (!claim) throw new Error('expected claim')

    const outcome = await provider.fail({ id: claim.id, token: claim.token, retryReason: 'rate_limit', detail: 'throttled', serverMinimumDelayMs: 5 * 60_000 })
    expect(outcome.outcome).toBe('retry')
    const [row] = await database.select().from(providerUrlResolutionWork)
    expect(row).toMatchObject({ status: 'scheduled', attempt: 2, failureReason: 'rate_limit', failureDetail: 'throttled' })
    expect(row?.acquisitionToken).toBeNull()
    // Retry-After floors the next-eligible time at least the server minimum ahead.
    const nextMs = Date.parse(row!.nextEligibleAt!)
    expect(nextMs - timeline.nowMs()).toBeGreaterThanOrEqual(5 * 60_000)
  })

  it('exhausts only the claimed operation at its attempt budget and leaves other operations scheduled', async () => {
    const database = await seedWorkspace()
    const timeline = seededClock()
    const captureA = await seedCapture(database, timeline.clock)
    const captureB = await seedCapture(database, timeline.clock)
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(timeline.clock))
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'a', ownerVersion: '1', subject: providerSubject(captureA.id, 'a'), maxAttempts: 1 })
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'b', ownerVersion: '1', subject: providerSubject(captureB.id, 'b'), maxAttempts: 3 })

    const claim = await provider.claimDue(timeline.clock().toISOString())
    if (!claim) throw new Error('expected claim')
    const outcome = await provider.fail({ id: claim.id, token: claim.token, retryReason: 'server_failure' })
    expect(outcome.outcome).toBe('exhausted')

    const rows = await database.select().from(providerUrlResolutionWork)
    const exhausted = rows.find((r) => r.id === claim.id)
    const other = rows.find((r) => r.id !== claim.id)
    expect(exhausted).toMatchObject({ status: 'exhausted' })
    expect(exhausted?.nextEligibleAt).toBeNull()
    expect(other).toMatchObject({ status: 'scheduled' })
    expect(other?.nextEligibleAt).not.toBeNull()
  })

  it('marks a deterministic failure terminal without affecting the retry budget of other work', async () => {
    const database = await seedWorkspace()
    const timeline = seededClock()
    const capture = await seedCapture(database, timeline.clock)
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(timeline.clock))
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'k', ownerVersion: '1', subject: providerSubject(capture.id) })
    const claim = await provider.claimDue(timeline.clock().toISOString())
    if (!claim) throw new Error('expected claim')
    const outcome = await provider.fail({ id: claim.id, token: claim.token, deterministicReason: 'security_rejected', detail: 'blocked host' })
    expect(outcome.outcome).toBe('terminal')
    const [row] = await database.select().from(providerUrlResolutionWork)
    expect(row).toMatchObject({ status: 'terminal', failureReason: 'security_rejected' })
    expect(row?.nextEligibleAt).toBeNull()
  })

  it('claims one due operation once across concurrent scheduler drains', async () => {
    const database = await seedWorkspace()
    const timeline = seededClock()
    const capture = await seedCapture(database, timeline.clock)
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(timeline.clock))
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'k', ownerVersion: '1', subject: providerSubject(capture.id) })
    const due = timeline.clock().toISOString()
    const [a, b] = await Promise.all([provider.claimDue(due), provider.claimDue(due)])
    expect([a, b].filter((c) => c !== null).length).toBe(1)
  })

  it('resumes overdue claimed work after reopen without duplicate execution', async () => {
    const database = await seedWorkspace()
    const timeline = seededClock()
    const capture = await seedCapture(database, timeline.clock)
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(timeline.clock))
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'k', ownerVersion: '1', subject: providerSubject(capture.id) })
    const claim = await provider.claimDue(timeline.clock().toISOString())
    if (!claim) throw new Error('expected claim')
    // simulate a shutdown mid-claim: the process dies before complete/fail.
    const recovered = await provider.recoverClaimed(timeline.clock().toISOString())
    expect(recovered).toBe(1)
    const [row] = await database.select().from(providerUrlResolutionWork)
    expect(row).toMatchObject({ status: 'scheduled' })
    expect(row?.acquisitionToken).toBeNull()
    // reopen re-claims exactly once; the stale token can no longer complete it.
    const reclaim = await provider.claimDue(timeline.clock().toISOString())
    expect(reclaim).not.toBeNull()
    expect(await provider.complete({ id: claim.id, token: claim.token })).toBe(false)
    if (reclaim) expect(await provider.complete({ id: reclaim.id, token: reclaim.token })).toBe(true)
  })

  it('does not return future-eligible work until it is due', async () => {
    const database = await seedWorkspace()
    const timeline = seededClock()
    const capture = await seedCapture(database, timeline.clock)
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(timeline.clock))
    const future = new Date(timeline.nowMs() + 3_600_000).toISOString()
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'k', ownerVersion: '1', subject: providerSubject(capture.id), eligibleAt: future })
    expect(await provider.claimDue(timeline.clock().toISOString())).toBeNull()
    expect(await provider.nextDueAt()).toBe(future)
    timeline.set(timeline.nowMs() + 3_600_000)
    expect(await provider.claimDue(timeline.clock().toISOString())).not.toBeNull()
  })

  it('separates attempt budgets so exhausting one operation does not exhaust or complete another', async () => {
    const database = await seedWorkspace()
    const timeline = seededClock()
    const capture = await seedCapture(database, timeline.clock)
    const connectorId = await seedConnector(database, 'connector-one')
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(timeline.clock))
    const normalization = createScheduledWorkRepository(database, normalizationOperation, options(timeline.clock))
    const connector = createScheduledWorkRepository(database, connectorCaptureOperation, options(timeline.clock))

    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'p', ownerVersion: '1', subject: providerSubject(capture.id), maxAttempts: 1 })
    await normalization.enqueue({ workspaceId: WS, idempotencyKey: 'n', ownerVersion: '1', subject: { captureId: capture.id, captureRevision: capture.revision, resolverId: 'norm', resolverVersion: 'norm@1', inputHash: 'sha256:norm' } })
    await connector.enqueue({ workspaceId: WS, idempotencyKey: 'c', ownerVersion: '1', subject: { connectorInstanceId: connectorId, filterSignature: 'sig', checkpointSchemaVersion: 'v1', checkpointGeneration: 'g1' } })

    const claim = await provider.claimDue(timeline.clock().toISOString())
    if (!claim) throw new Error('expected claim')
    await provider.fail({ id: claim.id, token: claim.token, retryReason: 'operation_timeout' })

    // provider exhausted, but normalization + connector remain independently claimable.
    expect((await provider.claimDue(timeline.clock().toISOString()))).toBeNull()
    expect(await normalization.claimDue(timeline.clock().toISOString())).not.toBeNull()
    expect(await connector.claimDue(timeline.clock().toISOString())).not.toBeNull()
  })

  it('keeps provider URL resolution on its own table, never writing hosted submission or polling work', async () => {
    const database = await seedWorkspace()
    const timeline = seededClock()
    const capture = await seedCapture(database, timeline.clock)
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(timeline.clock))
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'k', ownerVersion: '1', subject: providerSubject(capture.id) })
    const claim = await provider.claimDue(timeline.clock().toISOString())
    if (claim) await provider.complete({ id: claim.id, token: claim.token })
    expect((await database.select().from(hostedSubmissionWork)).length).toBe(0)
    expect((await database.select().from(hostedResultPollingWork)).length).toBe(0)
    // the intermediary hash is preserved as durable evidence on the provider row.
    const [row] = await database.select().from(providerUrlResolutionWork).where(eq(providerUrlResolutionWork.captureId, capture.id))
    expect(row?.intermediaryUrlHash).toBe('sha256:intermediary-1')
  })

  it('drains due work through the app-wide scheduler while the app is open (AC3/AC6 lifecycle)', async () => {
    const database = await seedWorkspace()
    const timeline = seededClock()
    const captureA = await seedCapture(database, timeline.clock)
    const captureB = await seedCapture(database, timeline.clock)
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(timeline.clock))
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'a', ownerVersion: '1', subject: providerSubject(captureA.id, 'a') })
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'b', ownerVersion: '1', subject: providerSubject(captureB.id, 'b') })

    const executed: string[] = []
    const source = createScheduledWorkSource({
      id: 'provider_url_resolution',
      repository: provider,
      now: timeline.clock,
      execute: async (work) => { executed.push(work.subject.captureId); await provider.complete({ id: work.id, token: work.token }) },
    })
    const scheduler = createLocalScheduler({ now: timeline.clock, setTimeout: () => 0, clearTimeout: () => {} })
    scheduler.register(source)
    scheduler.start()
    await scheduler.whenIdle()
    await scheduler.stop()

    expect(executed.sort()).toEqual([captureA.id, captureB.id].sort())
    expect(await provider.nextDueAt()).toBeNull()
    expect((await database.select().from(providerUrlResolutionWork)).every((r) => r.status === 'completed')).toBe(true)
  })

  it('recovers an orphaned claim at reopen and re-dispatches it exactly once (AC3 restart)', async () => {
    const database = await seedWorkspace()
    const timeline = seededClock()
    const capture = await seedCapture(database, timeline.clock)
    const provider = createScheduledWorkRepository(database, providerUrlResolutionOperation, options(timeline.clock))
    await provider.enqueue({ workspaceId: WS, idempotencyKey: 'k', ownerVersion: '1', subject: providerSubject(capture.id) })
    // first "session" claims but the process dies before completing.
    const orphaned = await provider.claimDue(timeline.clock().toISOString())
    expect(orphaned).not.toBeNull()

    // reopen: recover orphaned claims, then let the scheduler run the source once.
    expect(await provider.recoverClaimed(timeline.clock().toISOString())).toBe(1)
    const executed: string[] = []
    const source = createScheduledWorkSource({
      id: 'provider_url_resolution',
      repository: provider,
      now: timeline.clock,
      execute: async (work) => { executed.push(work.id); await provider.complete({ id: work.id, token: work.token }) },
    })
    const scheduler = createLocalScheduler({ now: timeline.clock, setTimeout: () => 0, clearTimeout: () => {} })
    scheduler.register(source)
    scheduler.start()
    await scheduler.whenIdle()
    await scheduler.stop()

    expect(executed.length).toBe(1)
    // the stale first-session token can no longer complete the re-claimed record.
    if (orphaned) expect(await provider.complete({ id: orphaned.id, token: orphaned.token })).toBe(false)
    const [row] = await database.select().from(providerUrlResolutionWork)
    expect(row?.status).toBe('completed')
  })
})
