import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSourcingResult } from '../../App.test-helpers'
import { SourcingPage } from './SourcingPage'

afterEach(cleanup)

describe('SourcingPage', () => {
  it('renders Empty for zero findings while preserving the header Add finding action', () => {
    render(
      <SourcingPage
        contentColumnClass=""
        error={null}
        isLoading={false}
        mergeStatus={undefined}
        destinationClass={undefined}
        promotingFindingId={null}
        result={createSourcingResult([])}
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
      />,
    )

    const empty = screen.getByLabelText('Empty sourcing findings')
    expect(empty).toHaveAttribute('data-slot', 'empty')
    expect(within(empty).getByRole('heading', { name: 'No sourcing findings' })).toBeInTheDocument()
    expect(within(empty).getByText('No findings match the current filters.')).toBeInTheDocument()
    expect(within(empty).queryByRole('button', { name: 'Add finding' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add finding' })).toBeInTheDocument()
    expect(screen.queryByText('No sourcing findings match the current filters.')).not.toBeInTheDocument()
  })
})
