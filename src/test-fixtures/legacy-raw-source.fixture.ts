import {
  captureEvidenceVersions,
  captureLineages,
  captures,
  connectorInstances,
  connectorRuns,
  jobs,
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationGates,
  normalizationRuns,
  sourceExecutionScopes,
} from '../db/schema'
import { createPgliteClient, migratePgliteDatabase } from '../db/pglite'

export const LEGACY_MIXED_RAW_RECORD_ID = 'legacy-mixed-record'
export const LEGACY_VALID_CONNECTOR_RECORD_ID = 'legacy-valid-connector-record'

export const LEGACY_NESTED_JOBRIGHT_PAYLOAD = {
  decodingStatus: 'valid',
  rawType: 'object',
  providerJobId: 'consigli-coop-2027',
  providerRow: {
    jobResult: {
      jobId: 'consigli-coop-2027',
      jobTitle: 'IT Co-op (Spring 2027)',
    },
    companyResult: {
      companyName: 'Consigli Construction Co., Inc.',
    },
  },
} as const

const AT = '2026-07-10T12:00:00.000Z'
const SCOPE_ID = 'scope-legacy-connector'
const CONNECTOR_ID = 'legacy-connector'
const CONNECTOR_RUN_ID = 'legacy-connector-run'

/**
 * Seeds a caller-owned PGlite directory with a connector-captured lineage that already
 * completed normalization into needs_enrichment. Closes its owner before returning.
 */
export async function createLegacyRawSourceFixture(pgliteDataPath: string) {
  const client = await createPgliteClient({ dataDir: pgliteDataPath })
  try {
    const database = await migratePgliteDatabase(client)
    await database.insert(sourceExecutionScopes).values({
      id: SCOPE_ID,
      createdAt: AT,
      updatedAt: AT,
    })
    await database.insert(connectorInstances).values({
      id: CONNECTOR_ID,
      executionScopeId: SCOPE_ID,
      connectorId: 'fixture.connector',
      connectorVersion: '1.0.0',
      displayName: 'Fixture connector',
      enabled: true,
      configJson: '{}',
      authJson: '[]',
      filtersJson: '{}',
      createdAt: AT,
      updatedAt: AT,
    })
    await database.insert(connectorRuns).values({
      id: CONNECTOR_RUN_ID,
      executionScopeId: SCOPE_ID,
      connectorInstanceId: CONNECTOR_ID,
      mode: 'manual',
      status: 'completed',
      startedAt: AT,
      completedAt: AT,
      configJson: '{}',
      filtersJson: '{}',
      filterSignature: 'filters:{}',
      observationCount: 1,
      warningCount: 0,
      statsJson: '{}',
      warningsJson: '[]',
      retryHintsJson: '{}',
      createdAt: AT,
      updatedAt: AT,
    })
    await seedValidConnectorRecord(database)
  } finally {
    await client.close()
  }
}

async function seedValidConnectorRecord(
  database: Awaited<ReturnType<typeof migratePgliteDatabase>>,
) {
  const rawRecordId = LEGACY_VALID_CONNECTOR_RECORD_ID
  const revisionId = `${rawRecordId}-revision`
  const occurrenceId = `${rawRecordId}-occurrence`
  const jobId = `${rawRecordId}-entity`

  await database.insert(jobs).values({
    id: jobId,
    identityKind: 'provider_job',
    identityNamespace: 'fixture.connector:jobs@1',
    identityValue: `${rawRecordId}-provider`,
    createdAt: AT,
  })
  await database.insert(captureLineages).values({
    id: rawRecordId,
    jobId,
    createdAt: AT,
  })
  await database.insert(captureEvidenceVersions).values({
    id: revisionId,
    captureLineageId: rawRecordId,
    revision: 1,
    contentHash: `sha256:${rawRecordId}`,
    adapterId: 'fixture.connector',
    adapterKind: 'connector',
    adapterVersion: '1.0.0',
    observedAt: AT,
    providerRecordId: `${rawRecordId}-provider`,
    providerSchema: 'jobs@1',
    payloadJson: '{"title":"Platform Engineer","company":"Fixture Robotics"}',
    evidenceJson: '[]',
    createdAt: AT,
  })
  await database.insert(captures).values({
    id: occurrenceId,
    captureLineageId: rawRecordId,
    captureEvidenceVersionId: revisionId,
    connectorInstanceId: CONNECTOR_ID,
    connectorRunId: CONNECTOR_RUN_ID,
    executionScopeId: SCOPE_ID,
    observedAt: AT,
    receivedAt: AT,
  })

  const gate = {
    status: 'needs_enrichment',
    policyVersion: 'normalization-gate@1',
    requiredFields: ['companyName', 'roleTitle', 'destinationUrl'],
    missingFields: ['destinationUrl'],
    conflictingFields: [],
    reason: 'Destination URL is missing.',
    evaluatedAt: '2026-07-10T12:02:00.000Z',
    candidate: null,
  }
  const resolver = {
    id: 'fixture.raw',
    version: '1.0.0',
    scopeRequirement: 'source',
    requiredInputs: ['payload'],
    outputFields: ['roleTitle'],
    capabilities: ['pure'],
    costClass: 'none',
    precedence: 100,
  }
  const outcome = {
    resolverId: 'fixture.raw',
    resolverVersion: '1.0.0',
    field: 'roleTitle',
    inputHash: 'sha256:normalization-input',
    status: 'resolved',
    value: 'Platform Engineer',
    confidence: 1,
    authoritative: true,
  }

  await database.insert(normalizationRuns).values({
    id: 'valid-normalization',
    captureLineageId: rawRecordId,
    captureEvidenceVersionId: revisionId,
    triggerCaptureId: occurrenceId,
    triggerConnectorInstanceId: CONNECTOR_ID,
    triggerConnectorRunId: CONNECTOR_RUN_ID,
    inputHash: 'sha256:normalization-input',
    resolverSetHash: 'sha256:resolver-set',
    canonicalSchemaVersion: 'canonical-source@1',
    gatePolicyVersion: 'normalization-gate@1',
    triggerKind: 'intake',
    status: 'completed',
    createdAt: AT,
    updatedAt: '2026-07-10T12:02:00.000Z',
  })
  await database.insert(normalizationAttempts).values({
    id: 'valid-attempt',
    runId: 'valid-normalization',
    captureEvidenceVersionId: revisionId,
    sequence: 0,
    resolverId: 'fixture.raw',
    resolverVersion: '1.0.0',
    inputHash: 'sha256:normalization-input',
    declarationJson: JSON.stringify(resolver),
    applicabilityJson: '[]',
    status: 'completed',
    startedAt: AT,
    completedAt: '2026-07-10T12:01:00.000Z',
  })
  await database.insert(normalizationFieldOutcomes).values({
    id: 'valid-outcome',
    runId: 'valid-normalization',
    attemptId: 'valid-attempt',
    sequence: 0,
    attemptSequence: 0,
    outcomeIndex: 0,
    field: 'roleTitle',
    status: 'resolved',
    resolverId: 'fixture.raw',
    resolverVersion: '1.0.0',
    inputHash: 'sha256:normalization-input',
    outcomeJson: JSON.stringify(outcome),
  })
  await database.insert(normalizationGates).values({
    id: 'valid-gate',
    runId: 'valid-normalization',
    policyVersion: 'normalization-gate@1',
    status: 'needs_enrichment',
    jobFactVersionId: null,
    gateJson: JSON.stringify(gate),
    evaluatedAt: '2026-07-10T12:02:00.000Z',
  })
}
