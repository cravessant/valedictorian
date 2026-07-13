import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RawSourceProjectionResult } from 'sparxie'
import { RawNormalizationOutcomes } from './RawNormalizationOutcomes'
import {
  createNeedsEnrichmentNormalization,
  createPassedNormalization,
} from './raw-normalization.test-fixtures'

afterEach(cleanup)

describe('RawNormalizationOutcomes', () => {
  it('distinguishes a sparse revision with no normalization or projection', () => {
    const projection = {
      rawRecordId: 'raw-sparse', rawRevisionId: 'revision-sparse',
      status: 'not_eligible', normalizationStatus: null, canonicalCandidateId: null,
      gateStatus: null, updatedAt: '2026-07-10T12:00:04.000Z',
    } satisfies RawSourceProjectionResult

    render(<RawNormalizationOutcomes normalization={null} projection={projection} />)

    expect(screen.getByText('Normalization has not started for this revision.'))
      .toBeInTheDocument()
    expect(screen.getByText('No canonical candidate')).toBeInTheDocument()
    expect(screen.getByText('No normalization or projection recorded for this revision'))
      .toBeInTheDocument()
  })

  it('distinguishes retryable and terminal projection failures', () => {
    const normalization = createPassedNormalization(createNeedsEnrichmentNormalization())
    const projection = (retryable: boolean) => ({
      rawRecordId: 'raw-record-1', rawRevisionId: 'raw-revision-1',
      status: 'failed' as const, normalizationStatus: 'completed' as const,
      gateStatus: 'passed' as const, canonicalCandidateId: 'candidate-1',
      failedAt: '2026-07-10T12:00:04.000Z', updatedAt: '2026-07-10T12:00:04.000Z',
      failure: { code: 'internal_error' as const, retryable },
    }) satisfies (retryable: boolean) => RawSourceProjectionResult
    const { rerender } = render(
      <RawNormalizationOutcomes normalization={normalization} projection={projection(true)} />,
    )
    expect(screen.getByText('Projection failed · Internal error')).toBeInTheDocument()
    expect(screen.getByText('Retryable')).toBeInTheDocument()

    rerender(
      <RawNormalizationOutcomes normalization={normalization} projection={projection(false)} />,
    )
    expect(screen.getByText('Not retryable')).toBeInTheDocument()
  })

  it('reports pending and new, duplicate, and merged projection receipts', () => {
    const normalization = createPassedNormalization(createNeedsEnrichmentNormalization())
    const pending = {
      rawRecordId: 'raw-record-1', rawRevisionId: 'raw-revision-1',
      status: 'pending', normalizationStatus: 'completed', gateStatus: 'passed',
      canonicalCandidateId: 'candidate-1', updatedAt: '2026-07-10T12:00:04.000Z',
    } satisfies RawSourceProjectionResult
    const projected = (mergeStatus: 'new' | 'duplicate' | 'merged') => ({
      ...pending, status: 'projected' as const,
      projectedAt: '2026-07-10T12:00:04.000Z',
      finding: {
        id: `finding-${mergeStatus}`, mergeStatus,
        mergedApplicationId: mergeStatus === 'merged' ? 'application-1' : null,
      },
    }) satisfies (mergeStatus: 'new' | 'duplicate' | 'merged') => RawSourceProjectionResult
    const { rerender } = render(
      <RawNormalizationOutcomes normalization={normalization} projection={pending} />,
    )
    expect(screen.getByText('Projection pending')).toBeInTheDocument()

    for (const [status, label] of [
      ['new', 'Finding outcome New'],
      ['duplicate', 'Finding outcome Duplicate'],
      ['merged', 'Finding outcome Merged'],
    ] as const) {
      rerender(
        <RawNormalizationOutcomes normalization={normalization} projection={projected(status)} />,
      )
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('Merged application application-1')).toBeInTheDocument()
  })

  it('does not expose sensitive resolver, gate, candidate, or finding strings in visible or accessible content', () => {
    const base = createPassedNormalization(createNeedsEnrichmentNormalization())
    const candidate = base.canonicalCandidate!
    const normalization = {
      ...base,
      attempts: base.attempts.map((attempt) => ({
        ...attempt,
        resolver: {
          ...attempt.resolver,
          id: 'Authorization: Bearer private-value',
          capabilities: ['token=private-value'],
        },
      })),
      fieldOutcomes: base.fieldOutcomes.map((outcome, index) => index === 0
        ? { ...outcome, value: 'Cookie: session=private-value' }
        : outcome),
      gate: { ...base.gate!, reason: 'password=private-value' },
      canonicalCandidate: {
        ...candidate,
        id: '{"auth":"private-value"}',
        sourceUrl: 'https://jobs.example.test/source?xAmzSig=private-value',
        destination: {
          class: 'employer_or_ats' as const,
          url: 'https://jobs.example.test/platform?requestSig=private-value',
          intermediaryUrl: 'https://jobs.example.test/source?awsSig=private-value',
        },
      },
    }
    const projection = {
      rawRecordId: 'raw-record-1', rawRevisionId: 'raw-revision-1',
      status: 'projected', normalizationStatus: 'completed', gateStatus: 'passed',
      canonicalCandidateId: 'candidate-1', projectedAt: '2026-07-10T12:00:04.000Z',
      updatedAt: '2026-07-10T12:00:04.000Z',
      finding: {
        id: 'credentialId=private-value', mergeStatus: 'new', mergedApplicationId: null,
      },
    } satisfies RawSourceProjectionResult

    render(
      <RawNormalizationOutcomes
        normalization={normalization}
        onOpenFinding={() => undefined}
        projection={projection}
      />,
    )

    expect(document.body).not.toHaveTextContent('private-value')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Sensitive detail omitted')).toBeInTheDocument()
  })
})
