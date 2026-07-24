/**
 * Normalization work contract — focused proofs for the Jobright provider-field slice (#325).
 *
 * Exercises the canonical `normalization_work` identity (Capture id/revision + resolver
 * id/version + input hash), the Capture-owned executor (load exact revision input, run the pure
 * resolver, persist bounded outcomes idempotently, complete), restart recovery without duplicate
 * outcomes, and startup reconciliation (cancel obsolete active resolver-version work, idempotently
 * enqueue every eligible Jobright revision with available immutable input, skip unavailable input).
 */
import { describe, expect, it } from 'vitest'
import { createJobrightProviderFieldResolver } from '@sparxie/valedictorian-connectors-jobright'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { workspaces } from '../../db/workspaces.schema'
import { createPgliteCaptureService } from '../capture/capture.service'
import { createCaptureFieldOutcomeStore } from '../capture/capture.field-outcomes'
import { captureFieldOutcomes } from '../capture/capture.schema'
import { normalizationWork } from './scheduling.schema'
import {
  createNormalizationExecutor,
  createNormalizationWorkRepository,
  cancelObsoleteActiveNormalizationWork,
  enqueueNormalizationWork,
  reconcileNormalizationWork,
} from './normalization-work'

const resettableOwner = useResettablePgliteTestOwner()
const WS = 'ws-norm'
const ACTOR = { type: 'system' } as const
const RESOLVER_ID = 'jobright.provider-fields'
const RESOLVER_VERSION = 'jobright-provider-fields@2'
const ADAPTER_ID = 'jobright.resolver'
const PROVIDER_SCHEMA = 'jobright-authenticated-search@1'

function seededClock(startMs = Date.UTC(2026, 6, 22, 0, 0, 0)) {
  let current = startMs
  return { clock: () => new Date(current), advance: (ms: number) => { current += ms } }
}

type Database = Awaited<ReturnType<typeof seedWorkspace>>

