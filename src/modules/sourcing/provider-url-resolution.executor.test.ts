import { describe, expect, it, vi } from 'vitest'
import {
  connectorInstances,
  connectorRuns,
  normalizationFieldOutcomes,
  retryWork,
  sourceExecutionScopes,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { createNormalizationOrchestrator } from './normalization.orchestrator'
import { createPgliteNormalizationRepository } from './normalization.repository'
import {
  createNormalizationResolverRegistry,
  hashJson,
  type NormalizationResolverContext,
} from './normalization.registry'
import { createProviderUrlResolutionExecutor } from './provider-url-resolution.executor'
import { createProviderUrlResolutionRepository } from './provider-url-resolution.repository'
import { createPgliteRawSourceRepository } from './raw-source.repository'

const resettableOwner = useResettablePgliteTestOwner()

describe.sequential('provider URL resolution executor', () => {
  it('records exact resolver success without invoking hosted resolution', async () => {
    const clock = new Date('2026-07-16T12:00:00.000Z')
    const { database } = resettableOwner()
    const capture = await seedConnectorCapture(database, 'one', clock.toISOString())
    const intake = await createPgliteRawSourceRepository(database, () => clock).ingestBatch({
      records: [{
        adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.14.0' },
        capture,
        observedAt: clock.toISOString(), providerRecordId: 'jobright.public:provider-one',
        providerSchema: 'jobright-authenticated-search@1',
        payload: { companyName: 'Example', roleTitle: 'Engineer' },
      }],
    })
    const declaration = {
      id: 'jobright.provider-url', version: 'jobright-provider-url@1',
      requiredInputs: ['providerRecordId'] as const, outputFields: ['destinationUrl'] as const,
      capabilities: ['network'] as const, costClass: 'high' as const,
      precedence: 1_000, scopeRequirement: 'source' as const,
    }
    const repository = createProviderUrlResolutionRepository(database, () => clock)
    await repository.enqueue({
      captureEvidenceVersionId: intake.receipts[0].revision.id,
      connectorInstanceId: capture.connectorInstanceId,
      executionScopeId: capture.executionScopeId,
      inputHash: hashJson({ raw: intake.receipts[0].revision.contentHash, resolver: declaration }),
      intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
      providerRecordId: 'jobright.public:provider-one',
      resolverId: declaration.id,
      resolverVersion: declaration.version,
    })
    const claim = await repository.claimDue(clock.toISOString())
    expect(claim).not.toBeNull()
    const hostedResolve = vi.fn(async (context: NormalizationResolverContext) => [{
      resolverId: 'hosted.job-resolution',
      resolverVersion: '1.0.0',
      field: 'destinationUrl' as const,
      inputHash: context.hashInput('hosted-input'),
      status: 'resolved' as const,
      value: {
        class: 'employer_or_ats' as const,
        intermediaryUrl: null,
        url: 'https://jobs.lever.co/hosted/should-not-run',
      },
      confidence: 1,
    }])
    const hostedRegistry = createNormalizationResolverRegistry([{
      declaration: {
        id: 'hosted.job-resolution', version: '1.0.0',
        requiredInputs: ['sourceUrl'], outputFields: ['destinationUrl'],
        capabilities: ['network'], costClass: 'high', precedence: 500,
        scopeRequirement: 'source',
      },
      resolve: hostedResolve,
    }])
    const resolve = vi.fn(async () => ({
      status: 'resolved' as const,
      url: 'https://jobs.lever.co/example/opening-1?utm_source=jobright&ref=a%2Bb',
      method: 'jobright_api_detail',
    }))
    const normalizationRepository = createPgliteNormalizationRepository(database)
    const execute = createProviderUrlResolutionExecutor({
      normalizationOrchestrator: createNormalizationOrchestrator({
        repository: normalizationRepository,
        registry: hostedRegistry,
        now: () => clock,
      }),
      normalizationRepository,
      now: () => clock,
      random: () => 0,
      repository,
      resolve,
    })

    await execute(claim!)

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(hostedResolve).not.toHaveBeenCalled()
    await expect(database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({ state: 'completed', nextAttemptAt: null }),
    ])
    const outcomes = (await database.select().from(normalizationFieldOutcomes))
      .map(({ outcomeJson }) => JSON.parse(outcomeJson))
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'resolved',
        value: expect.objectContaining({
          intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
          url: 'https://jobs.lever.co/example/opening-1?utm_source=jobright&ref=a%2Bb',
        }),
      }),
    ]))
  })

  it('persists an exact custom employer destination and projects its candidate', async () => {
    const exactUrl = 'https://careers.example.com/openings/software-engineer?source=jobright&ref=a%2Bb'
    const base = new Date('2026-07-16T12:00:00.000Z')
    let nowTick = 0
    const fixture = await createExecutorFixture(resettableOwner, {
      now: () => new Date(base.getTime() + (nowTick++) * 1_000),
      pureNormalizationRegistry: createNormalizationResolverRegistry([{
        declaration: {
          id: 'jobright.pure-fields', version: '1.0.0',
          requiredInputs: ['payload'],
          outputFields: ['canonicalIdentity', 'companyName', 'roleTitle'],
          capabilities: ['pure'], costClass: 'low', precedence: 100,
          scopeRequirement: 'none',
        },
        resolve: async (context) => [
          {
            resolverId: 'jobright.pure-fields', resolverVersion: '1.0.0',
            field: 'canonicalIdentity' as const, inputHash: context.hashInput('identity'),
            status: 'resolved' as const,
            value: {
              kind: 'provider_job' as const,
              value: JSON.stringify([
                'adapter:17:jobright.resolver|schema:value:31:jobright-authenticated-search@1',
                'jobright.public:provider-fixture',
              ]),
            },
            confidence: 1,
          },
          {
            resolverId: 'jobright.pure-fields', resolverVersion: '1.0.0',
            field: 'companyName' as const, inputHash: context.hashInput('company'),
            status: 'resolved' as const, value: 'Example', confidence: 1,
          },
          {
            resolverId: 'jobright.pure-fields', resolverVersion: '1.0.0',
            field: 'roleTitle' as const, inputHash: context.hashInput('role'),
            status: 'resolved' as const, value: 'Engineer', confidence: 1,
          },
        ],
      }]),
      resolve: async () => ({
        status: 'resolved' as const,
        url: exactUrl,
        method: 'jobright_api_detail',
      }),
    })

    await fixture.execute(fixture.claim)

    await expect(fixture.database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({
        state: 'completed',
        nextAttemptAt: null,
      }),
    ])
    expect((await fixture.database.select().from(normalizationFieldOutcomes))
      .map(({ outcomeJson }) => JSON.parse(outcomeJson)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          field: 'destinationUrl',
          status: 'resolved',
          value: {
            class: 'employer_or_ats',
            intermediaryUrl: 'https://jobright.ai/jobs/info/provider-fixture',
            url: exactUrl,
          },
        }),
      ]))
    await expect(fixture.normalizationRepository.getLatestForRevision(
      fixture.claim.captureEvidenceVersionId,
    )).resolves.toMatchObject({
      canonicalCandidate: expect.objectContaining({
        destination: expect.objectContaining({ url: exactUrl }),
      }),
      gate: expect.objectContaining({ status: 'passed' }),
    })
  })

  it('advances the durable attempt number when retry work becomes due again', async () => {
    let clock = new Date('2026-07-16T12:00:00.000Z')
    const { database } = resettableOwner()
    const capture = await seedConnectorCapture(database, 'retry', clock.toISOString())
    const intake = await createPgliteRawSourceRepository(database, () => clock).ingestBatch({
      records: [{
        adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.14.0' },
        capture,
        observedAt: clock.toISOString(), providerRecordId: 'jobright.public:provider-retry',
        providerSchema: 'jobright-authenticated-search@1',
        payload: { companyName: 'Example', roleTitle: 'Engineer' },
      }],
    })
    const declaration = {
      id: 'jobright.provider-url', version: 'jobright-provider-url@1',
      requiredInputs: ['providerRecordId'] as const, outputFields: ['destinationUrl'] as const,
      capabilities: ['network'] as const, costClass: 'high' as const,
      precedence: 1_000, scopeRequirement: 'source' as const,
    }
    const repository = createProviderUrlResolutionRepository(database, () => clock)
    await repository.enqueue({
      captureEvidenceVersionId: intake.receipts[0].revision.id,
      connectorInstanceId: capture.connectorInstanceId,
      executionScopeId: capture.executionScopeId,
      inputHash: hashJson({ raw: intake.receipts[0].revision.contentHash, resolver: declaration }),
      intermediaryUrl: 'https://jobright.ai/jobs/info/provider-retry',
      providerRecordId: 'jobright.public:provider-retry',
      resolverId: declaration.id,
      resolverVersion: declaration.version,
    })
    const firstClaim = await repository.claimDue(clock.toISOString())
    expect(firstClaim?.attempt).toBe(1)
    const normalizationRepository = createPgliteNormalizationRepository(database)
    const execute = createProviderUrlResolutionExecutor({
      normalizationOrchestrator: createNormalizationOrchestrator({
        repository: normalizationRepository,
        registry: { resolvers: [], resolverSetHash: 'sha256:empty' },
        now: () => clock,
      }),
      normalizationRepository,
      now: () => clock,
      random: () => 0,
      repository,
      resolve: async () => ({
        status: 'retryable', reason: 'provider temporarily unavailable',
        retryReason: 'server_failure',
      }),
    })

    await execute(firstClaim!)

    const nextDueAt = await repository.nextDueAt()
    expect(nextDueAt).not.toBeNull()
    clock = new Date(nextDueAt!)
    expect((await repository.claimDue(nextDueAt!))?.attempt).toBe(2)
  })

  it('persists bounded Retry-After evidence on the affected provider operation', async () => {
    const fixture = await createExecutorFixture(resettableOwner, {
      resolve: async () => ({
        status: 'retryable' as const,
        reason: 'jobright_rate_limited',
        retryReason: 'rate_limit' as const,
        serverMinimumDelayMs: 120_000,
      }),
    })

    await fixture.execute(fixture.claim)

    await expect(fixture.database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({
        state: 'scheduled',
        computedDelayMs: 120_001,
        nextAttemptAt: '2026-07-16T12:02:00.001Z',
        serverMinimumDelayMs: 120_000,
      }),
    ])
    const [row] = await fixture.database.select().from(retryWork).limit(1)
    expect(JSON.parse(row!.lineageJson).failureEvidence).toEqual({
      reason: 'jobright_rate_limited',
      retryReason: 'rate_limit',
      serverMinimumDelayMs: 120_000,
    })
  })

  it('does not rely on a post-normalization write for retryable failure evidence', async () => {
    const fixture = await createExecutorFixture(resettableOwner, {
      resolve: async () => ({
        status: 'retryable' as const,
        reason: 'jobright_rate_limited',
        retryReason: 'rate_limit' as const,
        serverMinimumDelayMs: 120_000,
      }),
    })
    vi.spyOn(fixture.repository, 'recordFailureEvidence').mockImplementation(async () => {
      throw new Error('simulated crash after normalization commit')
    })

    await expect(fixture.execute(fixture.claim)).resolves.toBeUndefined()

    const [row] = await fixture.database.select().from(retryWork).limit(1)
    expect(row).toMatchObject({
      state: 'scheduled',
      attempt: 1,
      nextAttemptAt: '2026-07-16T12:02:00.001Z',
    })
    expect(JSON.parse(row!.lineageJson).failureEvidence).toEqual({
      reason: 'jobright_rate_limited',
      retryReason: 'rate_limit',
      serverMinimumDelayMs: 120_000,
    })
  })

  it('exhausts only the claimed provider operation at the attempt limit', async () => {
    const fixture = await createExecutorFixture(resettableOwner, {
      resolve: async () => ({
        status: 'retryable' as const,
        reason: 'jobright_upstream_failed',
        retryReason: 'server_failure' as const,
      }),
      attempt: 3,
    })

    await fixture.execute(fixture.claim)

    await expect(fixture.database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({
        state: 'exhausted',
        nextAttemptAt: null,
        attempt: 3,
      }),
    ])
    const outcomes = (await fixture.database.select().from(normalizationFieldOutcomes))
      .map(({ outcomeJson }) => JSON.parse(outcomeJson))
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'exhausted', field: 'destinationUrl' }),
    ]))
    const [row] = await fixture.database.select().from(retryWork).limit(1)
    expect(JSON.parse(row!.lineageJson).failureEvidence)
      .toEqual({
        reason: 'jobright_upstream_failed',
        retryReason: 'server_failure',
        serverMinimumDelayMs: null,
      })
  })

  it('persists runtime-limit interruption as a bounded retry outcome', async () => {
    const fixture = await createExecutorFixture(resettableOwner, {
      resolve: async () => ({ status: 'interrupted' as const, reason: 'runtime_limit' as const }),
    })

    await expect(fixture.execute(fixture.claim)).resolves.toBeUndefined()
    await expect(fixture.database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({ state: 'scheduled', acquisitionToken: null, acquiredAt: null }),
    ])
    const outcomes = (await fixture.database.select().from(normalizationFieldOutcomes))
      .map(({ outcomeJson }) => JSON.parse(outcomeJson))
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'retry', field: 'destinationUrl',
        retry: expect.objectContaining({ reason: 'operation_timeout', state: 'scheduled' }),
      }),
    ]))
  })

  it('persists non-cancellation resolver throws as a bounded retry outcome', async () => {
    const fixture = await createExecutorFixture(resettableOwner, {
      resolve: async () => { throw new Error('provider resolver crashed') },
    })

    await expect(fixture.execute(fixture.claim)).resolves.toBeUndefined()
    await expect(fixture.database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({ state: 'scheduled', acquisitionToken: null, acquiredAt: null }),
    ])
    const [row] = await fixture.database.select().from(retryWork).limit(1)
    expect(JSON.parse(row!.lineageJson).failureEvidence).toMatchObject({
      reason: 'provider_url_resolver_exception',
    })
  })

  it('releases unchanged only for an actual shutdown cancellation', async () => {
    const fixture = await createExecutorFixture(resettableOwner, {
      resolve: async () => { throw new Error('provider resolver aborted') },
    })
    const controller = new AbortController()
    controller.abort()

    await expect(fixture.execute(fixture.claim, controller.signal)).rejects.toThrow('provider resolver aborted')
    await expect(fixture.database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({ state: 'scheduled', acquisitionToken: null, acquiredAt: null, attempt: 1 }),
    ])
    await expect(fixture.database.select().from(normalizationFieldOutcomes)).resolves.toHaveLength(0)
  })

  it('isolates terminal resolver outcomes and records the sanitized evidence', async () => {
    const fixture = await createExecutorFixture(resettableOwner, {
      resolve: async () => ({
        status: 'terminal' as const,
        reason: 'jobright_auth_required',
        action: 'authenticate' as const,
        parserChanged: false,
        evidence: [{ kind: 'auth_state' }],
      }),
    })
    vi.spyOn(fixture.repository, 'recordFailureEvidence').mockImplementation(async () => {
      throw new Error('simulated crash after normalization commit')
    })

    await expect(fixture.execute(fixture.claim)).resolves.toBeUndefined()

    await expect(fixture.database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({ state: 'cancelled', nextAttemptAt: null }),
    ])
    const [row] = await fixture.database.select().from(retryWork).limit(1)
    expect(JSON.parse(row!.lineageJson).failureEvidence).toEqual({
      action: 'authenticate',
      parserChanged: false,
      reason: 'jobright_auth_required',
    })
    const outcomes = (await fixture.database.select().from(normalizationFieldOutcomes))
      .map(({ outcomeJson }) => JSON.parse(outcomeJson))
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'destinationUrl',
        status: 'blocked',
        reason: 'jobright_auth_required',
        evidence: [{ kind: 'auth_state', value: null }],
      }),
    ]))
  })

  it('turns a non-cancellation resolver throw into a durable retry before normalization', async () => {
    const fixture = await createExecutorFixture(resettableOwner, {
      resolve: async () => {
        throw new Error('provider resolver crashed')
      },
    })

    await expect(fixture.execute(fixture.claim)).resolves.toBeUndefined()
    await expect(fixture.database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({
        state: 'scheduled',
        acquisitionToken: null,
        acquiredAt: null,
      }),
    ])
    const [row] = await fixture.database.select().from(retryWork).limit(1)
    expect(JSON.parse(row!.lineageJson).failureEvidence).toMatchObject({
      reason: 'provider_url_resolver_exception',
    })
  })

  it('releases a claim when normalization persistence throws before completion', async () => {
    const normalizationError = new Error('normalization persistence failed')
    const normalize = vi.fn(async () => {
      throw normalizationError
    })
    const fixture = await createExecutorFixture(resettableOwner, {
      resolve: async () => ({
        status: 'resolved' as const,
        url: 'https://jobs.lever.co/example/opening-1',
        method: 'jobright_api_detail',
      }),
      normalizationOrchestrator: { normalize } as unknown as ReturnType<typeof createNormalizationOrchestrator>,
    })

    await expect(fixture.execute(fixture.claim)).rejects.toBe(normalizationError)
    expect(normalize).toHaveBeenCalledTimes(1)
    await expect(fixture.database.select().from(retryWork)).resolves.toEqual([
      expect.objectContaining({
        state: 'scheduled',
        acquisitionToken: null,
        acquiredAt: null,
      }),
    ])
  })
})

