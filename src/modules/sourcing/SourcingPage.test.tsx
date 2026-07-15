import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { SourcingFinding } from 'sparxie'

import { createSourcingFinding, createSourcingResult } from '../../App.test-helpers'
import { SourcingPage } from './SourcingPage'

afterEach(cleanup)

function renderSourcingPage(
  overrides: Partial<ComponentProps<typeof SourcingPage>> = {},
) {
  return render(
    <SourcingPage
      contentColumnClass=""
      error={null}
      focusedFindingId={null}
      isLoading={false}
      mergeStatus={undefined}
      destinationClass={undefined}
      promotingFindingId={null}
      result={createSourcingResult([])}
      showDebugData={false}
      sourceId=""
      usability={undefined}
      onCreateFinding={vi.fn()}
      onDecideFinding={vi.fn()}
      onMergeStatusChange={vi.fn()}
      onDestinationClassChange={vi.fn()}
      onOpenApplication={vi.fn()}
      onPreviousPage={vi.fn()}
      onNextPage={vi.fn()}
      onPromoteFinding={vi.fn()}
      onSourceChange={vi.fn()}
      onUsabilityChange={vi.fn()}
      onUpdateFinding={vi.fn()}
      {...overrides}
    />,
  )
}

function sourceCellFor(companyName: string) {
  const table = screen.getByRole('table', { name: 'Opportunities' })
  const row = within(table).getByText(companyName).closest('tr')
  if (!row) {
    throw new Error(`Missing sourcing finding row for ${companyName}`)
  }
  return within(row).getAllByRole('cell')[2]
}

