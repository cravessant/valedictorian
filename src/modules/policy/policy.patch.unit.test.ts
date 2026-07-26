import { describe, expect, it } from 'vitest'
import { admitPolicyConfigPatch, policyConfigPatchViolation, unsupportedPolicyConfigField } from './policy.patch'

describe('policy config patch admission', () => {
  it('admits canonical sections', () => {
    const patch = { actionQueue: { staleLockHours: 3 }, scoring: { applyCutoff: 7 } }
    expect(unsupportedPolicyConfigField(patch)).toBeNull()
    expect(policyConfigPatchViolation(patch)).toBeNull()
    expect(admitPolicyConfigPatch(patch)).toBe(patch)
  })

  it('admits every canonical leaf kind the contract carries', () => {
    for (const patch of [
      { version: 2 },
      { manualReview: { daytimeWindow: { start: '09:00', end: '17:30', timezone: 'UTC' } } },
      { manualReview: { nonOverridableTags: ['yc_company'], manualReviewCompanyPatterns: ['Acme'] } },
      { officialPath: { requireEmployerDomainVerificationForHighRiskForms: false } },
      { retries: { captchaSecurityMinProfileAttempts: 4, loginNeededRequiresRecoveryAttempt: false } },
      // 0 is a valid hour: admission must compare values, not truthiness.
      { sourcing: { overnightStartHour: 0, timezone: 'UTC', weekdayNormalCadenceHours: 1.5 } },
    ]) {
      expect(policyConfigPatchViolation(patch)).toBeNull()
    }
  })

  it('rejects the retired queue section instead of silently dropping it', () => {
    expect(unsupportedPolicyConfigField({ queue: { staleLockHours: 3 } })).toBe('queue')
    expect(() => admitPolicyConfigPatch({ queue: { staleLockHours: 3 } }))
      .toThrow('Unsupported policy config field: queue')
  })

  it('reports the dotted path of a retired nested field', () => {
    expect(unsupportedPolicyConfigField({ manualReview: { daytimeWindow: { start: '09:00', tz: 'UTC' } } }))
      .toBe('manualReview.daytimeWindow.tz')
  })

  it('rejects a known section supplied as a scalar instead of merging nothing', () => {
    expect(policyConfigPatchViolation({ actionQueue: 3 })).toBe('Unsupported policy config value: actionQueue')
  })

  it('rejects malformed known scalars that normalization would replace with the default', () => {
    const rejected: Record<string, unknown> = {
      'actionQueue.staleLockHours': { actionQueue: { staleLockHours: 'bad' } },
      'scoring.applyCutoff': { scoring: { applyCutoff: 0 } },
      'manualReview.daytimeWindow.start': { manualReview: { daytimeWindow: { start: '9am' } } },
      'officialPath.requireEmployerDomainVerificationForHighRiskForms': {
        officialPath: { requireEmployerDomainVerificationForHighRiskForms: 'no' },
      },
      'retries.captchaSecurityMinProfileAttempts': { retries: { captchaSecurityMinProfileAttempts: 1.5 } },
      'sourcing.overnightStartHour': { sourcing: { overnightStartHour: 24 } },
      'sourcing.timezone': { sourcing: { timezone: '   ' } },
      // A downgrade is not representable: normalization always returns the current version.
      version: { version: 1 },
    }
    for (const [path, patch] of Object.entries(rejected)) {
      expect(policyConfigPatchViolation(patch)).toBe(`Unsupported policy config value: ${path}`)
    }
  })

  it('rejects array values normalization would discard, element-wise', () => {
    expect(policyConfigPatchViolation({ manualReview: { nonOverridableTags: ['bogus'] } }))
      .toBe('Unsupported policy config value: manualReview.nonOverridableTags')
    // An empty list is unrepresentable — normalization restores the defaults instead.
    expect(policyConfigPatchViolation({ manualReview: { manualReviewCompanyPatterns: [] } }))
      .toBe('Unsupported policy config value: manualReview.manualReviewCompanyPatterns')
    expect(policyConfigPatchViolation({ officialPath: { highRiskFormBuilders: ['Tally', 7] } }))
      .toBe('Unsupported policy config value: officialPath.highRiskFormBuilders')
  })

  it('translates an unsupported config version into the contract message, not a crash', () => {
    expect(policyConfigPatchViolation({ version: 3 }))
      .toBe('Policy config version 3 is newer than this package supports.')
  })
})
