import { describe, expect, it, vi } from 'vitest'
import {
  connectorRuns,
  normalizationFieldOutcomes,
  retryWork,
} from '../../db/schema'
import {
  createDrizzleDatabase,
  createInMemoryDatabase,
  migrateDatabase,
} from '../../db/sqlite'
import { createSqliteConnectorRepository } from '../connectors/connector.repository'
import { createNormalizationOrchestrator } from './normalization.orchestrator'
import { createSqliteNormalizationRepository } from './normalization.repository'
import {
  createNormalizationResolverRegistry,
  hashJson,
  type NormalizationResolverContext,
} from './normalization.registry'
import { createProviderUrlResolutionExecutor } from './provider-url-resolution.executor'
import { createProviderUrlResolutionRepository } from './provider-url-resolution.repository'
import { createSqliteRawSourceRepository } from './raw-source.repository'

describe('provider URL resolution executor', () => {
  it('records exact resolver success without invoking hosted resolution', async () => {
    const clock = new Date('2026-07-16T12:00:00.000Z')
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectors = createSqliteConnectorRepository(database)
    const instance = await connectors.upsertInstance({
      id: 'jobright-one', connectorId: 'jobright.resolver', connectorVersion: '0.14.0',
      displayName: 'Jobright', enabled: true, createdAt: clock.toISOString(),
    })
    database.insert(connectorRuns).values({
      id: 'run-one', executionScopeId: instance.executionScopeId,
      connectorInstanceId: instance.id, mode: 'manual', status: 'running',
      startedAt: clock.toISOString(), completedAt: null,
      coverageStartedAt: null, coverageEndedAt: clock.toISOString(),
      configJson: '{}', filtersJson: '{}', filterSignature: 'filters:{}',
      observationCount: 0, warningCount: 0, statsJson: '{}', warningsJson: '[]',
      retryHintsJson: 'null', createdAt: clock.toISOString(), updatedAt: clock.toISOString(), deletedAt: null,
    }).run()
    const intake = await createSqliteRawSourceRepository(database, () => clock).ingestBatch({
      records: [{
        adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.14.0' },
        capture: { connectorInstanceId: instance.id, connectorRunId: 'run-one', executionScopeId: instance.executionScopeId },
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
    repository.enqueue({
      captureEvidenceVersionId: intake.receipts[0].revision.id,
      connectorInstanceId: instance.id,
      executionScopeId: instance.executionScopeId,
      inputHash: hashJson({ raw: intake.receipts[0].revision.contentHash, resolver: declaration }),
      intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
      providerRecordId: 'jobright.public:provider-one',
      resolverId: declaration.id,
      resolverVersion: declaration.version,
    })
    const claim = repository.claimDue(clock.toISOString())
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
    const normalizationRepository = createSqliteNormalizationRepository(database)
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
    expect(database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({ state: 'completed', nextAttemptAt: null }),
    ])
    const outcomes = database.select().from(normalizationFieldOutcomes).all()
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
    sqlite.close()
  })

  it('persists an exact custom employer destination and projects its candidate', async () => {
    const exactUrl = 'https://careers.example.com/openings/software-engineer?source=jobright&ref=a%2Bb'
    const fixture = await createExecutorFixture({
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

    expect(fixture.database.select().from(retryWork).get()).toMatchObject({
      state: 'completed',
      nextAttemptAt: null,
    })
    expect(fixture.database.select().from(normalizationFieldOutcomes).all()
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
    expect(fixture.normalizationRepository.getLatestForRevision(
      fixture.claim.captureEvidenceVersionId,
    )).toMatchObject({
      canonicalCandidate: expect.objectContaining({
        destination: expect.objectContaining({ url: exactUrl }),
      }),
      gate: expect.objectContaining({ status: 'passed' }),
    })

    fixture.sqlite.close()
  })

  it('advances the durable attempt number when retry work becomes due again', async () => {
    let clock = new Date('2026-07-16T12:00:00.000Z')
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectors = createSqliteConnectorRepository(database)
    const instance = await connectors.upsertInstance({
      id: 'jobright-retry', connectorId: 'jobright.resolver', connectorVersion: '0.14.0',
      displayName: 'Jobright', enabled: true, createdAt: clock.toISOString(),
    })
    database.insert(connectorRuns).values({
      id: 'run-retry', executionScopeId: instance.executionScopeId,
      connectorInstanceId: instance.id, mode: 'manual', status: 'running',
      startedAt: clock.toISOString(), completedAt: null,
      coverageStartedAt: null, coverageEndedAt: clock.toISOString(),
      configJson: '{}', filtersJson: '{}', filterSignature: 'filters:{}',
      observationCount: 0, warningCount: 0, statsJson: '{}', warningsJson: '[]',
      retryHintsJson: 'null', createdAt: clock.toISOString(), updatedAt: clock.toISOString(), deletedAt: null,
    }).run()
    const intake = await createSqliteRawSourceRepository(database, () => clock).ingestBatch({
      records: [{
        adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.14.0' },
        capture: { connectorInstanceId: instance.id, connectorRunId: 'run-retry', executionScopeId: instance.executionScopeId },
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
    repository.enqueue({
      captureEvidenceVersionId: intake.receipts[0].revision.id,
      connectorInstanceId: instance.id,
      executionScopeId: instance.executionScopeId,
      inputHash: hashJson({ raw: intake.receipts[0].revision.contentHash, resolver: declaration }),
      intermediaryUrl: 'https://jobright.ai/jobs/info/provider-retry',
      providerRecordId: 'jobright.public:provider-retry',
      resolverId: declaration.id,
      resolverVersion: declaration.version,
    })
    const firstClaim = repository.claimDue(clock.toISOString())
    expect(firstClaim?.attempt).toBe(1)
    const normalizationRepository = createSqliteNormalizationRepository(database)
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

    const nextDueAt = repository.nextDueAt()
    expect(nextDueAt).not.toBeNull()
    clock = new Date(nextDueAt!)
    expect(repository.claimDue(nextDueAt!)?.attempt).toBe(2)
    sqlite.close()
  })

  it('persists bounded Retry-After evidence on the affected provider operation', async () => {
    const fixture = await createExecutorFixture({
      resolve: async () => ({
        status: 'retryable' as const,
        reason: 'jobright_rate_limited',
        retryReason: 'rate_limit' as const,
        serverMinimumDelayMs: 120_000,
      }),
    })

    await fixture.execute(fixture.claim)

    expect(fixture.database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        state: 'scheduled',
        computedDelayMs: 120_001,
        nextAttemptAt: '2026-07-16T12:02:00.001Z',
        serverMinimumDelayMs: 120_000,
      }),
    ])
    const lineage = JSON.parse(fixture.database.select().from(retryWork).get()!.lineageJson)
    expect(lineage.failureEvidence).toEqual({
      reason: 'jobright_rate_limited',
      retryReason: 'rate_limit',
      serverMinimumDelayMs: 120_000,
    })

    fixture.sqlite.close()
  })

  it('does not rely on a post-normalization write for retryable failure evidence', async () => {
    const fixture = await createExecutorFixture({
      resolve: async () => ({
        status: 'retryable' as const,
        reason: 'jobright_rate_limited',
        retryReason: 'rate_limit' as const,
        serverMinimumDelayMs: 120_000,
      }),
    })
    vi.spyOn(fixture.repository, 'recordFailureEvidence').mockImplementation(() => {
      throw new Error('simulated crash after normalization commit')
    })

    await expect(fixture.execute(fixture.claim)).resolves.toBeUndefined()

    const row = fixture.database.select().from(retryWork).get()!
    expect(row).toMatchObject({
      state: 'scheduled',
      attempt: 1,
      nextAttemptAt: '2026-07-16T12:02:00.001Z',
    })
    expect(JSON.parse(row.lineageJson).failureEvidence).toEqual({
      reason: 'jobright_rate_limited',
      retryReason: 'rate_limit',
      serverMinimumDelayMs: 120_000,
    })

    fixture.sqlite.close()
  })

  it('exhausts only the claimed provider operation at the attempt limit', async () => {
    const fixture = await createExecutorFixture({
      resolve: async () => ({
        status: 'retryable' as const,
        reason: 'jobright_upstream_failed',
        retryReason: 'server_failure' as const,
      }),
      attempt: 3,
    })

    await fixture.execute(fixture.claim)

    expect(fixture.database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        state: 'exhausted',
        nextAttemptAt: null,
        attempt: 3,
      }),
    ])
    const outcomes = fixture.database.select().from(normalizationFieldOutcomes).all()
      .map(({ outcomeJson }) => JSON.parse(outcomeJson))
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'exhausted', field: 'destinationUrl' }),
    ]))
    expect(JSON.parse(fixture.database.select().from(retryWork).get()!.lineageJson).failureEvidence)
      .toEqual({
        reason: 'jobright_upstream_failed',
        retryReason: 'server_failure',
        serverMinimumDelayMs: null,
      })

    fixture.sqlite.close()
  })

  it('persists runtime-limit interruption as a bounded retry outcome', async () => {
    const fixture = await createExecutorFixture({
      resolve: async () => ({ status: 'interrupted' as const, reason: 'runtime_limit' as const }),
    })

    await expect(fixture.execute(fixture.claim)).resolves.toBeUndefined()
    expect(fixture.database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({ state: 'scheduled', acquisitionToken: null, acquiredAt: null }),
    ])
    const outcomes = fixture.database.select().from(normalizationFieldOutcomes).all()
      .map(({ outcomeJson }) => JSON.parse(outcomeJson))
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'retry', field: 'destinationUrl',
        retry: expect.objectContaining({ reason: 'operation_timeout', state: 'scheduled' }),
      }),
    ]))

    fixture.sqlite.close()
  })

  it('persists non-cancellation resolver throws as a bounded retry outcome', async () => {
    const fixture = await createExecutorFixture({
      resolve: async () => { throw new Error('provider resolver crashed') },
    })

    await expect(fixture.execute(fixture.claim)).resolves.toBeUndefined()
    expect(fixture.database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({ state: 'scheduled', acquisitionToken: null, acquiredAt: null }),
    ])
    const lineage = JSON.parse(fixture.database.select().from(retryWork).get()!.lineageJson)
    expect(lineage.failureEvidence).toMatchObject({ reason: 'provider_url_resolver_exception' })

    fixture.sqlite.close()
  })

  it('releases unchanged only for an actual shutdown cancellation', async () => {
    const fixture = await createExecutorFixture({
      resolve: async () => { throw new Error('provider resolver aborted') },
    })
    const controller = new AbortController()
    controller.abort()

    await expect(fixture.execute(fixture.claim, controller.signal)).rejects.toThrow('provider resolver aborted')
    expect(fixture.database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({ state: 'scheduled', acquisitionToken: null, acquiredAt: null, attempt: 1 }),
    ])
    expect(fixture.database.select().from(normalizationFieldOutcomes).all()).toHaveLength(0)

    fixture.sqlite.close()
  })

  it('isolates terminal resolver outcomes and records the sanitized evidence', async () => {
    const fixture = await createExecutorFixture({
      resolve: async () => ({
        status: 'terminal' as const,
        reason: 'jobright_auth_required',
        action: 'authenticate' as const,
        parserChanged: false,
        evidence: [{ kind: 'auth_state' }],
      }),
    })
    vi.spyOn(fixture.repository, 'recordFailureEvidence').mockImplementation(() => {
      throw new Error('simulated crash after normalization commit')
    })

    await expect(fixture.execute(fixture.claim)).resolves.toBeUndefined()

    expect(fixture.database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({ state: 'cancelled', nextAttemptAt: null }),
    ])
    const lineage = JSON.parse(fixture.database.select().from(retryWork).get()!.lineageJson)
    expect(lineage.failureEvidence).toEqual({
      action: 'authenticate',
      parserChanged: false,
      reason: 'jobright_auth_required',
    })
    const outcomes = fixture.database.select().from(normalizationFieldOutcomes).all()
      .map(({ outcomeJson }) => JSON.parse(outcomeJson))
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'destinationUrl',
        status: 'blocked',
        reason: 'jobright_auth_required',
        evidence: [{ kind: 'auth_state', value: null }],
      }),
    ]))

    fixture.sqlite.close()
  })

  it('turns a non-cancellation resolver throw into a durable retry before normalization', async () => {
    const fixture = await createExecutorFixture({
      resolve: async () => {
        throw new Error('provider resolver crashed')
      },
    })

    await expect(fixture.execute(fixture.claim)).resolves.toBeUndefined()
    expect(fixture.database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        state: 'scheduled',
        acquisitionToken: null,
        acquiredAt: null,
      }),
    ])
    const lineage = JSON.parse(fixture.database.select().from(retryWork).get()!.lineageJson)
    expect(lineage.failureEvidence).toMatchObject({ reason: 'provider_url_resolver_exception' })

    fixture.sqlite.close()
  })

  it('releases a claim when normalization persistence throws before completion', async () => {
    const normalizationError = new Error('normalization persistence failed')
    const normalize = vi.fn(async () => {
      throw normalizationError
    })
    const fixture = await createExecutorFixture({
      resolve: async () => ({
        status: 'resolved' as const,
        url: 'https://jobs.lever.co/example/opening-1',
        method: 'jobright_api_detail',
      }),
      normalizationOrchestrator: { normalize } as unknown as ReturnType<typeof createNormalizationOrchestrator>,
    })

    await expect(fixture.execute(fixture.claim)).rejects.toBe(normalizationError)
    expect(normalize).toHaveBeenCalledTimes(1)
    expect(fixture.database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        state: 'scheduled',
        acquisitionToken: null,
        acquiredAt: null,
      }),
    ])

    fixture.sqlite.close()
  })
})