async function createExecutorFixture(
  owner: ReturnType<typeof useResettablePgliteTestOwner>,
  options: {
    attempt?: number
    normalizationOrchestrator?: ReturnType<typeof createNormalizationOrchestrator>
    now?: () => Date
    pureNormalizationRegistry?: ReturnType<typeof createNormalizationResolverRegistry>
    resolve: Parameters<typeof createProviderUrlResolutionExecutor>[0]['resolve']
  },
) {
  const clock = new Date('2026-07-16T12:00:00.000Z')
  const now = options.now ?? (() => clock)
  const { database } = owner()
  const capture = await seedConnectorCapture(database, 'fixture', clock.toISOString())
  const intake = await createPgliteRawSourceRepository(database, () => clock).ingestBatch({
    records: [{
      adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.14.0' },
      capture,
      observedAt: clock.toISOString(), providerRecordId: 'jobright.public:provider-fixture',
      providerSchema: 'jobright-authenticated-search@1', payload: { companyName: 'Example', roleTitle: 'Engineer' },
    }],
  })
  const declaration = {
    id: 'jobright.provider-url', version: 'jobright-provider-url@1',
    requiredInputs: ['providerRecordId'] as const, outputFields: ['destinationUrl'] as const,
    capabilities: ['network'] as const, costClass: 'high' as const,
    precedence: 1_000, scopeRequirement: 'source' as const,
  }
  const repository = createProviderUrlResolutionRepository(database, () => clock)
  await repository.enqueue({
    captureEvidenceVersionId: intake.receipts[0].revision.id,
    connectorInstanceId: capture.connectorInstanceId,
    executionScopeId: capture.executionScopeId,
    inputHash: hashJson({ raw: intake.receipts[0].revision.contentHash, resolver: declaration }),
    intermediaryUrl: 'https://jobright.ai/jobs/info/provider-fixture',
    providerRecordId: 'jobright.public:provider-fixture',
    resolverId: declaration.id,
    resolverVersion: declaration.version,
  })
  if (options.attempt !== undefined) {
    await database.update(retryWork).set({ attempt: options.attempt })
  }
  const claim = await repository.claimDue(clock.toISOString())
  if (!claim) throw new Error('Provider URL fixture claim was not created')
  const normalizationRepository = createPgliteNormalizationRepository(database)
  const execute = createProviderUrlResolutionExecutor({
    normalizationOrchestrator: options.normalizationOrchestrator ?? createNormalizationOrchestrator({
      repository: normalizationRepository,
      registry: { resolvers: [], resolverSetHash: 'sha256:empty' },
      now,
    }),
    normalizationRepository,
    pureNormalizationRegistry: options.pureNormalizationRegistry,
    now,
    random: () => 0,
    repository,
    resolve: options.resolve,
  })
  return { claim, database, execute, normalizationRepository, repository }
}

async function seedConnectorCapture(
  database: PgliteDatabase,
  suffix: string,
  timestamp: string,
) {
  const executionScopeId = `provider-scope-${suffix}`
  const connectorInstanceId = `provider-instance-${suffix}`
  const connectorRunId = `provider-run-${suffix}`
  await database.insert(sourceExecutionScopes).values({
    id: executionScopeId, createdAt: timestamp, updatedAt: timestamp,
  })
  await database.insert(connectorInstances).values({
    id: connectorInstanceId, executionScopeId, connectorId: 'jobright.resolver',
    connectorVersion: '0.14.0', displayName: 'Jobright', enabled: true,
    configJson: '{}', createdAt: timestamp, updatedAt: timestamp,
  })
  await database.insert(connectorRuns).values({
    id: connectorRunId, executionScopeId, connectorInstanceId, mode: 'manual',
    status: 'running', startedAt: timestamp, observationCount: 0, warningCount: 0,
    statsJson: '{}', warningsJson: '[]', retryHintsJson: 'null',
    createdAt: timestamp, updatedAt: timestamp,
  })
  return { connectorInstanceId, connectorRunId, executionScopeId }
}
