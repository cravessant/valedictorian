import { describe, expect, it } from 'vitest'
import { normalizationRuns, retryWork } from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from '../connectors/connector.repository'
import { selectPendingRetryWork } from '../connectors/connector.retry-work'
import { createSqliteNormalizationRepository } from './normalization.repository'
import { createSqliteRawSourceRepository } from './raw-source.repository'
import { createNormalizationOrchestrator } from './normalization.orchestrator'
import { createNormalizationResolverRegistry, type NormalizationResolver } from './normalization.registry'

describe('normalization repository acquired retry identity', () => {
  it('preserves the original execution scope through consecutive retryable direct replays', async () => {
    const sqlite = createInMemoryDatabase(); migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite); const connectors = createSqliteConnectorRepository(database)
    const instance = await connectors.upsertInstance({ id: 'scope-replay', connectorId: 'fixture', connectorVersion: '1', displayName: 'Scope replay', enabled: true })
    const intakeRun = await connectors.recordRunRequest({ connectorInstanceId: instance.id, mode: 'manual', startedAt: '2026-07-11T12:00:00.000Z' })
    const receipt = (await createSqliteRawSourceRepository(database).ingestBatch({ records: [{
      adapter: { id: 'fixture', kind: 'connector', version: '1' },
      capture: { connectorInstanceId: instance.id, connectorRunId: intakeRun.run.id, executionScopeId: instance.executionScopeId },
      observedAt: '2026-07-11T12:00:00.000Z', providerRecordId: 'job', payload: { title: 'Intern' },
    }] })).receipts[0]
    let attempt = 0
    const resolver: NormalizationResolver = { declaration: { id: 'fixture.retry', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['destinationUrl'], capabilities: ['network'], scopeRequirement: 'source', costClass: 'high', precedence: 1 },
      resolve(context) { attempt += 1; const at = `2026-07-11T12:0${attempt}:00.000Z`; return [{ resolverId: 'fixture.retry', resolverVersion: '1.0.0', field: 'destinationUrl',
        inputHash: context.hashInput('destination'), status: 'retry', retry: { state: 'scheduled', reason: 'server_failure', attempt, maxAttempts: 4,
          lastAttemptAt: at, computedDelayMs: 1000, nextAttemptAt: at.replace(':00.000Z', ':01.000Z'), horizonAt: '2026-07-11T13:00:00.000Z' } }] } }
    const orchestrator = createNormalizationOrchestrator({ repository: createSqliteNormalizationRepository(database), registry: createNormalizationResolverRegistry([resolver]),
      now: () => new Date(`2026-07-11T12:0${attempt + 1}:00.000Z`) })
    const initial = await orchestrator.normalize(receipt.rawRecordId, receipt.revision.id, { kind: 'intake' }, { triggerOccurrence: receipt.occurrence, enabledCapabilities: ['network'] })
    expect(initial.fieldOutcomes).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'retry' })]))
    expect(database.select().from(retryWork).get()).toBeDefined()
    await connectors.markRunRunning({ connectorRunId: intakeRun.run.id, startedAt: '2026-07-11T12:00:00.000Z' })
    await connectors.completeRun({ connectorRunId: intakeRun.run.id, completedAt: '2026-07-11T12:01:00.000Z', status: 'completed' })
    expect(database.select().from(retryWork).get()).toMatchObject({ executionScopeId: instance.executionScopeId,
      lineageJson: expect.stringContaining('scope-replay'), state: 'scheduled' })
    expect(sqlite.prepare('select status from source_execution_scopes where id=?').get(instance.executionScopeId)).toEqual({ status: 'available' })
    expect(sqlite.prepare("select json_extract(lineage_json,'$.connectorInstanceId') as id from retry_work").get()).toEqual({ id: instance.id })
    for (const minute of [1, 2]) {
      expect(sqlite.prepare("select r.id from retry_work r join source_execution_scopes s on s.id=r.execution_scope_id where r.state='scheduled' and json_extract(r.lineage_json,'$.connectorInstanceId')='scope-replay' and s.status='available'").all()).toHaveLength(1)
      expect(selectPendingRetryWork(database, { connectorInstanceId: instance.id, connectorId: instance.connectorId,
        executionScopeId: instance.executionScopeId,
        coverageStartedAt: '2026-07-01T00:00:00.000Z', filterSignature: 'filters:{}', now: `2026-07-11T12:0${minute}:01.000Z` }))
        .toMatchObject({ executionScopeId: instance.executionScopeId, state: 'scheduled' })
      const acquired = await connectors.recordRunRequest({ connectorInstanceId: instance.id, mode: 'manual', startedAt: `2026-07-11T12:0${minute}:01.000Z` })
      expect(acquired.acquiredWork).toMatchObject({ kind: 'normalization', executionScopeId: instance.executionScopeId })
      const work = acquired.acquiredWork!
      if (work.kind !== 'normalization') throw new Error('Expected normalization work')
      await connectors.markRunRunning({ connectorRunId: acquired.run.id, startedAt: `2026-07-11T12:0${minute}:00.000Z` })
      await orchestrator.normalize(receipt.rawRecordId, receipt.revision.id,
        { kind: 'replay', replayId: `retry-${minute}`, fieldDirectives: [], targetResolverVersions: [{ resolverId: work.resolverId, version: work.resolverVersion }] },
        { acquiredRetryWork: { retryWorkId: work.retryWorkId, acquisitionRunId: acquired.run.id, executionScopeId: work.executionScopeId },
          cache: false, enabledCapabilities: ['network'], registry: createNormalizationResolverRegistry([resolver]) })
      expect(database.select().from(retryWork).get()).toMatchObject({ state: 'scheduled', executionScopeId: instance.executionScopeId, attempt: minute + 1 })
      await connectors.completeRun({ connectorRunId: acquired.run.id, completedAt: `2026-07-11T12:0${minute}:30.000Z`, status: 'completed' })
    }
    expect(sqlite.prepare('select count(*) as count from raw_source_occurrences').get()).toEqual({ count: 1 })
    sqlite.close()
  })
  it('rejects exact acquired replay when persisted attempt input hash does not match acquired work', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)
    const rawRepository = createSqliteRawSourceRepository(database)
    const normalizationRepository = createSqliteNormalizationRepository(database)
    const instance = await connectorRepository.upsertInstance({
      id: 'fixture-instance',
      connectorId: 'fixture.connector',
      connectorVersion: '1.0.0',
      displayName: 'Fixture',
      enabled: true,
    })
    const acquisition = await connectorRepository.recordRunRequest({
      connectorInstanceId: 'fixture-instance',
      mode: 'catch_up',
      startedAt: '2026-07-11T12:00:30.000Z',
    })
    await connectorRepository.markRunRunning({
      connectorRunId: acquisition.run.id,
      startedAt: '2026-07-11T12:00:30.000Z',
    })
    const receipt = (await rawRepository.ingestBatch({
      records: [{
        adapter: { id: 'fixture.connector', kind: 'connector', version: '1.0.0' },
        capture: {
          connectorInstanceId: instance.id,
          connectorRunId: acquisition.run.id,
          executionScopeId: instance.executionScopeId,
        },
        observedAt: '2026-07-11T12:00:00.000Z',
        providerRecordId: 'hash-mismatch-job',
        payload: { companyName: 'Hash Co', roleTitle: 'Intern' },
      }],
    })).receipts[0]

    const acquisitionRunId = acquisition.run.id
    const retryWorkId = 'retry-work-hash-mismatch'
    const acquiredInputHash = 'sha256:acquired-input-hash'
    const mismatchedAttemptHash = 'sha256:mismatched-attempt-hash'
    database.insert(retryWork).values({
      id: retryWorkId,
      executionScopeId: instance.executionScopeId,
      kind: 'normalization',
      connectorInstanceId: null,
      filterSignature: null,
      checkpointSchemaVersion: null,
      checkpointGeneration: null,
      rawRevisionId: receipt.revision.id,
      resolverId: 'fixture.network-details',
      resolverVersion: '2.0.0',
      inputHash: acquiredInputHash,
      reason: 'server_failure',
      attempt: 1,
      maxAttempts: 3,
      lastAttemptAt: '2026-07-11T12:00:00.000Z',
      computedDelayMs: 30_000,
      serverMinimumDelayMs: null,
      nextAttemptAt: '2026-07-11T12:00:30.000Z',
      horizonAt: '2026-07-11T13:00:00.000Z',
      state: 'acquired',
      ownerVersion: '2.0.0',
      lineageJson: JSON.stringify({ connectorInstanceId: 'fixture-instance' }),
      acquiredAt: '2026-07-11T12:00:30.000Z',
      acquisitionToken: 'token-hash-mismatch',
      acquisitionRunId,
      skippedRunId: null,
      createdAt: '2026-07-11T12:00:00.000Z',
      updatedAt: '2026-07-11T12:00:30.000Z',
      deletedAt: null,
    }).run()

    const runsBefore = database.select().from(normalizationRuns).all().length
    expect(() => normalizationRepository.persist({
      runId: 'normalization-run-hash-mismatch',
      rawRecordId: receipt.rawRecordId,
      rawRevisionId: receipt.revision.id,
      inputHash: 'sha256:run-input',
      resolverSetHash: 'sha256:resolver-set',
      canonicalSchemaVersion: 'canonical-candidate@1',
      gatePolicyVersion: 'normalization-gate@1',
      status: 'completed',
      acquiredRetryWork: {
        retryWorkId,
        acquisitionRunId,
        executionScopeId: instance.executionScopeId,
      },
      attempts: [{
        id: 'attempt-hash-mismatch',
        resolver: {
          id: 'fixture.network-details',
          version: '2.0.0',
          requiredInputs: ['rawRevision'],
          outputFields: ['destinationUrl'],
          capabilities: ['network'],
          costClass: 'high',
          precedence: 500,
        },
        applicability: [],
        inputHash: mismatchedAttemptHash,
        status: 'completed',
        startedAt: '2026-07-11T12:00:31.000Z',
        completedAt: '2026-07-11T12:00:31.000Z',
        outcomes: [{
          resolverId: 'fixture.network-details',
          resolverVersion: '2.0.0',
          field: 'destinationUrl',
          inputHash: mismatchedAttemptHash,
          status: 'resolved',
          value: 'https://jobs.lever.co/example/hash-mismatch',
        }],
      }],
      candidate: null,
      gate: {
        status: 'needs_enrichment',
        policyVersion: 'normalization-gate@1',
        evaluatedAt: '2026-07-11T12:00:31.000Z',
        missingFields: ['companyName'],
        reason: 'incomplete',
      },
      now: '2026-07-11T12:00:31.000Z',
    })).toThrow(/acquired normalization retry identity/i)

    expect(database.select().from(normalizationRuns).all()).toHaveLength(runsBefore)
    expect(database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        id: retryWorkId,
        state: 'acquired',
        inputHash: acquiredInputHash,
        acquisitionRunId,
        acquisitionToken: 'token-hash-mismatch',
        nextAttemptAt: '2026-07-11T12:00:30.000Z',
      }),
    ])
    sqlite.close()
  })
})