async function createExecutorFixture(options: {
  attempt?: number
  normalizationOrchestrator?: ReturnType<typeof createNormalizationOrchestrator>
  pureNormalizationRegistry?: ReturnType<typeof createNormalizationResolverRegistry>
  resolve: Parameters<typeof createProviderUrlResolutionExecutor>[0]['resolve']
}) {
  const clock = new Date('2026-07-16T12:00:00.000Z')
  const sqlite = createInMemoryDatabase()
  migrateDatabase(sqlite)
  const database = createDrizzleDatabase(sqlite)
  const connectors = createSqliteConnectorRepository(database)
  const instance = await connectors.upsertInstance({
    id: 'jobright-fixture', connectorId: 'jobright.resolver', connectorVersion: '0.14.0',
    displayName: 'Jobright', enabled: true, createdAt: clock.toISOString(),
  })
  database.insert(connectorRuns).values({
    id: 'run-fixture', executionScopeId: instance.executionScopeId,
    connectorInstanceId: instance.id, mode: 'manual', status: 'running',
    startedAt: clock.toISOString(), completedAt: null,
    coverageStartedAt: null, coverageEndedAt: clock.toISOString(),
    configJson: '{}', filtersJson: '{}', filterSignature: 'filters:{}',
    observationCount: 0, warningCount: 0, statsJson: '{}', warningsJson: '[]',
    retryHintsJson: 'null', createdAt: clock.toISOString(), updatedAt: clock.toISOString(), deletedAt: null,
  }).run()
  const intake = await createSqliteRawSourceRepository(database, () => clock).ingestBatch({
    records: [{
      adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.14.0' },
      capture: { connectorInstanceId: instance.id, connectorRunId: 'run-fixture', executionScopeId: instance.executionScopeId },
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
  repository.enqueue({
    captureEvidenceVersionId: intake.receipts[0].revision.id,
    connectorInstanceId: instance.id,
    executionScopeId: instance.executionScopeId,
    inputHash: hashJson({ raw: intake.receipts[0].revision.contentHash, resolver: declaration }),
    intermediaryUrl: 'https://jobright.ai/jobs/info/provider-fixture',
    providerRecordId: 'jobright.public:provider-fixture',
    resolverId: declaration.id,
    resolverVersion: declaration.version,
  })
  if (options.attempt !== undefined) {
    database.update(retryWork).set({ attempt: options.attempt }).run()
  }
  const claim = repository.claimDue(clock.toISOString())
  if (!claim) throw new Error('Provider URL fixture claim was not created')
  const normalizationRepository = createSqliteNormalizationRepository(database)
  const execute = createProviderUrlResolutionExecutor({
    normalizationOrchestrator: options.normalizationOrchestrator ?? createNormalizationOrchestrator({
      repository: normalizationRepository,
      registry: { resolvers: [], resolverSetHash: 'sha256:empty' },
      now: () => clock,
    }),
    normalizationRepository,
    pureNormalizationRegistry: options.pureNormalizationRegistry,
    now: () => clock,
    random: () => 0,
    repository,
    resolve: options.resolve,
  })
  return { claim, database, execute, normalizationRepository, repository, sqlite }
}
