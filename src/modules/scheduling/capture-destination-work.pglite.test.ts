import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { workspaces } from '../../db/workspaces.schema'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { createCaptureMaterializationService } from '../capture/capture.materialization'
import { createCaptureDestinationResolutionService } from '../capture/capture.destination-resolution'
import { createCaptureResolutionService } from '../capture/capture.resolution'
import { createPgliteCaptureService } from '../capture/capture.service'
import {
  captureResolutionGenerations,
  captureResolutionStageResults,
} from '../capture/capture.schema'
import { captureDestinationResolutionWork } from './scheduling.schema'
import {
  createCaptureDestinationWorkExecutor,
  createCaptureDestinationWorkRepository,
  enqueueCaptureDestinationWork,
  reconcileCaptureDestinationWork,
} from './capture-destination-work'
import { providerUrlResolutionWork } from './scheduling.schema'
import { retireProviderUrlResolutionWork } from './provider-url-resolution-retirement'

const resettableOwner = useResettablePgliteTestOwner()
const WORKSPACE = 'destination-resolution-workspace'
const RESOLVER = { id: 'jobright.provider-url', version: 'jobright-provider-url@1' }

function seededClock(startMs = Date.UTC(2026, 6, 23, 0, 0, 0)) {
  let current = startMs
  return {
    now: () => new Date(current),
    advance: (milliseconds: number) => { current += milliseconds },
    nowMs: () => current,
  }
}

async function setup(options: { resolverAvailable?: boolean } = {}) {
  const { database } = resettableOwner()
  const clock = seededClock()
  await database.insert(workspaces).values({
    id: WORKSPACE,
    name: WORKSPACE,
    createdAt: clock.now().toISOString(),
    updatedAt: clock.now().toISOString(),
  })
  const captures = createPgliteCaptureService(database, { now: clock.now })
  const accepted = await captures.accept({
    workspaceId: WORKSPACE,
    provenance: {
      adapterId: 'jobright.resolver',
      adapterKind: 'connector',
      adapterVersion: '0.18.1',
      providerRecordId: 'provider-record-1',
      providerSchema: 'jobright.v1',
      observedAt: clock.now().toISOString(),
    },
    connectorProvenance: {
      connectorInstanceId: 'jobright-default',
      connectorRunId: 'jobright-run-1',
      executionScopeId: 'jobright-default-scope',
      reportedOrigin: { kind: 'job_board', name: 'Jobright' },
    },
    evidenceMode: 'reported',
    evidence: [{ kind: 'title', label: 'Role', value: 'Engineer' }],
    actor: { id: 'jobright-default', type: 'system' },
  })
  if (!accepted.ok) throw new Error(accepted.message)
  const materialization = createCaptureMaterializationService(database, { now: clock.now })
  const repository = createCaptureDestinationWorkRepository(database, { workspaceId: WORKSPACE, now: clock.now })
  const destination = createCaptureDestinationResolutionService({
    database,
    materialization,
    publisher: { enqueue: (identity) => enqueueCaptureDestinationWork(repository, identity) },
    selectResolver: () => options.resolverAvailable === false ? null : RESOLVER,
    workspaceId: WORKSPACE,
    now: clock.now,
  })
  await destination.scheduleAcknowledged(accepted.capture.id)
  const [generation] = await database.select().from(captureResolutionGenerations)
    .where(eq(captureResolutionGenerations.captureId, accepted.capture.id))
  if (!generation) throw new Error('expected Capture resolution generation')
  return { captureId: accepted.capture.id, clock, database, destination, generation, materialization, repository }
}

async function claim(repository: Awaited<ReturnType<typeof setup>>['repository'], now: Date) {
  const work = await repository.claimDue(now.toISOString())
  if (!work) throw new Error('expected due destination work')
  return work
}

async function destinationStage(database: Awaited<ReturnType<typeof setup>>['database'], generationId: string) {
  const [stage] = await database.select().from(captureResolutionStageResults).where(eq(
    captureResolutionStageResults.generationId,
    generationId,
  ))
  if (!stage) throw new Error('expected destination stage')
  return stage
}

