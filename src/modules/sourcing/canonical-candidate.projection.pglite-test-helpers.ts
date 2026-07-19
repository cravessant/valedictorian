import type { CanonicalSourceCandidate } from 'sparxie'
import {
  captureEvidenceVersions,
  captureLineages,
  jobFactVersions,
  jobs,
  normalizationGates,
  normalizationRuns,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'

export const CANONICAL_PROJECTION_TEST_NOW = '2026-07-18T10:00:00.000Z'

export async function seedPassedCanonicalCandidate(
  database: PgliteDatabase,
  suffix: string,
  overrides: Partial<CanonicalSourceCandidate> = {},
) {
  const jobId = `job-${suffix}`
  const rawRecordId = `raw-${suffix}`
  const rawRevisionId = `revision-${suffix}`
  const normalizationId = `normalization-${suffix}`
  const candidateId = `candidate-${suffix}`
  const destinationUrl = `https://jobs.example.test/${suffix}`
  const candidate: CanonicalSourceCandidate = {
    id: candidateId,
    sourceEntityId: jobId,
    rawRecordId,
    rawRevisionId,
    schemaVersion: 'canonical-candidate@1',
    canonicalIdentity: { kind: 'destination_url', value: destinationUrl },
    companyName: 'Projected Robotics',
    roleTitle: 'Software Intern',
    employmentType: 'internship',
    seniority: 'internship',
    workMode: 'remote',
    location: { raw: 'Denver, CO', city: 'Denver', region: 'CO', country: 'US' },
    compensation: null,
    postedAt: { value: '2026-07-18', precision: 'date', raw: 'Jul 18' },
    destination: { class: 'employer_or_ats', url: destinationUrl },
    sourceUrl: null,
    providerJobId: suffix,
    observedAt: CANONICAL_PROJECTION_TEST_NOW,
    ...overrides,
  }

  await database.insert(jobs).values({
    id: jobId,
    identityKind: 'provider_job',
    identityNamespace: 'fixture',
    identityValue: suffix,
    createdAt: CANONICAL_PROJECTION_TEST_NOW,
  })
  await database.insert(captureLineages).values({
    id: rawRecordId,
    jobId,
    createdAt: CANONICAL_PROJECTION_TEST_NOW,
  })
  await database.insert(captureEvidenceVersions).values({
    id: rawRevisionId,
    captureLineageId: rawRecordId,
    revision: 1,
    contentHash: `sha256:${suffix}`,
    adapterId: 'fixture.cli',
    adapterKind: 'cli',
    adapterVersion: '1.0.0',
    reportedOriginName: 'Fixture Board',
    observedAt: candidate.observedAt,
    evidenceJson: '[]',
    createdAt: CANONICAL_PROJECTION_TEST_NOW,
  })
  await database.insert(normalizationRuns).values({
    id: normalizationId,
    captureLineageId: rawRecordId,
    captureEvidenceVersionId: rawRevisionId,
    inputHash: `sha256:input-${suffix}`,
    resolverSetHash: 'sha256:resolver-set',
    canonicalSchemaVersion: 'canonical-candidate@1',
    gatePolicyVersion: 'gate/v1',
    triggerKind: 'intake',
    status: 'completed',
    createdAt: CANONICAL_PROJECTION_TEST_NOW,
    updatedAt: CANONICAL_PROJECTION_TEST_NOW,
  })
  await database.insert(jobFactVersions).values({
    id: candidateId,
    runId: normalizationId,
    jobId,
    captureLineageId: rawRecordId,
    captureEvidenceVersionId: rawRevisionId,
    schemaVersion: candidate.schemaVersion,
    jobFactVersionJson: JSON.stringify(candidate),
    createdAt: CANONICAL_PROJECTION_TEST_NOW,
  })
  await database.insert(normalizationGates).values({
    id: `gate-${suffix}`,
    runId: normalizationId,
    policyVersion: 'gate/v1',
    status: 'passed',
    jobFactVersionId: candidateId,
    gateJson: '{}',
    evaluatedAt: CANONICAL_PROJECTION_TEST_NOW,
  })

  return { candidateId, rawRevisionId }
}
