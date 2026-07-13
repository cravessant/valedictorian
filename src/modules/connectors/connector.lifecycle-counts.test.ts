import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  canonicalSourceCandidates,
  connectorRuns,
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationGates,
  normalizationRuns,
  sourcingFindings,
  sources,
  workflowRuns,
} from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteRawSourceRepository } from '../sourcing/raw-source.repository'
import { reconcileConnectorRunLifecycleCounts } from './connector.lifecycle-counts'
import { createSqliteConnectorRepository } from './connector.repository'

describe('connector run lifecycle counts', () => {
  it('reconciles provider rows while repeated occurrences remain one captured record', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectors = createSqliteConnectorRepository(database)
    const rawSources = createSqliteRawSourceRepository(
      database,
      () => new Date('2026-07-11T17:00:00.000Z'),
    )

    await connectors.upsertInstance({
      id: 'jobright-fixture',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Jobright fixture',
      enabled: true,
    })
    const run = await connectors.recordRefreshResult({
      connectorInstanceId: 'jobright-fixture',
      mode: 'manual',
      startedAt: '2026-07-11T16:59:00.000Z',
      completedAt: '2026-07-11T17:00:00.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        coverage: { start: '2026-07-11T16:00:00.000Z', end: '2026-07-11T17:00:00.000Z' },
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture@1' },
        observations: [],
        stats: {
          observations: 0,
          providerReturned: 4,
          providerValid: 3,
          providerInvalid: 1,
          sourceDuplicates: 1,
        },
        warnings: [],
      },
    })
    const record = {
      adapter: { id: 'jobright.resolver', kind: 'connector' as const, version: '0.6.0' },
      capture: { connectorInstanceId: 'jobright-fixture', connectorRunId: run.id, executionScopeId: run.executionScopeId },
      observedAt: '2026-07-11T16:59:30.000Z',
      providerRecordId: 'job-1',
      providerSchema: 'jobright-visitor-list@1',
      payload: { jobResult: { jobId: 'job-1' } },
    }
    await rawSources.ingestBatch({ records: [
      record,
      record,
      {
        ...record,
        providerRecordId: 'job-2',
        payload: { jobResult: { jobId: 'job-2' } },
      },
      {
        ...record,
        providerRecordId: undefined,
        payload: { malformed: true },
      },
    ] })

    expect(reconcileConnectorRunLifecycleCounts(database, run)).toMatchObject({
      scope: { kind: 'connector_run', connectorRunId: run.id, executionScopeId: run.executionScopeId },
      provider: {
        returnedRows: 4,
        validRecords: 2,
        invalidRecords: 1,
        sourceDuplicates: 1,
        capturedRecords: 3,
        occurrenceCount: 4,
      },
    })
  })

  it.each([
    ['missing returned rows with occurrences', { providerValid: 1, providerInvalid: 0, sourceDuplicates: 0 }, true, 'reported_stats_missing', ['missing_provider_returned']],
    ['missing valid records', { providerReturned: 1, providerInvalid: 0, sourceDuplicates: 0 }, false, 'reported_stats_missing', ['missing_provider_valid']],
    ['missing invalid records', { providerReturned: 1, providerValid: 1, sourceDuplicates: 0 }, true, 'reported_stats_missing', ['missing_provider_invalid']],
    ['missing source duplicates', { providerReturned: 1, providerValid: 1, providerInvalid: 0 }, false, 'reported_stats_missing', ['missing_source_duplicates']],
    ['negative returned rows', { providerReturned: -1, providerValid: 0, providerInvalid: 0, sourceDuplicates: 0 }, false, 'reported_stats_invalid', ['invalid_provider_returned']],
    ['fractional valid records with occurrences', { providerReturned: 1, providerValid: 0.5, providerInvalid: 0, sourceDuplicates: 0 }, true, 'reported_stats_invalid', ['invalid_provider_valid']],
    ['unsafe invalid records', { providerReturned: 1, providerValid: 1, providerInvalid: Number.MAX_SAFE_INTEGER + 1, sourceDuplicates: 0 }, false, 'reported_stats_invalid', ['invalid_provider_invalid']],
    ['negative source duplicates with occurrences', { providerReturned: 1, providerValid: 1, providerInvalid: 0, sourceDuplicates: -1 }, true, 'reported_stats_invalid', ['invalid_source_duplicates']],
    ['inconsistent returned equation', { providerReturned: 3, providerValid: 1, providerInvalid: 1, sourceDuplicates: 0 }, false, 'reported_totals_inconsistent', ['provider_equation_mismatch']],
    ['duplicates exceed valid records with occurrences', { providerReturned: 1, providerValid: 1, providerInvalid: 0, sourceDuplicates: 2 }, true, 'reported_totals_inconsistent', ['source_duplicates_exceed_valid']],
    ['multiple inconsistent relationships', { providerReturned: 4, providerValid: 1, providerInvalid: 1, sourceDuplicates: 2 }, false, 'reported_totals_inconsistent', ['source_duplicates_exceed_valid', 'provider_equation_mismatch']],
  ] as const)(
    'never reports reconciled for %s',
    async (_name, stats, withOccurrence, invariant, gaps) => {
      const fixture = await createRunFixture(`provider-quality-${_name.replace(/ /g, '-')}`)
      if (withOccurrence) {
        await fixture.rawSources.ingestBatch({ records: [{
          adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.6.0' },
          capture: {
            connectorInstanceId: fixture.connectorInstanceId,
            connectorRunId: fixture.run.id,
            executionScopeId: fixture.run.executionScopeId,
          },
          observedAt: '2026-07-11T17:00:00.000Z',
          providerRecordId: 'job-provider-quality',
          providerSchema: 'jobright-visitor-list@1',
          payload: { jobResult: { jobId: 'job-provider-quality' } },
        }] })
      }

      expect(reconcileConnectorRunLifecycleCounts(fixture.database, {
        ...fixture.run,
        stats,
      }).provider).toMatchObject({ invariant, gaps })
    },
  )

  it('partitions captured records by their latest persisted normalization and destination outcome', async () => {
    const fixture = await createRunFixture('destination-partition')
    const classes = [
      'employer_or_ats',
      'third_party_job_posting',
      'unresolved',
      'pending',
      'gate_rejected',
    ] as const

    for (const [index, outcome] of classes.entries()) {
      const receipt = (await fixture.rawSources.ingestBatch({ records: [{
        adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.6.0' },
        capture: {
          connectorInstanceId: fixture.connectorInstanceId,
          connectorRunId: fixture.run.id,
            executionScopeId: fixture.run.executionScopeId,
        },
        observedAt: `2026-07-11T17:00:0${index}.000Z`,
        providerRecordId: `job-${index}`,
        providerSchema: 'jobright-visitor-list@1',
        payload: { jobResult: { jobId: `job-${index}` } },
      }] })).receipts[0]
      persistNormalizationOutcome(fixture.database, receipt, outcome, index)
    }

    expect(reconcileConnectorRunLifecycleCounts(fixture.database, fixture.run)).toMatchObject({
      destination: {
        normalized: 2,
        resolvedEmployerOrAts: 1,
        resolvedThirdParty: 1,
        unresolved: 1,
        pending: 1,
        gateRejected: 1,
        unclassified: 0,
        invariant: 'reconciled',
      },
    })
  })

  it('partitions normalized jobs into exhaustive sourcing dispositions and requires a concrete review question', async () => {
    const fixture = await createRunFixture('sourcing-partition')
    const dispositions = [
      { status: 'new' },
      { status: 'merged' },
      { status: 'duplicate' },
      { status: 'not_fit' },
      { status: 'below_cutoff' },
      { status: 'blocked', blocker: 'Which country is this job in?' },
      { status: 'blocked', blocker: 'Old question', dispositionReason: 'User rejected it.' },
    ] as const

    for (const [offset, disposition] of dispositions.entries()) {
      const index = offset + 10
      const receipt = (await fixture.rawSources.ingestBatch({ records: [{
        adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.6.0' },
        capture: {
          connectorInstanceId: fixture.connectorInstanceId,
          connectorRunId: fixture.run.id,
            executionScopeId: fixture.run.executionScopeId,
        },
        observedAt: `2026-07-11T17:02:${index}.000Z`,
        providerRecordId: `job-${index}`,
        providerSchema: 'jobright-visitor-list@1',
        payload: { jobResult: { jobId: `job-${index}` } },
      }] })).receipts[0]
      persistNormalizationOutcome(fixture.database, receipt, 'employer_or_ats', index)
      persistFinding(fixture.database, receipt.sourceEntityId!, index, disposition)
    }

    expect(reconcileConnectorRunLifecycleCounts(fixture.database, fixture.run)).toMatchObject({
      sourcing: {
        added: 2,
        queueDuplicate: 1,
        notFit: 1,
        rejected: 2,
        actionableReview: 1,
        unclassified: 0,
        invariant: 'reconciled',
      },
    })
  })

  it('reloads a frozen terminal snapshot instead of reinterpreting a later finding disposition', async () => {
    const fixture = await createRunFixture('frozen-reload')
    const receipt = (await fixture.rawSources.ingestBatch({ records: [{
      adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.6.0' },
      capture: {
        connectorInstanceId: fixture.connectorInstanceId,
        connectorRunId: fixture.run.id,
            executionScopeId: fixture.run.executionScopeId,
      },
      observedAt: '2026-07-11T17:04:00.000Z',
      providerRecordId: 'job-frozen',
      providerSchema: 'jobright-visitor-list@1',
      payload: { jobResult: { jobId: 'job-frozen' } },
    }] })).receipts[0]
    persistNormalizationOutcome(fixture.database, receipt, 'employer_or_ats', 30)
    persistFinding(fixture.database, receipt.sourceEntityId!, 30, { status: 'new' })

    const repository = createSqliteConnectorRepository(fixture.database)
    fixture.database.update(connectorRuns).set({
      status: 'running',
      completedAt: null,
    }).where(eq(connectorRuns.id, fixture.run.id)).run()
    await repository.completeRun({
      connectorRunId: fixture.run.id,
            executionScopeId: fixture.run.executionScopeId,
      completedAt: '2026-07-11T17:04:01.000Z',
      status: 'completed',
    })
    fixture.database.update(sourcingFindings).set({
      mergeStatus: 'not_fit',
      dispositionReason: 'Changed after the connector run completed.',
    }).where(eq(sourcingFindings.id, 'finding-30')).run()

    const reloaded = await createSqliteConnectorRepository(fixture.database).listRuns({
      connectorInstanceId: fixture.connectorInstanceId,
    })
    expect(reloaded.items[0].stats).toMatchObject({
      lifecycleCounts: {
        source: 'frozen_terminal',
        sourcing: { added: 1, notFit: 0 },
      },
    })
  })

  it('reuses prior current-schema normalization on restart without inflating unique run counts', async () => {
    const first = await createRunFixture('restart-first')
    const raw = {
      adapter: { id: 'jobright.resolver', kind: 'connector' as const, version: '0.6.0' },
      capture: {
        connectorInstanceId: first.connectorInstanceId,
        connectorRunId: first.run.id,
        executionScopeId: first.run.executionScopeId,
      },
      observedAt: '2026-07-11T17:05:00.000Z',
      providerRecordId: 'job-restart',
      providerSchema: 'jobright-visitor-list@1',
      payload: { jobResult: { jobId: 'job-restart' } },
    }
    const firstReceipt = (await first.rawSources.ingestBatch({ records: [raw] })).receipts[0]
    persistNormalizationOutcome(first.database, firstReceipt, 'employer_or_ats', 40)
    persistFinding(first.database, firstReceipt.sourceEntityId!, 40, { status: 'new' })

    const connectors = createSqliteConnectorRepository(first.database)
    const restartedRun = await connectors.recordRefreshResult({
      connectorInstanceId: first.connectorInstanceId,
      mode: 'manual',
      startedAt: '2026-07-11T17:06:00.000Z',
      completedAt: '2026-07-11T17:06:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        coverage: { start: '2026-07-11T17:05:00.000Z', end: '2026-07-11T17:06:00.000Z' },
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture@1' },
        observations: [],
        stats: { observations: 0, providerReturned: 1, providerValid: 1, providerInvalid: 0, sourceDuplicates: 0 },
        warnings: [],
      },
    })
    await first.rawSources.ingestBatch({ records: [{
      ...raw,
      capture: {
        connectorInstanceId: first.connectorInstanceId,
        connectorRunId: restartedRun.id,
        executionScopeId: restartedRun.executionScopeId,
      },
    }] })

    expect(reconcileConnectorRunLifecycleCounts(first.database, restartedRun)).toMatchObject({
      provider: { capturedRecords: 1, occurrenceCount: 1 },
      destination: { normalized: 1, resolvedEmployerOrAts: 1 },
      sourcing: { added: 1 },
    })
    expect((await connectors.listRuns({ connectorInstanceId: first.connectorInstanceId })).items[0].stats)
      .toMatchObject({ lifecycleCounts: { source: 'derived_pre_feature' } })
  })

  it('keeps repeated detail retries technical while one job remains one pending lifecycle record', async () => {
    const fixture = await createRunFixture('detail-retries')
    const receipt = (await fixture.rawSources.ingestBatch({ records: [{
      adapter: { id: 'jobright.resolver', kind: 'connector', version: '0.6.0' },
      capture: {
        connectorInstanceId: fixture.connectorInstanceId,
        connectorRunId: fixture.run.id,
            executionScopeId: fixture.run.executionScopeId,
      },
      observedAt: '2026-07-11T17:07:00.000Z',
      providerRecordId: 'job-retry',
      providerSchema: 'jobright-visitor-list@1',
      payload: { jobResult: { jobId: 'job-retry' } },
    }] })).receipts[0]
    persistNormalizationOutcome(fixture.database, receipt, 'pending', 50)
    persistNormalizationOutcome(fixture.database, receipt, 'pending', 51)

    const counts = reconcileConnectorRunLifecycleCounts(fixture.database, {
      ...fixture.run,
      stats: { attempted: 3 },
    })
    expect(counts).toMatchObject({
      provider: { capturedRecords: 1 },
      destination: { pending: 1, normalized: 0 },
      sourcing: { added: 0, actionableReview: 0 },
    })
  })
})