describe('SourcingPage', () => {
  it('renders Empty for zero findings while preserving the header Add opportunity action', () => {
    renderSourcingPage()

    const empty = screen.getByLabelText('Empty Opportunities')
    expect(empty).toHaveAttribute('data-slot', 'empty')
    expect(within(empty).getByRole('heading', { name: 'No opportunities' })).toBeInTheDocument()
    expect(within(empty).getByText('No opportunities match the current filters.')).toBeInTheDocument()
    expect(within(empty).queryByRole('button', { name: 'Add opportunity' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add opportunity' })).toBeInTheDocument()
    expect(screen.queryByText('No sourcing findings match the current filters.')).not.toBeInTheDocument()
  })

  it('keeps the Source cell as provenance and never derives a Review only badge from provider identity', () => {
    const notFitJobright = createSourcingFinding({
      id: 'finding-jobright-not-fit',
      companyName: 'Regional Medical Center',
      roleTitle: 'Internist',
      sourceId: 'source-jobright',
      sourceName: 'Jobright',
      destinationClass: 'employer_or_ats',
      usability: 'review_only',
      mergeStatus: 'not_fit',
      dispositionReason: 'Role title does not match internship fit policy.',
      fitNotes: 'Internist is not an internship.',
    }) as SourcingFinding

    renderSourcingPage({
      result: createSourcingResult([notFitJobright]),
    })

    const sourceCell = sourceCellFor('Regional Medical Center')
    expect(within(sourceCell).getByText('Jobright')).toBeInTheDocument()
    expect(within(sourceCell).getByText('Employer / ATS')).toBeInTheDocument()
    expect(within(sourceCell).queryByText('Review only')).not.toBeInTheDocument()
    expect(screen.queryByText('Review only')).not.toBeInTheDocument()
  })

  it('renders a not_fit finding as explicit Not fit with its explanation and no actionable review controls', () => {
    const explanation = 'Role title does not match internship fit policy.'
    renderSourcingPage({
      result: createSourcingResult([
        createSourcingFinding({
          id: 'finding-not-fit',
          companyName: 'Regional Medical Center',
          roleTitle: 'Internist',
          sourceId: 'source-jobright',
          sourceName: 'Jobright',
          destinationClass: 'employer_or_ats',
          usability: 'usable',
          mergeStatus: 'not_fit',
          dispositionReason: explanation,
          fitNotes: 'Internist is not an internship.',
        }) as SourcingFinding,
      ]),
    })

    const table = screen.getByRole('table', { name: 'Opportunities' })
    expect(within(table).getByText('not_fit')).toBeInTheDocument()
    expect(within(table).getAllByText('Not fit').length).toBeGreaterThanOrEqual(2)
    expect(within(table).getByText('Not promoted by fit review')).toBeInTheDocument()
    expect(within(table).getByText(explanation)).toBeInTheDocument()
    expect(within(table).queryByRole('button', {
      name: 'Promote Regional Medical Center',
    })).not.toBeInTheDocument()
    expect(within(table).queryByText('Approve & promote')).not.toBeInTheDocument()
    expect(screen.queryByText('Review only')).not.toBeInTheDocument()
  })

  it('shows actionable review only when a concrete question and approve/reject transitions exist', () => {
    const reviewQuestion = 'Approve third-party LinkedIn destination before promotion?'
    renderSourcingPage({
      result: createSourcingResult([
        createSourcingFinding({
          id: 'finding-actionable-review',
          companyName: 'Third Party Co',
          sourceName: 'Jobright',
          destinationClass: 'third_party_job_posting',
          destinationUrl: 'https://www.linkedin.com/jobs/view/123456',
          usability: 'review_only',
          mergeStatus: 'blocked',
          policyBlocker: 'third_party_destination',
          blocker: reviewQuestion,
        }) as SourcingFinding,
        createSourcingFinding({
          id: 'finding-not-actionable',
          companyName: 'Review Co',
          sourceName: 'Jobright',
          destinationClass: null,
          usability: 'review_only',
          mergeStatus: 'blocked',
          blocker: null,
          dispositionReason: null,
        }) as SourcingFinding,
      ]),
    })

    const table = screen.getByRole('table', { name: 'Opportunities' })
    expect(within(sourceCellFor('Third Party Co')).getByText('Third-party')).toBeInTheDocument()
    expect(within(sourceCellFor('Review Co')).getByText('Unresolved')).toBeInTheDocument()
    expect(screen.queryByText('Review only')).not.toBeInTheDocument()

    expect(within(table).getByText(reviewQuestion)).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Promote Third Party Co' }))
      .toHaveTextContent('Approve & promote')
    expect(within(table).getByRole('button', { name: 'Set disposition Third Party Co' }))
      .toBeInTheDocument()

    expect(within(table).queryByRole('button', { name: 'Promote Review Co' }))
      .not.toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Set disposition Review Co' }))
      .toBeInTheDocument()
  })

  it('does not treat a disposed third-party block as actionable review', () => {
    const dispositionReason = 'Rejected third-party LinkedIn destination after review.'
    renderSourcingPage({
      result: createSourcingResult([
        createSourcingFinding({
          id: 'finding-disposed-third-party',
          companyName: 'Disposed Third Party Co',
          sourceName: 'Jobright',
          destinationClass: 'third_party_job_posting',
          destinationUrl: 'https://www.linkedin.com/jobs/view/999999',
          usability: 'review_only',
          mergeStatus: 'blocked',
          policyBlocker: 'third_party_destination',
          blocker: null,
          dispositionReason,
        }) as SourcingFinding,
      ]),
    })

    const table = screen.getByRole('table', { name: 'Opportunities' })
    expect(within(table).getByText(dispositionReason)).toBeInTheDocument()
    expect(within(table).queryByText('Approve third-party')).not.toBeInTheDocument()
    expect(within(table).queryByRole('button', {
      name: 'Promote Disposed Third Party Co',
    })).not.toBeInTheDocument()
    expect(within(table).queryByText('Approve & promote')).not.toBeInTheDocument()
    expect(within(table).getByRole('button', {
      name: 'Set disposition Disposed Third Party Co',
    })).toBeInTheDocument()
  })

  it('keeps duplicate, rejected, pending, action-required, and projected outcomes explicit', () => {
    renderSourcingPage({
      result: createSourcingResult([
        createSourcingFinding({
          id: 'finding-duplicate',
          companyName: 'Duplicate Co',
          mergeStatus: 'duplicate',
          duplicateNotes: 'Duplicate official URL matched an existing application.',
        }) as SourcingFinding,
        createSourcingFinding({
          id: 'finding-rejected',
          companyName: 'Rejected Co',
          mergeStatus: 'below_cutoff',
          dispositionReason: 'Score fell below the active cutoff.',
        }) as SourcingFinding,
        createSourcingFinding({
          id: 'finding-pending',
          companyName: 'Pending Co',
          mergeStatus: 'blocked',
          blocker: null,
          dispositionReason: null,
          usability: 'usable',
          destinationClass: 'employer_or_ats',
        }) as SourcingFinding,
        createSourcingFinding({
          id: 'finding-action-required',
          companyName: 'Action Required Co',
          mergeStatus: 'blocked',
          blocker: 'Which country is this job in?',
          usability: 'usable',
          destinationClass: 'employer_or_ats',
        }) as SourcingFinding,
        createSourcingFinding({
          id: 'finding-projected',
          companyName: 'Projected Co',
          mergeStatus: 'new',
          usability: 'usable',
          destinationClass: 'employer_or_ats',
        }) as SourcingFinding,
      ]),
    })

    const table = screen.getByRole('table', { name: 'Opportunities' })
    expect(within(table).getByText('duplicate')).toBeInTheDocument()
    expect(within(table).getByText('Duplicate')).toBeInTheDocument()
    expect(within(table).getByText('Linked to existing application')).toBeInTheDocument()

    expect(within(table).getByText('below_cutoff')).toBeInTheDocument()
    expect(within(table).getAllByText('Below cutoff').length).toBeGreaterThanOrEqual(1)
    expect(within(table).getByText('Score fell below the active cutoff.')).toBeInTheDocument()

    expect(within(table).getAllByText('Needs source data before promotion').length).toBeGreaterThanOrEqual(2)
    expect(within(table).getByText('Which country is this job in?')).toBeInTheDocument()
    expect(within(table).getAllByText('Fix source data').length).toBeGreaterThanOrEqual(1)

    expect(within(table).getByText('new')).toBeInTheDocument()
    expect(within(table).getByText('New Opportunity')).toBeInTheDocument()
    expect(within(table).getByText('Ready to review')).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Promote Projected Co' }))
      .toHaveTextContent('Promote')

    expect(screen.queryByText('Review only')).not.toBeInTheDocument()
  })

  it('labels usability filters without a review_only presentation alias', () => {
    renderSourcingPage()

    const usability = screen.getByLabelText('Usability')
    expect(within(usability).getByRole('option', { name: 'Projected usable' })).toBeInTheDocument()
    expect(within(usability).getByRole('option', { name: 'Not projected usable' })).toBeInTheDocument()
    expect(within(usability).queryByRole('option', { name: 'Retained for review' })).not.toBeInTheDocument()
    expect(within(usability).queryByRole('option', { name: 'Review only' })).not.toBeInTheDocument()
    expect(screen.queryByText('Review only')).not.toBeInTheDocument()
    expect(screen.queryByText('Retained for review')).not.toBeInTheDocument()
  })
})
