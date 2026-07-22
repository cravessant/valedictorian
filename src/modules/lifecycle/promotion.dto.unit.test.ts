/**
 * Lifecycle promotion-result serializer proofs (issue #304, stage 3) — pure.
 *
 * Proves the generic promotion mappers produce output the three concrete promotion
 * schemas accept (strict): the `promoted` body over a Job / Opportunity / Application
 * resource, the warning-taxonomy bridge (retrieval_unavailable -> weak_possible_match,
 * unknown codes dropped, deduped), the echoed override, the applied duplicate
 * resolution (target = resource id), and the failure classifier's routing.
 */
import { describe, expect, it } from 'vitest'
import {
  promoteCaptureToJobResultSchema,
  promoteJobToOpportunityResultSchema,
  promoteOpportunityToApplicationResultSchema,
} from 'sparxie'
import { toJobResource, type JobHeadRow, type JobEvidenceRefRow } from '../job/job.dto'
import { toOpportunityResource, type OpportunityHeadRow } from '../opportunity/opportunity.dto'
import { toApplicationResource, type ApplicationHeadRow } from '../applications/application.dto'
import {
  classifyPromotionFailure,
  toBlockedPromotionResult,
  toContractWarnings,
  toPromotedResult,
  toWarningOverride,
} from './promotion.dto'

const jobFacts = {
  companyName: 'Acme', roleTitle: 'Staff Engineer', sourceName: 'LinkedIn', roleKind: 'experienced' as const,
  term: null, terms: [], timingMode: 'unknown' as const, startDate: null, endDate: null, location: null,
  workMode: 'remote' as const, employmentType: 'full_time' as const, seniority: 'senior' as const,
  compensation: null, postedAt: null, destination: null,
}
const jobHead: JobHeadRow = {
  id: '01890000-0000-7000-8000-0000000000d1', workspaceId: 'ws-a', factsRevision: 1, factsJson: JSON.stringify(jobFacts),
  availabilityState: 'open', availabilityObservedAt: '2026-07-20T00:00:00.000Z', availabilityRevision: 1,
  createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z', removedAt: null,
}
const evidenceRef: JobEvidenceRefRow = { id: 'ref-1', captureId: 'cap-1', captureRevision: 1, evidenceIndexesJson: '[0]', createdAt: '2026-07-20T00:00:00.000Z' }
const jobResource = toJobResource(jobHead, [], [evidenceRef])

const opportunityHead: OpportunityHeadRow = {
  id: '01890000-0000-7000-8000-0000000000e1', workspaceId: 'ws-a', jobId: jobHead.id, revision: 1,
  fit: 'fit', rank: 1, cutoff: 'above', disposition: 'pursue', overrideJson: null,
  createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z', removedAt: null,
}
const opportunityResource = toOpportunityResource(opportunityHead)

const applicationHead: ApplicationHeadRow = {
  id: '01890000-0000-7000-8000-0000000000f1', workspaceId: 'ws-a', opportunityId: opportunityHead.id, jobId: jobHead.id,
  revision: 1, status: 'active', jobFactsRevision: 1,
  snapshotJson: JSON.stringify({ job: { facts: jobFacts, factsRevision: 1 }, capturedAt: '2026-07-20T00:00:00.000Z' }),
  companyName: 'Acme', sourceName: 'LinkedIn', createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z', removedAt: null,
}
const applicationResource = toApplicationResource(applicationHead, [])

const actor = { type: 'user', id: 'u-1' }

describe('toPromotedResult', () => {
  it('serializes a Capture->Job promotion with the retrieval_unavailable bridge and echoed override', () => {
    const result = toPromotedResult(jobResource, {
      created: true,
      actor,
      timestamp: '2026-07-20T00:00:01.000Z',
      warnings: [
        { code: 'retrieval_unavailable', message: 'boundary retrieval did not resolve' },
        { code: 'third_party_destination', message: '3p' },
      ],
      override: { actor: { id: 'u-1', type: 'user' }, rationale: 'overrode weak match', warningCodes: ['weak_possible_match'] },
    })
    expect(() => promoteCaptureToJobResultSchema.parse(result)).not.toThrow()
    expect(result.status === 'promoted' && result.created).toBe(true)
    // retrieval_unavailable -> weak_possible_match; codes preserved, order stable.
    expect(result.status === 'promoted' && result.warnings.map((w) => w.code)).toEqual(['weak_possible_match', 'third_party_destination'])
    expect(result.status === 'promoted' && result.override?.rationale).toBe('overrode weak match')
  })

  it('serializes a Job->Opportunity promotion (attach) with an applied duplicate resolution', () => {
    const result = toPromotedResult(opportunityResource, {
      created: false,
      actor,
      timestamp: '2026-07-20T00:00:01.000Z',
      // Applied duplicate target must equal the surviving resource id.
      duplicateResolution: { action: 'attach', targetResourceId: opportunityResource.id },
    })
    expect(() => promoteJobToOpportunityResultSchema.parse(result)).not.toThrow()
    expect(result.status === 'promoted' && result.duplicateResolution?.action).toBe('attach')
    expect(result.status === 'promoted' && result.warnings).toEqual([])
  })

  it('serializes an Opportunity->Application promotion with no warnings', () => {
    const result = toPromotedResult(applicationResource, { created: true, actor, timestamp: '2026-07-20T00:00:01.000Z' })
    expect(() => promoteOpportunityToApplicationResultSchema.parse(result)).not.toThrow()
    expect(result.status === 'promoted' && result.override).toBeNull()
  })
})

describe('toContractWarnings', () => {
  it('maps the bridge, drops unknown codes, and dedupes by resulting code', () => {
    expect(toContractWarnings([
      { code: 'retrieval_unavailable', message: 'a' },
      { code: 'weak_possible_match', message: 'b' },
      { code: 'not_a_code', message: 'c' },
      { code: 'fit', message: 'd' },
    ]).map((w) => w.code)).toEqual(['weak_possible_match', 'fit'])
  })
})

describe('toWarningOverride', () => {
  it('returns null when absent and drops non-contract warning codes', () => {
    expect(toWarningOverride(null)).toBeNull()
    expect(toWarningOverride({ actor: { id: 'u', type: 'user' }, rationale: 'r', warningCodes: ['fit', 'bogus'] })?.warningCodes).toEqual(['fit'])
  })
})

describe('classifyPromotionFailure', () => {
  it('routes not_found->404, revision_conflict->409, and blocker codes to a blocked body', () => {
    expect(classifyPromotionFailure('not_found')).toEqual({ surface: 'error', status: 404, code: 'not_found' })
    expect(classifyPromotionFailure('revision_conflict')).toEqual({ surface: 'error', status: 409, code: 'revision_conflict' })
    expect(classifyPromotionFailure('security_violation')).toEqual({ surface: 'blocked', code: 'security_violation' })
    expect(classifyPromotionFailure('deterministic_duplicate')).toEqual({ surface: 'blocked', code: 'deterministic_duplicate' })
  })

  it('builds a schema-valid blocked promotion body', () => {
    const blocked = toBlockedPromotionResult({ code: 'security_violation', message: 'destination rejected' })
    expect(() => promoteCaptureToJobResultSchema.parse(blocked)).not.toThrow()
  })
})
