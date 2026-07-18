import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { asc, eq } from 'drizzle-orm'
import type { RawSourceFieldDirective, RawSourceNormalizationResult } from 'sparxie'
import { describe, expect, it } from 'vitest'
import {
  captureEvidenceVersions,
  captureLineages,
  captures,
  connectorInstances,
  connectorRuns,
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationReplayItems,
  normalizationReplayRequests,
  normalizationRuns,
  sourceExecutionScopes,
} from '../db/schema'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../db/pglite'
import { createPgliteTestOwner } from '../test/pglite-test-owner'
import { createNormalizationReplayService } from '../modules/sourcing/normalization-replay'
import type { createNormalizationOrchestrator } from '../modules/sourcing/normalization.orchestrator'
import type { NormalizationResolver } from '../modules/sourcing/normalization.registry'
import {
  createNormalizationResolverRegistry,
  hashJson,
} from '../modules/sourcing/normalization.registry'

const NOW = '2026-07-10T12:00:00.000Z'
const CANONICAL_SCHEMA = 'canonical-source-candidate/v1'
const GATE_POLICY = 'sourcing-admission/v1'
const INPUT_HASH_A = `sha256:${'a'.repeat(64)}`
const INPUT_HASH_B = `sha256:${'b'.repeat(64)}`

type Orchestrator = ReturnType<typeof createNormalizationOrchestrator>
type NormalizeCall = {
  rawRecordId: string
  rawRevisionId: string
  replay: {
    kind: 'replay'
    replayId: string
    fieldDirectives: RawSourceFieldDirective[]
    targetResolverVersions: Array<{ resolverId: string; version: string }>
  }
}

async function createFixture(input: {
  dataDir?: string
  now?: () => Date
  registry?: ReturnType<typeof createNormalizationResolverRegistry>
  resolve?: (call: NormalizeCall) => Promise<Partial<RawSourceNormalizationResult>> | Partial<RawSourceNormalizationResult>
} = {}) {
  const owner = input.dataDir ? null : await createPgliteTestOwner()
  const client = owner?.client ?? await createPgliteClient({ dataDir: input.dataDir })
  try {
    const database = owner?.database ?? await migratePgliteDatabase(client)
    const calls: NormalizeCall[] = []
    const normalized: RawSourceNormalizationResult[] = []
    const now = input.now ?? (() => new Date(NOW))
    const orchestrator = {
      async normalize(rawRecordId: string, rawRevisionId: string, replay: NormalizeCall['replay']) {
        const call = { rawRecordId, rawRevisionId, replay }
        calls.push(call)
        const configured = await input.resolve?.(call) ?? {}
        const result = {
          rawRecordId,
          rawRevisionId,
          canonicalSchemaVersion: CANONICAL_SCHEMA,
          status: configured.status ?? 'completed',
          attempts: configured.attempts ?? [],
          fieldOutcomes: configured.fieldOutcomes ?? [],
          updatedAt: now().toISOString(),
          gate: configured.gate ?? null,
          canonicalCandidate: configured.canonicalCandidate ?? null,
          ...configured,
        } as RawSourceNormalizationResult
        await database.insert(normalizationRuns).values({
          id: `run-${replay.replayId}-${rawRevisionId}`,
          captureLineageId: rawRecordId,
          captureEvidenceVersionId: rawRevisionId,
          triggerCaptureId: null,
          triggerConnectorInstanceId: null,
          triggerConnectorRunId: null,
          inputHash: hashJson({ replayId: replay.replayId, rawRevisionId }),
          resolverSetHash: 'sha256:replay-fixture-resolvers',
          canonicalSchemaVersion: CANONICAL_SCHEMA,
          gatePolicyVersion: GATE_POLICY,
          triggerKind: 'intake',
          triggerId: replay.replayId,
          status: result.status,
          createdAt: now().toISOString(),
          updatedAt: now().toISOString(),
        })
        return result
      },
    } as unknown as Orchestrator
    const service = createNormalizationReplayService({
      database,
      orchestrator,
      registry: input.registry ?? createNormalizationResolverRegistry([]),
      now,
      async onNormalized(result) {
        normalized.push(result)
      },
    })
    return { calls, client, database, normalized, service }
  } catch (error) {
    await client.close()
    throw error
  }
}

