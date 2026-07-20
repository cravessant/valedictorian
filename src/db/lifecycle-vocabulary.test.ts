import { describe, expect, it } from 'vitest'
import {
  UUID_V7_PATTERN,
  applicationHistoryKinds,
  applicationTechnicalStates,
  captureEvidenceModes,
  captureRevisionKinds,
  captureSourceAdapterKinds,
  jobAvailabilityStates,
  jobExternalIdentityKinds,
  jobHistoryKinds,
  jobIdentityStrengths,
  lifecycleActorTypes,
  lifecycleBlockerCodes,
  lifecycleWarningCodes,
  opportunityCutoffStates,
  opportunityDispositions,
  opportunityFitStates,
  opportunityHistoryKinds,
  pursuitApplicationStatuses,
} from './lifecycle-vocabulary'

/**
 * Drift guard: these expected values are the merged sparxie lifecycle contract
 * (KennyKeni/sparxie#84). #298 mirrors them rather than importing the package;
 * any intentional contract change must update both the mirror and this test,
 * so drift is loud. Typed alignment against the published package is #304.
 */
describe('lifecycle vocabulary mirror', () => {
  it('mirrors the shared contract literals', () => {
    expect(lifecycleActorTypes).toEqual(['user', 'agent', 'system'])
    expect(lifecycleBlockerCodes).toEqual([
      'invalid_input',
      'missing_lineage',
      'foreign_lineage',
      'workspace_ownership',
      'strong_identity_conflict',
      'impossible_state',
      'bounded_data_violation',
      'security_violation',
      'deterministic_duplicate',
    ])
    expect(lifecycleWarningCodes).toEqual([
      'fit',
      'rank',
      'cutoff',
      'missing_optional_facts',
      'third_party_destination',
      'weak_possible_match',
    ])
  })

  it('mirrors the capture contract literals', () => {
    expect(captureEvidenceModes).toEqual(['reported', 'ats_details_provided'])
    expect(captureSourceAdapterKinds).toEqual(['connector', 'cli', 'manual', 'import'])
    expect(captureRevisionKinds).toEqual(['created', 'corrected', 'removed', 'restored'])
  })

  it('mirrors the job contract literals', () => {
    expect(jobExternalIdentityKinds).toEqual(['ats_job', 'employer_job', 'canonical_destination', 'posting'])
    expect(jobIdentityStrengths).toEqual(['strong', 'provisional'])
    expect(jobAvailabilityStates).toEqual(['open', 'closed', 'unknown'])
    expect(jobHistoryKinds).toEqual([
      'created',
      'facts_corrected',
      'availability_changed',
      'identity_added',
      'identity_removed',
      'removed',
      'restored',
    ])
  })

  it('mirrors the opportunity contract literals', () => {
    expect(opportunityFitStates).toEqual(['fit', 'possible', 'not_fit', 'unknown'])
    expect(opportunityCutoffStates).toEqual(['above', 'below', 'not_evaluated'])
    expect(opportunityDispositions).toEqual(['reviewing', 'pursue', 'hold', 'declined', 'archived'])
    expect(opportunityHistoryKinds).toEqual([
      'created',
      'evaluation_changed',
      'disposition_changed',
      'removed',
      'restored',
    ])
  })

  it('mirrors the application contract literals', () => {
    expect(pursuitApplicationStatuses).toEqual([
      'active',
      'submitted',
      'interviewing',
      'offered',
      'withdrawn',
      'rejected',
      'accepted',
    ])
    expect(applicationTechnicalStates).toEqual(['pending', 'running', 'succeeded', 'failed'])
    expect(applicationHistoryKinds).toEqual([
      'created',
      'status_changed',
      'company_edited',
      'source_edited',
      'link_created',
      'link_updated',
      'link_removed',
      'snapshot_refreshed',
      'removed',
      'restored',
    ])
  })

  it('matches the contract UUIDv7 canonical form', () => {
    const pattern = new RegExp(UUID_V7_PATTERN, 'i')
    expect(pattern.test('017f22e2-79b0-7cc3-98c4-dc0c0c07398f')).toBe(true)
    // v4 (version nibble 4) is rejected.
    expect(pattern.test('017f22e2-79b0-4cc3-98c4-dc0c0c07398f')).toBe(false)
    // Invalid variant nibble (c) is rejected.
    expect(pattern.test('017f22e2-79b0-7cc3-c8c4-dc0c0c07398f')).toBe(false)
  })
})
