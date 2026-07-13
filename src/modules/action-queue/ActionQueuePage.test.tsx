import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createActionQueueResult } from '../../App.test-helpers'
import { ActionQueuePage } from './ActionQueuePage'

afterEach(cleanup)

describe('ActionQueuePage', () => {
  it('renders the shared Empty primitive for zero matching action queue items', () => {
    render(
      <ActionQueuePage
        actionBucket={undefined}
        contentColumnClass=""
        error={null}
        isLoading={false}
        result={createActionQueueResult([])}
        onActionBucketChange={vi.fn()}
        onEditApplication={vi.fn()}
        onOpenApplication={vi.fn()}
        onPreviousPage={vi.fn()}
        onNextPage={vi.fn()}
      />,
    )

    const empty = screen.getByLabelText('Empty action queue')
    expect(empty).toHaveAttribute('data-slot', 'empty')
    expect(empty).toHaveClass('border-border', 'bg-card')
    expect(within(empty).getByRole('heading', { name: 'No action queue items' })).toBeInTheDocument()
    expect(within(empty).getByText('No items match the current bucket.')).toBeInTheDocument()
    expect(screen.queryByText('No action queue items match the current bucket.')).not.toBeInTheDocument()
  })
})