async function seedRevision(
  database: PgliteDatabase,
  input: { rawRecordId: string; rawRevisionId: string; revision?: number; createdAt?: string },
) {
  const createdAt = input.createdAt ?? NOW
  await database.insert(captureLineages).values({
    id: input.rawRecordId,
    createdAt,
  }).onConflictDoNothing()
  await database.insert(captureEvidenceVersions).values({
    id: input.rawRevisionId,
    captureLineageId: input.rawRecordId,
    revision: input.revision ?? 1,
    contentHash: `sha256:content-${input.rawRevisionId}`,
    adapterId: 'manual.fixture',
    adapterKind: 'manual',
    adapterVersion: '1.0.0',
    providerRecordId: input.rawRevisionId,
    payloadJson: JSON.stringify({ companyName: 'Fixture', roleTitle: 'Intern' }),
    evidenceJson: '[]',
    observedAt: createdAt,
    createdAt,
  })
}

async function seedRun(
  database: PgliteDatabase,
  input: {
    rawRecordId: string
    rawRevisionId: string
    runId: string
    canonicalSchemaVersion?: string
    gatePolicyVersion?: string
    inputHash?: string
    triggerId?: string
  },
) {
  await database.insert(normalizationRuns).values({
    id: input.runId,
    captureLineageId: input.rawRecordId,
    captureEvidenceVersionId: input.rawRevisionId,
    triggerCaptureId: null,
    triggerConnectorInstanceId: null,
    triggerConnectorRunId: null,
    inputHash: input.inputHash ?? INPUT_HASH_A,
    resolverSetHash: 'sha256:seed-resolvers',
    canonicalSchemaVersion: input.canonicalSchemaVersion ?? CANONICAL_SCHEMA,
    gatePolicyVersion: input.gatePolicyVersion ?? GATE_POLICY,
    triggerKind: 'intake',
    triggerId: input.triggerId ?? null,
    status: 'completed',
    createdAt: NOW,
    updatedAt: NOW,
  })
}

async function seedConnectorCapture(
  database: PgliteDatabase,
  input: { rawRecordId: string; rawRevisionId: string; connectorInstanceId: string },
) {
  const scopeId = `scope_${input.connectorInstanceId}`
  const connectorRunId = `connector-run-${input.connectorInstanceId}`
  await database.insert(sourceExecutionScopes).values({
    id: scopeId,
    status: 'available',
    blockedUntil: null,
    backoffAttempt: 0,
    authGeneration: 0,
    refreshLeaseToken: null,
    refreshLeaseExpiresAt: null,
    actionReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  })
  await database.insert(connectorInstances).values({
    id: input.connectorInstanceId,
    executionScopeId: scopeId,
    connectorId: 'fixture.connector',
    connectorVersion: '1.0.0',
    displayName: 'Fixture connector',
    enabled: true,
    configJson: '{}',
    authJson: '[]',
    filtersJson: '{}',
    earliestBackfillDate: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  })
  await database.insert(connectorRuns).values({
    id: connectorRunId,
    executionScopeId: scopeId,
    connectorInstanceId: input.connectorInstanceId,
    mode: 'manual',
    status: 'completed',
    startedAt: NOW,
    completedAt: NOW,
    coverageStartedAt: null,
    coverageEndedAt: null,
    configJson: '{}',
    filtersJson: '{}',
    filterSignature: 'filters:{}',
    observationCount: 1,
    warningCount: 0,
    statsJson: '{}',
    warningsJson: '[]',
    retryHintsJson: '[]',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  })
  await database.insert(captures).values({
    id: `capture-${input.rawRevisionId}`,
    captureLineageId: input.rawRecordId,
    captureEvidenceVersionId: input.rawRevisionId,
    connectorInstanceId: input.connectorInstanceId,
    connectorRunId,
    executionScopeId: scopeId,
    observedAt: NOW,
    receivedAt: NOW,
  })
}