async function createRunFixture(id: string) {
  const sqlite = createInMemoryDatabase()
  migrateDatabase(sqlite)
  const database = createDrizzleDatabase(sqlite)
  const connectors = createSqliteConnectorRepository(database)
  const connectorInstanceId = `connector-${id}`
  await connectors.upsertInstance({
    id: connectorInstanceId,
    connectorId: 'jobright.resolver',
    connectorVersion: '0.6.0',
    displayName: 'Jobright fixture',
    enabled: true,
  })
  const run = await connectors.recordRefreshResult({
    connectorInstanceId,
    mode: 'manual',
    startedAt: '2026-07-11T16:59:00.000Z',
    completedAt: '2026-07-11T17:00:00.000Z',
    config: {},
    filters: {},
    filterSignature: 'filters:{}',
    result: {
      coverage: { start: '2026-07-11T16:00:00.000Z', end: '2026-07-11T17:00:00.000Z' },
      nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture@1' },
      observations: [],
      stats: { observations: 0 },
      warnings: [],
    },
  })
  return {
    connectorInstanceId,
    database,
    rawSources: createSqliteRawSourceRepository(database),
    run,
  }
}

function persistNormalizationOutcome(
  database: ReturnType<typeof createDrizzleDatabase>,
  receipt: Awaited<ReturnType<ReturnType<typeof createSqliteRawSourceRepository>['ingestBatch']>>['receipts'][number],
  outcome: 'employer_or_ats' | 'third_party_job_posting' | 'unresolved' | 'pending' | 'gate_rejected',
  index: number,
) {
  const runId = `normalization-${index}`
  const attemptId = `attempt-${index}`
  const candidateId = outcome === 'employer_or_ats' || outcome === 'third_party_job_posting'
    ? `candidate-${index}`
    : null
  database.insert(normalizationRuns).values({
    id: runId,
    rawRecordId: receipt.rawRecordId,
    rawRevisionId: receipt.revision.id,
    triggerOccurrenceId: receipt.occurrence.id,
    triggerConnectorInstanceId: receipt.occurrence.capture?.connectorInstanceId ?? null,
    triggerConnectorRunId: receipt.occurrence.capture?.connectorRunId ?? null,
    inputHash: `input-${index}`,
    resolverSetHash: `resolvers-${index}`,
    canonicalSchemaVersion: 'canonical-source-candidate/v1',
    gatePolicyVersion: 'normalization-gate/v1',
    triggerKind: 'intake',
    triggerId: null,
    status: 'completed',
    createdAt: `2026-07-11T17:01:0${index}.000Z`,
    updatedAt: `2026-07-11T17:01:0${index}.000Z`,
  }).run()
  database.insert(normalizationAttempts).values({
    id: attemptId,
    runId,
    rawRevisionId: receipt.revision.id,
    sequence: 0,
    resolverId: 'jobright.authenticated-destination',
    resolverVersion: '1.0.0',
    inputHash: `input-${index}`,
    declarationJson: '{}',
    applicabilityJson: '[]',
    status: 'completed',
    startedAt: `2026-07-11T17:01:0${index}.000Z`,
    completedAt: `2026-07-11T17:01:0${index}.000Z`,
  }).run()
  database.insert(normalizationFieldOutcomes).values({
    id: `outcome-${index}`,
    runId,
    attemptId,
    sequence: 0,
    attemptSequence: 0,
    outcomeIndex: 0,
    field: 'destinationUrl',
    status: outcome === 'pending'
      ? 'retry'
      : outcome === 'gate_rejected'
        ? 'rejected'
        : outcome === 'unresolved'
          ? 'abstained'
          : 'resolved',
    resolverId: 'jobright.authenticated-destination',
    resolverVersion: '1.0.0',
    inputHash: `input-${index}`,
    outcomeJson: JSON.stringify({ status: outcome }),
  }).run()
  if (candidateId && receipt.sourceEntityId) {
    database.insert(canonicalSourceCandidates).values({
      id: candidateId,
      runId,
      sourceEntityId: receipt.sourceEntityId,
      rawRecordId: receipt.rawRecordId,
      rawRevisionId: receipt.revision.id,
      schemaVersion: 'canonical-source-candidate/v1',
      candidateJson: JSON.stringify({
        destination: {
          class: outcome,
          url: `https://example.test/${index}`,
        },
      }),
      createdAt: `2026-07-11T17:01:0${index}.000Z`,
    }).run()
  }
  const gateStatus = candidateId
    ? 'passed'
    : outcome === 'gate_rejected'
      ? 'rejected'
      : 'needs_enrichment'
  database.insert(normalizationGates).values({
    id: `gate-${index}`,
    runId,
    policyVersion: 'normalization-gate/v1',
    status: gateStatus,
    candidateId,
    gateJson: JSON.stringify({ status: gateStatus }),
    evaluatedAt: `2026-07-11T17:01:0${index}.000Z`,
  }).run()
}