describe.sequential('Capture destination resolution durable work (#362)', () => {
  it('makes a missing exact resolver actionable instead of silently skipping it', async () => {
    const { database, generation } = await setup({ resolverAvailable: false })
    expect(await destinationStage(database, generation.id)).toMatchObject({
      status: 'action_required',
      issueJson: expect.stringContaining('destination_unsupported'),
    })
    expect(await database.select().from(captureDestinationResolutionWork)).toEqual([])
  })

  it('uses the exact seven-attempt 2/4/8/16/32/60 second recovery schedule', async () => {
    const { clock, database, destination, generation, repository } = await setup()
    const executor = createCaptureDestinationWorkExecutor({
      repository,
      state: destination,
      execute: async () => ({ status: 'retryable', reason: 'rate_limited', retryReason: 'rate_limit' }),
    })
    const delays = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000]

    for (let attempt = 1; attempt <= 7; attempt += 1) {
      const work = await claim(repository, clock.now())
      expect(work).toMatchObject({ attempt, maxAttempts: 7, workspaceId: WORKSPACE })
      await executor(work)
      const [row] = await database.select().from(captureDestinationResolutionWork)
      if (attempt < 7) {
        expect(row).toMatchObject({ status: 'scheduled', attempt: attempt + 1 })
        expect(Date.parse(row!.nextEligibleAt!) - clock.nowMs()).toBe(delays[attempt - 1])
        clock.advance(delays[attempt - 1]!)
      } else {
        expect(row).toMatchObject({ status: 'exhausted', attempt: 7, nextEligibleAt: null })
      }
    }

    expect(await destinationStage(database, generation.id)).toMatchObject({
      status: 'exhausted',
      attemptCount: 7,
      nextAttemptAt: null,
    })
  })

  it('honors a server minimum beyond the snapshot cap without changing the durable policy', async () => {
    const { clock, database, destination, repository } = await setup()
    const executor = createCaptureDestinationWorkExecutor({
      repository,
      state: destination,
      execute: async () => ({
        status: 'retryable', reason: 'rate_limited', retryReason: 'rate_limit', serverMinimumDelayMs: 120_000,
      }),
    })
    await executor(await claim(repository, clock.now()))
    const [row] = await database.select().from(captureDestinationResolutionWork)
    expect(Date.parse(row!.nextEligibleAt!) - clock.nowMs()).toBe(120_000)
    expect(row).toMatchObject({
      attempt: 2,
      retryDelay1Ms: 2_000,
      retryDelay2Ms: 4_000,
      retryDelay3Ms: 8_000,
      retryDelay4Ms: 16_000,
      retryDelay5Ms: 32_000,
      retryDelay6Ms: 60_000,
    })
  })

  it('uses the durable row policy and never sees another workspace work queue', async () => {
    const { clock, database, repository } = await setup()
    const [row] = await database.select().from(captureDestinationResolutionWork)
    if (!row) throw new Error('expected destination work')
    await database.insert(workspaces).values({
      id: 'other-destination-workspace', name: 'other-destination-workspace',
      createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString(),
    })
    await database.update(captureDestinationResolutionWork).set({
      workspaceId: 'other-destination-workspace', retryDelay1Ms: 13_000,
    }).where(eq(captureDestinationResolutionWork.id, row.id))
    const other = createCaptureDestinationWorkRepository(database, {
      workspaceId: 'other-destination-workspace', now: clock.now,
    })
    expect(await repository.nextDueAt()).toBeNull()
    expect(await repository.claimDue(clock.now().toISOString())).toBeNull()
    const claimed = await claim(other, clock.now())
    expect(await repository.recoverClaimed(clock.now().toISOString())).toBe(0)
    expect(await other.recoverClaimed(clock.now().toISOString())).toBe(1)
    const recovered = await claim(other, clock.now())
    expect(recovered.attempt).toBe(claimed.attempt)
    expect(recovered.subject.retryDelay1Ms).toBe(13_000)
  })

  it('retires pending legacy provider URL work without touching new destination work', async () => {
    const { clock, database, generation } = await setup()
    await database.insert(providerUrlResolutionWork).values({
      id: 'legacy-provider-url-work', workspaceId: WORKSPACE, idempotencyKey: 'legacy-provider-url-work',
      captureId: generation.captureId, resolverId: RESOLVER.id, resolverVersion: RESOLVER.version,
      intermediaryUrlHash: 'a'.repeat(64), attempt: 1, maxAttempts: 3, status: 'scheduled',
      nextEligibleAt: clock.now().toISOString(), failureReason: null, failureDetail: null,
      ownerVersion: RESOLVER.version, acquisitionToken: null, claimedAt: null, claimExpiresAt: null,
      createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString(),
    })
    expect(await retireProviderUrlResolutionWork(database, WORKSPACE, clock.now().toISOString())).toBe(1)
    const [legacy] = await database.select().from(providerUrlResolutionWork)
    expect(legacy).toMatchObject({ status: 'cancelled', nextEligibleAt: null })
    expect(await retireProviderUrlResolutionWork(database, WORKSPACE, clock.now().toISOString())).toBe(0)
  })

  it('recovers an orphaned claim and projects the safe resolved destination once', async () => {
    const { captureId, clock, database, destination, generation, materialization, repository } = await setup()
    const firstClaim = await claim(repository, clock.now())
    expect(await repository.recoverClaimed(clock.now().toISOString())).toBe(1)
    expect(await repository.complete({ id: firstClaim.id, token: firstClaim.token })).toBe(false)

    let executions = 0
    const executor = createCaptureDestinationWorkExecutor({
      repository,
      state: destination,
      execute: async () => {
        executions += 1
        return { status: 'resolved', url: 'https://careers.example.com/jobs/123', method: 'employer_direct' }
      },
    })
    await executor(await claim(repository, clock.now()))

    expect(executions).toBe(1)
    expect(await destinationStage(database, generation.id)).toMatchObject({
      status: 'resolved',
      resultJson: JSON.stringify({ url: 'https://careers.example.com/jobs/123', method: 'employer_direct' }),
    })
    const resolution = createCaptureResolutionService(database, {
      workspaceId: WORKSPACE,
      materialization,
      destination,
    })
    await expect(resolution.get(captureId)).resolves.toMatchObject({
      destination: { status: 'resolved', url: 'https://careers.example.com/jobs/123' },
    })
  })

  it('validates with URL parsing but persists the exact resolver-emitted destination string', async () => {
    const { captureId, clock, database, destination, generation, materialization, repository } = await setup()
    const emittedUrl = 'https://CAREERS.Example.com:443'
    const executor = createCaptureDestinationWorkExecutor({
      repository,
      state: destination,
      execute: async () => ({ status: 'resolved', url: emittedUrl, method: 'employer_direct' }),
    })
    await executor(await claim(repository, clock.now()))
    expect(await destinationStage(database, generation.id)).toMatchObject({
      resultJson: JSON.stringify({ url: emittedUrl, method: 'employer_direct' }),
    })
    const resolution = createCaptureResolutionService(database, {
      workspaceId: WORKSPACE,
      materialization,
      destination,
    })
    await expect(resolution.get(captureId)).resolves.toMatchObject({
      destination: { status: 'resolved', url: emittedUrl },
    })
  })

  it('repairs a crash after rescheduling work but before the stage projection', async () => {
    const { clock, database, destination, generation, repository } = await setup()
    const work = await claim(repository, clock.now())
    const context = await destination.start({
      workspaceId: work.workspaceId, captureId: work.subject.captureId, captureRevision: work.subject.captureRevision,
      generationId: work.subject.generationId, id: work.subject.resolverId, version: work.subject.resolverVersion,
      inputFingerprint: work.subject.inputFingerprint,
      retryPolicy: { maximumAttempts: work.maxAttempts, retryDelaysMs: [
        work.subject.retryDelay1Ms, work.subject.retryDelay2Ms, work.subject.retryDelay3Ms,
        work.subject.retryDelay4Ms, work.subject.retryDelay5Ms, work.subject.retryDelay6Ms,
      ] },
    }, work.attempt)
    expect(context).not.toBeNull()
    const failed = await repository.fail({ id: work.id, token: work.token, retryReason: 'server_failure' })
    expect(failed).toMatchObject({ outcome: 'retry' })
    expect(await destinationStage(database, generation.id)).toMatchObject({ status: 'running' })
    await reconcileCaptureDestinationWork(database, WORKSPACE, destination)
    expect(await destinationStage(database, generation.id)).toMatchObject({
      status: 'retry_wait', attemptCount: 1,
      nextAttemptAt: failed.outcome === 'retry' ? failed.nextEligibleAt : null,
    })
  })

  it.each([
    ['intermediary host', 'https://jobright.ai/jobs/123'],
    ['localhost', 'https://localhost/jobs/123'],
    ['private IPv4', 'https://10.0.0.8/jobs/123'],
    ['IPv6 literal', 'https://[::1]/jobs/123'],
    ['special-use suffix', 'https://careers.example.test/jobs/123'],
    ['sensitive query', 'https://careers.example.com/jobs/123?X-Amz-Signature=destination-secret-canary'],
  ])('blocks %s provider output without persisting it', async (_label, url) => {
    const { clock, database, destination, generation, repository } = await setup()
    const canary = 'destination-secret-canary'
    const executor = createCaptureDestinationWorkExecutor({
      repository,
      state: destination,
      execute: async () => ({
        status: 'resolved',
        url,
        method: 'jobright_api_detail_employer_or_ats',
      }),
    })
    await executor(await claim(repository, clock.now()))

    const [work] = await database.select().from(captureDestinationResolutionWork)
    const stage = await destinationStage(database, generation.id)
    expect(work).toMatchObject({ status: 'terminal', failureReason: 'security_rejected' })
    expect(stage).toMatchObject({ status: 'blocked', resultJson: '{}' })
    expect(stage.issueJson).toContain('destination_security_rejected')
    expect(JSON.stringify({ work, stage })).not.toContain(canary)
  })

  it('creates successor generations only from a current terminal destination command', async () => {
    const { captureId, clock, database, destination, generation, repository } = await setup()
    const executor = createCaptureDestinationWorkExecutor({
      repository,
      state: destination,
      execute: async () => ({ status: 'terminal', reason: 'provider_record_invalid' }),
    })
    await executor(await claim(repository, clock.now()))

    const retryInput = {
      captureId,
      expectedCaptureRevision: 1,
      expectedGenerationId: generation.id,
      idempotencyKey: 'retry-destination-once',
      actor: { id: 'operator', type: 'user' },
    } as const
    const [retry, retryRepeat] = await Promise.all([
      destination.retry(retryInput),
      destination.retry(retryInput),
    ])
    expect(retry).toMatchObject({ status: 'started', captureRevision: 1 })
    if (retry.status !== 'started') throw new Error('expected retry successor')
    expect(retryRepeat).toEqual(retry)
    await executor(await claim(repository, clock.now()))
    const replay = await destination.replay({
      captureId,
      expectedCaptureRevision: 1,
      expectedGenerationId: retry.generationId,
      idempotencyKey: 'replay-destination-once',
      actor: { id: 'operator', type: 'user' },
      rationale: 'Rerun the terminal destination resolution.',
    })
    expect(replay).toMatchObject({ status: 'started', captureRevision: 1 })
    if (replay.status !== 'started') throw new Error('expected replay successor')
    expect(await destination.replay({
      captureId,
      expectedCaptureRevision: 1,
      expectedGenerationId: generation.id,
      idempotencyKey: 'stale-replay',
      actor: { id: 'operator', type: 'user' },
      rationale: 'Investigate a stale generation.',
    })).toMatchObject({ status: 'blocked', currentGenerationId: replay.generationId })

    const generations = await database.select({
      id: captureResolutionGenerations.id,
      status: captureResolutionGenerations.status,
      trigger: captureResolutionGenerations.trigger,
    }).from(captureResolutionGenerations).where(eq(captureResolutionGenerations.captureId, captureId))
    expect(generations).toEqual(expect.arrayContaining([
      { id: generation.id, status: 'superseded', trigger: 'intake' },
      { id: retry.generationId, status: 'superseded', trigger: 'retry_destination' },
      { id: replay.generationId, status: 'active', trigger: 'replay' },
    ]))
    const [work] = await database.select().from(captureDestinationResolutionWork)
      .where(eq(captureDestinationResolutionWork.generationId, replay.generationId))
    expect(work).toMatchObject({ status: 'scheduled', attempt: 1, maxAttempts: 7 })
  })
})