describe('local raw normalization replay', () => {
  it('replays an exactly selected raw revision when its canonical schema is invalidated', async () => {
    const fixture = await createFixture()
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-exact', rawRevisionId: 'revision-exact' })
      await seedRun(fixture.database, {
        rawRecordId: 'raw-exact', rawRevisionId: 'revision-exact', runId: 'run-exact-before',
      })

      const receipt = await fixture.service.replay({
        selector: { rawRevisionIds: ['revision-exact'] },
        invalidate: { canonicalSchemaVersions: [CANONICAL_SCHEMA] },
        targetVersions: { canonicalSchemaVersion: CANONICAL_SCHEMA },
      })

      expect(receipt).toMatchObject({
        replayId: expect.any(String),
        acceptedAt: NOW,
        matchedRawRevisionIds: ['revision-exact'],
        items: [expect.objectContaining({ rawRecordId: 'raw-exact', rawRevisionId: 'revision-exact' })],
      })
      expect(fixture.calls).toHaveLength(1)
      expect(fixture.calls[0]).toMatchObject({ rawRecordId: 'raw-exact', rawRevisionId: 'revision-exact' })
    } finally {
      await fixture.client.close()
    }
  })

  it('materializes a user field lock and suppresses lower-precedence resolver work', async () => {
    const fixture = await createFixture({
      resolve(call) {
        const lock = call.replay.fieldDirectives.find(({ action }) => action === 'lock')
        return {
          fieldOutcomes: lock ? [lock, {
            resolverId: 'deterministic.explicit-company',
            resolverVersion: '1.0.0', field: 'companyName', inputHash: INPUT_HASH_A,
            status: 'suppressed', reason: 'Locked by user directive',
          }] : [],
        }
      },
    })
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-lock', rawRevisionId: 'revision-lock' })
      const lock: RawSourceFieldDirective = {
        action: 'lock', field: 'companyName', value: 'User Accepted Company',
        reason: 'Confirmed by the user', inputHash: INPUT_HASH_A, policyVersion: 'user-lock/v1',
      }
      await fixture.service.replay({
        selector: { rawRevisionIds: ['revision-lock'] }, invalidate: {}, fieldDirectives: [lock],
      })
      await fixture.service.replay({ selector: { rawRevisionIds: ['revision-lock'] }, invalidate: {} })

      expect(fixture.calls[1]?.replay.fieldDirectives).toEqual([lock])
      expect(fixture.normalized[0]?.fieldOutcomes).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'companyName', action: 'lock', value: 'User Accepted Company' }),
        expect.objectContaining({ resolverId: 'deterministic.explicit-company', status: 'suppressed' }),
      ]))
    } finally {
      await fixture.client.close()
    }
  })

  it('persists an equal-strength conflict and prevents required-field admission', async () => {
    const fixture = await createFixture({
      resolve() {
        return {
          gate: {
            status: 'needs_enrichment', policyVersion: GATE_POLICY, evaluatedAt: NOW,
            requiredFields: ['companyName'], missingFields: [], conflictingFields: ['companyName'],
            candidate: null,
          },
          fieldOutcomes: [{
            resolverId: 'fixture.conflict', resolverVersion: '1.0.0', field: 'companyName',
            inputHash: INPUT_HASH_A, status: 'conflict', values: ['Company A', 'Company B'],
          }],
        }
      },
    })
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-conflict', rawRevisionId: 'revision-conflict' })
      await fixture.service.replay({ selector: { rawRevisionIds: ['revision-conflict'] }, invalidate: {} })

      expect(fixture.normalized[0]).toMatchObject({
        status: 'completed', canonicalCandidate: null,
        gate: { status: 'needs_enrichment', conflictingFields: ['companyName'] },
      })
      expect(fixture.normalized[0]?.fieldOutcomes).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'companyName', status: 'conflict', values: ['Company A', 'Company B'] }),
      ]))
    } finally {
      await fixture.client.close()
    }
  })

  it('reports a truthful no-op when selected revisions do not match invalidated versions', async () => {
    const fixture = await createFixture()
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-noop', rawRevisionId: 'revision-noop' })
      await seedRun(fixture.database, {
        rawRecordId: 'raw-noop', rawRevisionId: 'revision-noop', runId: 'run-noop',
      })
      const receipt = await fixture.service.replay({
        selector: { rawRecordIds: ['raw-noop'] },
        invalidate: { canonicalSchemaVersions: ['canonical-source-candidate/v0'] },
      })

      expect(receipt).toMatchObject({ status: 'completed', matchedRawRevisionIds: [], items: [] })
      expect(fixture.calls).toEqual([])
    } finally {
      await fixture.client.close()
    }
  })

  it('rejects invalid directives atomically without appending normalization history', async () => {
    const fixture = await createFixture()
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-invalid', rawRevisionId: 'revision-invalid' })
      await expect(fixture.service.replay({
        selector: { rawRevisionIds: ['revision-invalid'] },
        invalidate: {},
        fieldDirectives: [{
          action: 'lock', field: 'companyName', value: '', reason: 'Invalid empty company',
          inputHash: INPUT_HASH_B, policyVersion: 'user-lock/v1',
        }],
      })).rejects.toMatchObject({ statusCode: 400, code: 'invalid_request' })

      await expect(fixture.database.select().from(normalizationReplayRequests)).resolves.toEqual([])
      await expect(fixture.database.select().from(normalizationReplayItems)).resolves.toEqual([])
      expect(fixture.calls).toEqual([])
    } finally {
      await fixture.client.close()
    }
  })

  it('continues matched revisions after one normalization failure and reports it', async () => {
    const fixture = await createFixture({
      resolve(call) {
        return { status: call.rawRevisionId === 'revision-bad' ? 'failed' : 'completed' }
      },
    })
    try {
      await seedRevision(fixture.database, {
        rawRecordId: 'raw-bad', rawRevisionId: 'revision-bad', createdAt: NOW,
      })
      await seedRevision(fixture.database, {
        rawRecordId: 'raw-good', rawRevisionId: 'revision-good', createdAt: '2026-07-10T12:00:01.000Z',
      })
      const receipt = await fixture.service.replay({
        selector: { rawRevisionIds: ['revision-bad', 'revision-good'] }, invalidate: {},
      })

      expect(receipt).toMatchObject({
        status: 'completed_with_failures', completedAt: NOW,
        items: expect.arrayContaining([
          expect.objectContaining({
            status: 'failed', rawRecordId: 'raw-bad', rawRevisionId: 'revision-bad',
            normalizationRunId: expect.any(String),
            failure: { code: 'normalization_failed', retryable: false },
          }),
          expect.objectContaining({ status: 'completed', rawRevisionId: 'revision-good' }),
        ]),
      })
      expect(fixture.calls).toHaveLength(2)
    } finally {
      await fixture.client.close()
    }
  })

  it('classifies nested PostgreSQL serialization failures as retryable persistence failures', async () => {
    const fixture = await createFixture({
      resolve() {
        throw Object.assign(new Error('transaction serialization failed'), {
          cause: { code: '40001' },
        })
      },
    })
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-pg-failure', rawRevisionId: 'revision-pg-failure' })
      const receipt = await fixture.service.replay({
        selector: { rawRevisionIds: ['revision-pg-failure'] }, invalidate: {},
      })

      expect(receipt).toMatchObject({
        status: 'completed_with_failures',
        items: [expect.objectContaining({
          status: 'failed',
          failure: { code: 'persistence_failed', retryable: true },
        })],
      })
    } finally {
      await fixture.client.close()
    }
  })

  it('runs the exact requested installed resolver version for a targeted resolver id', async () => {
    const targetedResolver: NormalizationResolver = {
      declaration: {
        id: 'fixture.versioned-company', version: '2.0.0', requiredInputs: ['rawRevision'],
        outputFields: ['companyName'], capabilities: ['pure'], costClass: 'none', precedence: 1,
      },
      resolve: () => [],
    }
    const fixture = await createFixture({
      registry: createNormalizationResolverRegistry([targetedResolver]),
    })
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-versioned', rawRevisionId: 'revision-versioned' })
      await seedRun(fixture.database, {
        rawRecordId: 'raw-versioned', rawRevisionId: 'revision-versioned', runId: 'run-versioned',
      })
      await fixture.database.insert(normalizationAttempts).values({
        id: 'attempt-versioned-v1', runId: 'run-versioned',
        captureEvidenceVersionId: 'revision-versioned', sequence: 0,
        resolverId: 'fixture.versioned-company', resolverVersion: '1.0.0',
        inputHash: INPUT_HASH_A, declarationJson: '{}', applicabilityJson: '[]',
        status: 'completed', startedAt: NOW, completedAt: NOW,
      })
      await fixture.service.replay({
        selector: { rawRevisionIds: ['revision-versioned'] },
        invalidate: { resolverVersions: [{ resolverId: 'fixture.versioned-company', version: '1.0.0' }] },
        targetVersions: { resolvers: [{ resolverId: 'fixture.versioned-company', version: '2.0.0' }] },
      })

      expect(fixture.calls[0]?.replay.targetResolverVersions).toEqual([
        { resolverId: 'fixture.versioned-company', version: '2.0.0' },
      ])
    } finally {
      await fixture.client.close()
    }
  })

  it('persists explicit suppression without canonical null and allows a later lock to supersede it', async () => {
    let clock = Date.parse(NOW)
    const fixture = await createFixture({ now: () => new Date(clock++) })
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-supersede', rawRevisionId: 'revision-supersede' })
      const suppress: RawSourceFieldDirective = {
        action: 'suppress', field: 'companyName', reason: 'User rejected provider value',
        inputHash: INPUT_HASH_A, policyVersion: 'user-suppression/v1',
      }
      const lock: RawSourceFieldDirective = {
        action: 'lock', field: 'companyName', value: 'Replacement Company',
        reason: 'User supplied replacement', inputHash: INPUT_HASH_B, policyVersion: 'user-lock/v2',
      }
      await fixture.service.replay({
        selector: { rawRevisionIds: ['revision-supersede'] }, invalidate: {}, fieldDirectives: [suppress],
      })
      await fixture.service.replay({
        selector: { rawRevisionIds: ['revision-supersede'] }, invalidate: {}, fieldDirectives: [lock],
      })
      await fixture.service.replay({ selector: { rawRevisionIds: ['revision-supersede'] }, invalidate: {} })

      expect(fixture.calls[0]?.replay.fieldDirectives).toEqual([suppress])
      expect(fixture.calls[1]?.replay.fieldDirectives).toEqual([lock])
      expect(fixture.calls[2]?.replay.fieldDirectives).toEqual([lock])
    } finally {
      await fixture.client.close()
    }
  })

  it('orders equal-time field directives deterministically by replay request id', async () => {
    const fixture = await createFixture()
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-directive-order', rawRevisionId: 'revision-directive-order' })
      const suppress: RawSourceFieldDirective = {
        action: 'suppress', field: 'companyName', reason: 'Earlier equal-time directive',
        inputHash: INPUT_HASH_A, policyVersion: 'user-suppression/v1',
      }
      const lock: RawSourceFieldDirective = {
        action: 'lock', field: 'companyName', value: 'ID Ordered Company',
        reason: 'Later equal-time directive', inputHash: INPUT_HASH_B, policyVersion: 'user-lock/v2',
      }
      for (const [replayId, directive] of [
        ['directive-a', suppress],
        ['directive-z', lock],
      ] as const) {
        await fixture.database.insert(normalizationReplayRequests).values({
          id: replayId,
          selectorJson: JSON.stringify({ rawRevisionIds: ['revision-directive-order'] }),
          invalidationJson: '{}',
          targetVersionsJson: null,
          fieldDirectivesJson: JSON.stringify([directive]),
          status: 'completed',
          acceptedAt: NOW,
          completedAt: NOW,
        })
        await fixture.database.insert(normalizationReplayItems).values({
          id: `item-${replayId}`,
          replayId,
          captureLineageId: 'raw-directive-order',
          captureEvidenceVersionId: 'revision-directive-order',
          inputHash: INPUT_HASH_A,
          sequence: 0,
          status: 'completed',
          normalizationRunId: null,
          failureJson: null,
          completedAt: NOW,
        })
      }

      await fixture.service.replay({
        selector: { rawRevisionIds: ['revision-directive-order'] }, invalidate: {},
      })
      expect(fixture.calls[0]?.replay.fieldDirectives).toEqual([lock])
    } finally {
      await fixture.client.close()
    }
  })

  it('keeps prior normalization runs internally queryable while GET returns the latest replay', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'normalization-replay-'))
    let client: PgliteClient | null = null
    try {
      const fixture = await createFixture({
        dataDir,
        now: () => new Date('2026-07-10T12:00:01.000Z'),
      })
      client = fixture.client
      await seedRevision(fixture.database, { rawRecordId: 'raw-history', rawRevisionId: 'revision-history' })
      await seedRun(fixture.database, {
        rawRecordId: 'raw-history', rawRevisionId: 'revision-history', runId: 'run-history-before',
      })
      await fixture.service.replay({ selector: { rawRevisionIds: ['revision-history'] }, invalidate: {} })
      await client.close()
      client = null

      const reopened = await createPgliteClient({ dataDir })
      client = reopened
      const database = await migratePgliteDatabase(reopened)
      const history = await database.select().from(normalizationRuns)
        .where(eq(normalizationRuns.captureEvidenceVersionId, 'revision-history'))
        .orderBy(asc(normalizationRuns.createdAt), asc(normalizationRuns.id))
      expect(history.map(({ id }) => id)).toEqual([
        'run-history-before',
        expect.stringContaining('run-'),
      ])
      await expect(database.select().from(normalizationReplayRequests)).resolves.toEqual([
        expect.objectContaining({ status: 'completed', completedAt: '2026-07-10T12:00:01.000Z' }),
      ])
    } finally {
      await client?.close()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('does not let an older raw revision replay roll back the current finding', async () => {
    const fixture = await createFixture()
    try {
      await seedRevision(fixture.database, {
        rawRecordId: 'raw-chronology', rawRevisionId: 'revision-old', revision: 1, createdAt: NOW,
      })
      await fixture.database.insert(captureEvidenceVersions).values({
        id: 'revision-current', captureLineageId: 'raw-chronology', revision: 2,
        contentHash: 'sha256:content-current', adapterId: 'manual.fixture', adapterKind: 'manual',
        adapterVersion: '1.0.0', providerRecordId: 'current', payloadJson: '{}', evidenceJson: '[]',
        observedAt: '2026-07-10T13:00:00.000Z', createdAt: '2026-07-10T13:00:00.000Z',
      })
      await fixture.service.replay({ selector: { rawRevisionIds: ['revision-old'] }, invalidate: {} })

      expect(fixture.calls).toEqual([
        expect.objectContaining({ rawRecordId: 'raw-chronology', rawRevisionId: 'revision-old' }),
      ])
      const revisions = await fixture.database.select().from(captureEvidenceVersions)
        .where(eq(captureEvidenceVersions.captureLineageId, 'raw-chronology'))
        .orderBy(asc(captureEvidenceVersions.revision))
      expect(revisions.at(-1)?.id).toBe('revision-current')
    } finally {
      await fixture.client.close()
    }
  })

  it('selects only the revision that owns a persisted resolver input hash', async () => {
    const fixture = await createFixture()
    try {
      for (const suffix of ['first', 'second']) {
        await seedRevision(fixture.database, {
          rawRecordId: `raw-${suffix}`, rawRevisionId: `revision-${suffix}`,
          createdAt: suffix === 'first' ? NOW : '2026-07-10T12:00:01.000Z',
        })
        await seedRun(fixture.database, {
          rawRecordId: `raw-${suffix}`, rawRevisionId: `revision-${suffix}`, runId: `run-${suffix}`,
          inputHash: suffix === 'first' ? INPUT_HASH_A : INPUT_HASH_B,
        })
      }
      await fixture.database.insert(normalizationAttempts).values({
        id: 'attempt-first', runId: 'run-first', captureEvidenceVersionId: 'revision-first', sequence: 0,
        resolverId: 'fixture.company', resolverVersion: '1.0.0', inputHash: INPUT_HASH_A,
        declarationJson: '{}', applicabilityJson: '[]', status: 'completed', startedAt: NOW, completedAt: NOW,
      })
      await fixture.database.insert(normalizationFieldOutcomes).values({
        id: 'outcome-first', runId: 'run-first', attemptId: 'attempt-first', sequence: 0,
        attemptSequence: 0, outcomeIndex: 0, field: 'companyName', status: 'resolved',
        resolverId: 'fixture.company', resolverVersion: '1.0.0', inputHash: INPUT_HASH_A,
        outcomeJson: '{}',
      })
      const receipt = await fixture.service.replay({ selector: { inputHashes: [INPUT_HASH_A] }, invalidate: {} })

      expect(receipt.matchedRawRevisionIds).toEqual(['revision-first'])
      expect(receipt.items).toEqual([
        expect.objectContaining({ rawRecordId: 'raw-first', rawRevisionId: 'revision-first' }),
      ])
    } finally {
      await fixture.client.close()
    }
  })

  it('claims a connector-upgrade replay once under concurrent callers', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    let started!: () => void
    const normalizationStarted = new Promise<void>((resolve) => { started = resolve })
    const fixture = await createFixture({
      async resolve() {
        started()
        await blocked
        return { status: 'completed' }
      },
    })
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-claim', rawRevisionId: 'revision-claim' })
      await seedConnectorCapture(fixture.database, {
        rawRecordId: 'raw-claim', rawRevisionId: 'revision-claim', connectorInstanceId: 'claim-instance',
      })
      const request = {
        connectorInstanceId: 'claim-instance', fromConnectorVersion: '1.0.0',
        instanceUpdatedAt: NOW, toConnectorVersion: '2.0.0',
      }
      const first = fixture.service.replayConnectorUpgrade(request)
      await normalizationStarted
      await expect(fixture.database.select().from(normalizationReplayRequests)).resolves.toEqual([
        expect.objectContaining({ status: 'in_progress', completedAt: null }),
      ])
      await expect(fixture.database.select().from(normalizationReplayItems)).resolves.toEqual([
        expect.objectContaining({
          status: 'pending',
          failureJson: expect.stringMatching(/"claimToken"/),
        }),
      ])
      const second = fixture.service.replayConnectorUpgrade(request)
      release()
      const receipts = await Promise.all([first, second])

      expect(receipts[1]).toEqual(receipts[0])
      expect(fixture.calls).toHaveLength(1)
      await expect(fixture.database.select().from(normalizationReplayItems)).resolves.toEqual([
        expect.objectContaining({ status: 'completed', failureJson: null }),
      ])
    } finally {
      await fixture.client.close()
    }
  })

  it('rolls back request initialization when an injected item persistence trigger fails', async () => {
    const fixture = await createFixture()
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-rollback-a', rawRevisionId: 'revision-rollback-a' })
      await seedRevision(fixture.database, { rawRecordId: 'raw-rollback-b', rawRevisionId: 'revision-rollback-b' })
      await fixture.client.exec(`
        create or replace function fail_second_replay_item() returns trigger as $$
        begin
          if new.sequence = 1 then raise exception 'injected replay item failure'; end if;
          return new;
        end;
        $$ language plpgsql;
        create trigger fail_second_replay_item_trigger
        before insert on normalization_replay_items
        for each row execute function fail_second_replay_item();
      `)

      let injectedFailure: unknown
      try {
        await fixture.service.replay({
          selector: { rawRevisionIds: ['revision-rollback-a', 'revision-rollback-b'] }, invalidate: {},
        })
      } catch (error) {
        injectedFailure = error
      }
      expect(injectedFailure).toMatchObject({
        cause: expect.objectContaining({ message: expect.stringMatching(/injected replay item failure/i) }),
      })
      await expect(fixture.database.select().from(normalizationReplayRequests)).resolves.toEqual([])
      await expect(fixture.database.select().from(normalizationReplayItems)).resolves.toEqual([])
    } finally {
      await fixture.client.close()
    }
  })
})