function persistFinding(
  database: ReturnType<typeof createDrizzleDatabase>,
  sourceEntityId: string,
  index: number,
  disposition: {
    status: 'new' | 'merged' | 'duplicate' | 'not_fit' | 'below_cutoff' | 'blocked'
    blocker?: string
    dispositionReason?: string
  },
) {
  const timestamp = `2026-07-11T17:03:${index}.000Z`
  database.insert(sources).values({
    id: `source-${index}`,
    name: `Source ${index}`,
    accountHint: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }).run()
  database.insert(workflowRuns).values({
    id: `workflow-${index}`,
    runType: 'sourcing',
    status: 'completed',
    actorType: 'system',
    actorName: 'fixture',
    sourceId: `source-${index}`,
    subjectApplicationId: null,
    startedAt: timestamp,
    completedAt: timestamp,
    coverageStartedAt: null,
    coverageEndedAt: null,
    timezone: null,
    inputJson: '{}',
    summary: 'fixture',
    outcome: 'projected',
    blocker: null,
    metadataJson: '{}',
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }).run()
  database.insert(sourcingFindings).values({
    id: `finding-${index}`,
    projectionIdentityKey: `source_entity:${sourceEntityId}`,
    projectionAliasesJson: '[]',
    sourceEntityId,
    canonicalCandidateId: `candidate-${index}`,
    rawRevisionId: null,
    adapterId: 'jobright.resolver',
    adapterKind: 'connector',
    adapterVersion: '0.6.0',
    workflowRunId: `workflow-${index}`,
    sourceId: `source-${index}`,
    companyName: `Company ${index}`,
    roleTitle: `Intern ${index}`,
    roleKind: 'internship',
    term: null,
    timingMode: 'unknown',
    termsJson: '[]',
    startDate: null,
    endDate: null,
    city: null,
    region: null,
    country: 'US',
    workMode: 'unclear',
    locationRaw: null,
    employmentType: 'internship',
    seniority: 'internship',
    locationJson: null,
    compensationJson: null,
    postedAtJson: JSON.stringify({ value: null, precision: 'unknown', raw: null }),
    officialUrl: `https://example.test/${index}`,
    sourceUrl: null,
    destinationClass: 'employer_or_ats',
    destinationUrl: `https://example.test/${index}`,
    intermediaryUrl: null,
    usability: 'usable',
    postedAge: null,
    priorityScore: null,
    priorityBand: null,
    fitNotes: null,
    duplicateNotes: null,
    blocker: disposition.blocker ?? null,
    policyBlocker: disposition.blocker ? 'fixture_question' : null,
    dispositionReason: disposition.dispositionReason ?? null,
    mergeStatus: disposition.status,
    mergedApplicationId: null,
    mergeNotes: null,
    discoveredAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }).run()
}