async function seedWorkspace(workspaceIds: readonly string[] = [WS]) {
  const { database } = resettableOwner()
  await database.insert(workspaces).values(workspaceIds.map((id) => ({ id, name: id, createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z' })))
  return database
}

/** Accept a Jobright connector capture whose payload carries the given provider jobResult. */
async function seedJobrightCapture(
  database: Database,
  clock: () => Date,
  jobResult: Record<string, unknown>,
  recordId: string,
  workspaceId = WS,
  providerSchema = PROVIDER_SCHEMA,
) {
  const captures = createPgliteCaptureService(database, { now: clock })
  const accepted = await captures.accept({
    workspaceId,
    provenance: { adapterId: ADAPTER_ID, adapterKind: 'connector', adapterVersion: '0.18.1', providerRecordId: recordId, providerSchema, observedAt: '2026-07-22T10:00:00.000Z' },
    evidenceMode: 'reported',
    evidence: [{ kind: 'provider_api_record', label: 'Jobright row', value: { providerRecordId: recordId } }],
    payload: { providerRow: { jobResult: { jobId: recordId, ...jobResult } } },
    connectorProvenance: { connectorInstanceId: 'instance-1', connectorRunId: 'run-1', executionScopeId: 'connector.jobright-test', reportedOrigin: { kind: 'aggregator', name: 'Jobright', providerId: 'jobright' } },
    actor: ACTOR,
  })
  if (!accepted.ok || !accepted.connectorRevision) throw new Error(`capture accept failed: ${accepted.ok ? 'no revision' : `${accepted.code}: ${accepted.message}`}`)
  return { capture: accepted.capture, contentHash: accepted.connectorRevision.contentHash, revision: accepted.connectorRevision.revision }
}

function wiring(database: Database, clock: () => Date, workspaceId = WS) {
  const fieldOutcomes = createCaptureFieldOutcomeStore(database)
  const repository = createNormalizationWorkRepository(database, { now: clock })
  const resolver = createJobrightProviderFieldResolver()
  const executor = createNormalizationExecutor({ database, fieldOutcomes, getResolver: () => resolver, repository, workspaceId, now: clock })
  return { fieldOutcomes, repository, resolver, executor }
}

function enqueueFor(repository: ReturnType<typeof createNormalizationWorkRepository>, seeded: { capture: { id: string }; revision: number; contentHash: string }, workspaceId = WS) {
  return enqueueNormalizationWork(repository, {
    workspaceId, captureId: seeded.capture.id, captureRevision: seeded.revision,
    resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, inputHash: seeded.contentHash,
  })
}

async function runDueOnce(repository: ReturnType<typeof createNormalizationWorkRepository>, executor: (work: { id: string; token: string; subject: { captureId: string; captureRevision: number; resolverId: string; resolverVersion: string; inputHash: string } }) => Promise<void>, clock: () => Date) {
  const claim = await repository.claimDue(clock().toISOString())
  if (!claim) return false
  await executor(claim)
  return true
}

describe.sequential('Normalization work contract (#325)', () => {
  it('binds work identity to Capture id/revision, resolver id/version, and input hash, then resolves US evidence', async () => {
    const database = await seedWorkspace()
    const { clock } = seededClock()
    const seeded = await seedJobrightCapture(database, clock, { jobLocation: 'San Francisco, CA, United States' }, 'rec-us')
    const { fieldOutcomes, repository, executor } = wiring(database, clock)

    expect(await enqueueFor(repository, seeded)).toBe(true)
    const [row] = await database.select().from(normalizationWork)
    expect(row).toMatchObject({ captureId: seeded.capture.id, captureRevision: seeded.revision, resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, inputHash: seeded.contentHash, status: 'scheduled' })

    expect(await runDueOnce(repository, executor, clock)).toBe(true)
    const [completed] = await database.select().from(normalizationWork)
    expect(completed?.status).toBe('completed')

    expect(await fieldOutcomes.readResolvedLocation(database, WS, seeded.capture.id, seeded.revision, RESOLVER_ID, RESOLVER_VERSION))
      .toEqual({ country: 'US', display: 'San Francisco, CA, United States', city: null, region: null })
  })

  it('persists outcomes idempotently: a re-run after completion produces no duplicate outcomes', async () => {
    const database = await seedWorkspace()
    const { clock } = seededClock()
    const seeded = await seedJobrightCapture(database, clock, { jobLocation: 'Toronto, Ontario, Canada' }, 'rec-ca')
    const { fieldOutcomes, repository, executor, resolver } = wiring(database, clock)
    await enqueueFor(repository, seeded)
    await runDueOnce(repository, executor, clock)
    const countAfterFirst = (await database.select().from(captureFieldOutcomes)).length
    expect(countAfterFirst).toBeGreaterThan(0)

    const input = await fieldOutcomes.loadRevisionInput(WS, seeded.capture.id, seeded.revision)
    expect(input).not.toBeNull()
    if (!input) return
    const outcomes = resolver.resolve({
      captureRevision: { id: `${seeded.capture.id}:${seeded.revision}`, captureId: seeded.capture.id, revision: seeded.revision, contentHash: input.contentHash, reused: false, createdAt: clock().toISOString() },
      adapter: { id: input.adapter.id, kind: 'connector', version: input.adapter.version },
      providerSchema: input.providerSchema,
      payload: input.payload,
    })
    const inserted = await fieldOutcomes.persistOutcomes(database, { captureId: seeded.capture.id, captureRevision: seeded.revision, resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, inputHash: input.contentHash, outcomes, createdAt: clock().toISOString() })
    expect(inserted).toBe(0)
    expect((await database.select().from(captureFieldOutcomes)).length).toBe(countAfterFirst)
    expect(await fieldOutcomes.readResolvedLocation(database, WS, seeded.capture.id, seeded.revision, RESOLVER_ID, RESOLVER_VERSION)).toMatchObject({ country: 'CA' })
  })

  it('keeps conflicting, country-free, and remote-only evidence unknown (no resolved US/CA location)', async () => {
    const database = await seedWorkspace()
    const { clock } = seededClock()
    const { fieldOutcomes, repository, executor } = wiring(database, clock)

    const cases = [
      await seedJobrightCapture(database, clock, { jobLocations: ['New York, US', 'Toronto, Canada'] }, 'rec-conflict'),
      await seedJobrightCapture(database, clock, { jobLocation: 'Remote' }, 'rec-remote'),
      await seedJobrightCapture(database, clock, { jobLocation: 'San Francisco, CA' }, 'rec-countryfree'),
    ]
    for (const seeded of cases) {
      await enqueueFor(repository, seeded)
      await runDueOnce(repository, executor, clock)
      expect(await fieldOutcomes.readResolvedLocation(database, WS, seeded.capture.id, seeded.revision, RESOLVER_ID, RESOLVER_VERSION)).toBeNull()
    }
  })

  it('restart recovery re-dispatches an orphaned claim exactly once without duplicate outcomes', async () => {
    const database = await seedWorkspace()
    const { clock } = seededClock()
    const seeded = await seedJobrightCapture(database, clock, { jobLocation: 'Seattle, WA, USA' }, 'rec-restart')
    const { fieldOutcomes, repository, executor } = wiring(database, clock)
    await enqueueFor(repository, seeded)

    const claim = await repository.claimDue(clock().toISOString())
    expect(claim).not.toBeNull()
    expect(await repository.recoverClaimed(clock().toISOString())).toBe(1)
    expect(await runDueOnce(repository, executor, clock)).toBe(true)
    const count = (await database.select().from(captureFieldOutcomes)).length
    await runDueOnce(repository, executor, clock)
    expect((await database.select().from(captureFieldOutcomes)).length).toBe(count)
    expect(await fieldOutcomes.readResolvedLocation(database, WS, seeded.capture.id, seeded.revision, RESOLVER_ID, RESOLVER_VERSION)).toMatchObject({ country: 'US' })
  })

  it('fails a claimed row whose resolver identity does not match the loaded resolver', async () => {
    const database = await seedWorkspace()
    const { clock } = seededClock()
    const seeded = await seedJobrightCapture(database, clock, { jobLocation: 'Denver, CO, United States' }, 'rec-mismatch')
    const { repository, executor } = wiring(database, clock)
    await enqueueNormalizationWork(repository, {
      workspaceId: WS,
      captureId: seeded.capture.id,
      captureRevision: seeded.revision,
      resolverId: RESOLVER_ID,
      resolverVersion: 'jobright-provider-fields@stale',
      inputHash: seeded.contentHash,
    })

    expect(await runDueOnce(repository, executor, clock)).toBe(true)
    const [row] = await database.select().from(normalizationWork)
    expect(row).toMatchObject({
      status: 'terminal',
      failureReason: 'invalid_target',
      failureDetail: 'resolver_identity_mismatch',
    })
    expect(await database.select().from(captureFieldOutcomes)).toEqual([])
  })

  it('skips unsupported provider schemas during replay and fails closed if one is claimed', async () => {
    const database = await seedWorkspace()
    const { clock } = seededClock()
    const seeded = await seedJobrightCapture(
      database,
      clock,
      { jobLocation: 'Denver, CO, United States' },
      'rec-unsupported-schema',
      WS,
      'unsupported-schema@1',
    )
    const { fieldOutcomes, repository, executor } = wiring(database, clock)

    const replay = await reconcileNormalizationWork({
      database,
      fieldOutcomes,
      repository,
      workspaceId: WS,
      adapterId: ADAPTER_ID,
      resolverId: RESOLVER_ID,
      resolverVersion: RESOLVER_VERSION,
      supportedProviderSchemas: [PROVIDER_SCHEMA],
      now: clock,
    })
    expect(replay.enqueued).toBe(0)

    await enqueueFor(repository, seeded)
    expect(await runDueOnce(repository, executor, clock)).toBe(true)
    const [row] = await database.select().from(normalizationWork)
    expect(row).toMatchObject({
      status: 'terminal',
      failureReason: 'invalid_target',
      failureDetail: 'resolver_not_applicable',
    })
    expect(await database.select().from(captureFieldOutcomes)).toEqual([])
  })

  it('cancels obsolete work only for the requested workspace and resolver', async () => {
    const otherWorkspace = 'ws-norm-other'
    const database = await seedWorkspace([WS, otherWorkspace])
    const { clock } = seededClock()
    const target = await seedJobrightCapture(database, clock, { jobLocation: 'Boston, MA, United States' }, 'rec-scope-target')
    const otherResolver = await seedJobrightCapture(database, clock, { jobLocation: 'Austin, TX, United States' }, 'rec-scope-resolver')
    const otherWorkspaceCapture = await seedJobrightCapture(database, clock, { jobLocation: 'Toronto, Canada' }, 'rec-scope-workspace', otherWorkspace)
    const { repository } = wiring(database, clock)
    const staleVersion = 'jobright-provider-fields@1'

    await enqueueNormalizationWork(repository, { workspaceId: WS, captureId: target.capture.id, captureRevision: target.revision, resolverId: RESOLVER_ID, resolverVersion: staleVersion, inputHash: target.contentHash })
    await enqueueNormalizationWork(repository, { workspaceId: WS, captureId: otherResolver.capture.id, captureRevision: otherResolver.revision, resolverId: 'another.resolver', resolverVersion: staleVersion, inputHash: otherResolver.contentHash })
    await enqueueNormalizationWork(repository, { workspaceId: otherWorkspace, captureId: otherWorkspaceCapture.capture.id, captureRevision: otherWorkspaceCapture.revision, resolverId: RESOLVER_ID, resolverVersion: staleVersion, inputHash: otherWorkspaceCapture.contentHash })

    expect(await cancelObsoleteActiveNormalizationWork(database, WS, RESOLVER_ID, RESOLVER_VERSION, clock().toISOString())).toBe(1)
    const rows = await database.select().from(normalizationWork)
    expect(rows.find((row) => row.captureId === target.capture.id)?.status).toBe('cancelled')
    expect(rows.find((row) => row.captureId === otherResolver.capture.id)?.status).toBe('scheduled')
    expect(rows.find((row) => row.captureId === otherWorkspaceCapture.capture.id)?.status).toBe('scheduled')
  })

  it('reconciliation enqueues every eligible revision, cancels obsolete active versions, and is idempotent', async () => {
    const database = await seedWorkspace()
    const { clock } = seededClock()
    const seeded = await seedJobrightCapture(database, clock, { jobLocation: 'Boston, MA, United States' }, 'rec-replay')
    const { fieldOutcomes, repository } = wiring(database, clock)

    await enqueueNormalizationWork(repository, { workspaceId: WS, captureId: seeded.capture.id, captureRevision: seeded.revision, resolverId: RESOLVER_ID, resolverVersion: 'jobright-provider-fields@1', inputHash: seeded.contentHash })

    const result = await reconcileNormalizationWork({ database, fieldOutcomes, repository, workspaceId: WS, adapterId: ADAPTER_ID, resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, now: clock })
    expect(result.cancelled).toBe(1)
    expect(result.enqueued).toBe(1)

    const rows = await database.select().from(normalizationWork)
    expect(rows.find((r) => r.resolverVersion === 'jobright-provider-fields@1')?.status).toBe('cancelled')
    expect(rows.find((r) => r.resolverVersion === RESOLVER_VERSION)?.status).toBe('scheduled')

    const again = await reconcileNormalizationWork({ database, fieldOutcomes, repository, workspaceId: WS, adapterId: ADAPTER_ID, resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, now: clock })
    expect(again.enqueued).toBe(0)
  })

  it('makes a revision without a truthfully preserved payload ineligible for replay', async () => {
    const database = await seedWorkspace()
    const { clock } = seededClock()
    const captures = createPgliteCaptureService(database, { now: clock })
    const accepted = await captures.accept({
      workspaceId: WS,
      provenance: { adapterId: ADAPTER_ID, adapterKind: 'connector', adapterVersion: '0.18.1', providerRecordId: 'rec-nopayload', providerSchema: PROVIDER_SCHEMA, observedAt: '2026-07-22T10:00:00.000Z' },
      evidenceMode: 'reported',
      evidence: [{ kind: 'provider_api_record', label: 'row', value: { providerRecordId: 'rec-nopayload' } }],
      actor: ACTOR,
    })
    if (!accepted.ok) throw new Error('accept failed')
    const { fieldOutcomes, repository } = wiring(database, clock)
    const eligible = await fieldOutcomes.listEligibleRevisions(WS, ADAPTER_ID)
    expect(eligible.find((r) => r.captureId === accepted.capture.id)).toBeUndefined()
    const result = await reconcileNormalizationWork({ database, fieldOutcomes, repository, workspaceId: WS, adapterId: ADAPTER_ID, resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, now: clock })
    expect(result.enqueued).toBe(0)
  })
})
