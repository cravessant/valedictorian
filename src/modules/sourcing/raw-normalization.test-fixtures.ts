import type { RawSourceNormalizationResult } from 'sparxie'

export type CompletedNormalization = Extract<RawSourceNormalizationResult, { status: 'completed' }>

export function createNeedsEnrichmentNormalization(): CompletedNormalization {
  const fieldOutcomes = [
    {
      resolverId: 'jobright.raw', resolverVersion: '2.1.0', field: 'roleTitle' as const,
      inputHash: 'sha256:input', status: 'resolved' as const, value: 'Platform Engineer',
      confidence: 0.99, authoritative: true,
    },
    {
      resolverId: 'jobright.raw', resolverVersion: '2.1.0', field: 'destinationUrl' as const,
      inputHash: 'sha256:input', status: 'conflict' as const,
      reason: 'Provider supplied competing destinations.',
      values: ['https://jobs.example.test/one', 'https://jobs.example.test/two'],
    },
    {
      resolverId: 'jobright.raw', resolverVersion: '2.1.0', field: 'compensation' as const,
      inputHash: 'sha256:input', status: 'abstained' as const,
      reason: 'Provider did not report compensation.',
    },
  ]
  return {
    rawRecordId: 'raw-record-1', rawRevisionId: 'raw-revision-1',
    canonicalSchemaVersion: 'canonical-source@1', status: 'completed',
    attempts: [{
      id: 'attempt-1', rawRevisionId: 'raw-revision-1',
      resolver: {
        id: 'jobright.raw', version: '2.1.0', scopeRequirement: 'source',
        requiredInputs: ['payload'], outputFields: ['roleTitle', 'destinationUrl', 'compensation'],
        capabilities: ['pure'], costClass: 'none', precedence: 100,
      },
      inputHash: 'sha256:input', executionScopeId: 'scope-1', operationOutcome: null,
      status: 'completed', startedAt: '2026-07-10T12:00:01.000Z',
      completedAt: '2026-07-10T12:00:02.000Z', outcomes: fieldOutcomes,
    }],
    fieldOutcomes,
    gate: {
      status: 'needs_enrichment', policyVersion: 'normalization-gate@1',
      requiredFields: ['companyName', 'roleTitle', 'destinationUrl'],
      missingFields: ['companyName'], conflictingFields: ['destinationUrl'],
      reason: 'Company is missing and destination conflicts.',
      evaluatedAt: '2026-07-10T12:00:03.000Z', candidate: null,
    },
    canonicalCandidate: null,
    updatedAt: '2026-07-10T12:00:03.000Z',
  }
}

export function createPassedNormalization(
  base: CompletedNormalization,
): CompletedNormalization {
  const candidate = {
    id: 'candidate-1', sourceEntityId: 'source-entity-1', rawRecordId: 'raw-record-1',
    rawRevisionId: 'raw-revision-1', schemaVersion: 'canonical-source@1',
    canonicalIdentity: { kind: 'provider_job' as const, value: 'provider-job-1' },
    companyName: 'Example Co', roleTitle: 'Platform Engineer', employmentType: 'full_time' as const,
    seniority: 'mid_level' as const, workMode: 'remote' as const,
    location: null, compensation: null,
    postedAt: { value: null, precision: 'unknown' as const, raw: null },
    destination: { class: 'employer_or_ats' as const, url: 'https://jobs.example.test/platform' },
    sourceUrl: 'javascript:alert(1)', providerJobId: 'provider-job-1',
    observedAt: '2026-07-10T11:45:00.000Z',
  }
  return {
    ...base,
    gate: {
      status: 'passed', policyVersion: 'normalization-gate@1',
      requiredFields: ['companyName', 'roleTitle', 'destinationUrl'],
      missingFields: [], conflictingFields: [], reason: 'Required fields are resolved.',
      evaluatedAt: '2026-07-10T12:00:03.000Z',
      candidate: {
        id: candidate.id, sourceEntityId: candidate.sourceEntityId,
        rawRecordId: candidate.rawRecordId, rawRevisionId: candidate.rawRevisionId,
        schemaVersion: candidate.schemaVersion,
      },
    },
    canonicalCandidate: candidate,
  }
}
