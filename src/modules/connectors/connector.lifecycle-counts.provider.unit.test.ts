import { describe, expect, it } from 'vitest'
import { reconcileProviderLifecycleCounts } from './connector.lifecycle-counts'

const oneCapturedOccurrence = {
  capturedRecords: 1,
  capturedValidRecords: 1,
  capturedInvalidRecords: 0,
  occurrenceCount: 2,
}

describe('connector provider lifecycle count reconciliation', () => {
  it.each([
    [
      'missing',
      { providerValid: 1, providerInvalid: 0, sourceDuplicates: 0 },
      'reported_stats_missing',
      'missing_provider_returned',
    ],
    [
      'invalid',
      { providerReturned: -1, providerValid: 1, providerInvalid: 0, sourceDuplicates: 0 },
      'reported_stats_invalid',
      'invalid_provider_returned',
    ],
  ] as const)(
    'keeps %s returned rows unknown instead of substituting capture occurrences',
    (_name, stats, invariant, gap) => {
      expect(reconcileProviderLifecycleCounts(stats, oneCapturedOccurrence)).toMatchObject({
        returnedRows: 0,
        capturedRecords: 1,
        occurrenceCount: 2,
        captureShortfall: 0,
        unclassifiedRows: 0,
        invariant,
        gaps: [gap],
      })
    },
  )

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
    (_name, stats, withOccurrence, invariant, gaps) => {
      const capture = withOccurrence
        ? { ...oneCapturedOccurrence, occurrenceCount: 1 }
        : {
            capturedRecords: 0,
            capturedValidRecords: 0,
            capturedInvalidRecords: 0,
            occurrenceCount: 0,
          }

      expect(reconcileProviderLifecycleCounts(stats, capture)).toMatchObject({
        invariant,
        gaps,
      })
    },
  )
})
