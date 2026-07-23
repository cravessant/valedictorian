import * as React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionQueueBucket } from '@sparxie/sdk'

import { createActionQueueItem, createActionQueueResult } from '../../App.test-helpers'
import { ActionQueuePage } from './ActionQueuePage'

afterEach(cleanup)

function ActionQueueFilterHarness({
  initialBucket = undefined as ActionQueueBucket | undefined,
  onActionBucketChange = vi.fn(),
}: {
  initialBucket?: ActionQueueBucket | undefined
  onActionBucketChange?: (actionBucket: ActionQueueBucket | undefined) => void
}) {
  const [actionBucket, setActionBucket] = React.useState(initialBucket)

  return (
    <ActionQueuePage
      actionBucket={actionBucket}
      contentColumnClass=""
      error={null}
      isLoading={false}
      result={createActionQueueResult([])}
      onActionBucketChange={(next) => {
        onActionBucketChange(next)
        setActionBucket(next)
      }}
      onEditApplication={vi.fn()}
      onOpenApplication={vi.fn()}
      onPreviousPage={vi.fn()}
      onNextPage={vi.fn()}
    />
  )
}

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

  it('filters action buckets through a single ToggleGroup and maps All to undefined', async () => {
    const user = userEvent.setup()
    const onActionBucketChange = vi.fn()

    render(<ActionQueueFilterHarness onActionBucketChange={onActionBucketChange} />)

    const buckets = screen.getByRole('radiogroup', { name: 'Action Buckets' })
    expect(buckets).toHaveAttribute('data-slot', 'toggle-group')

    const all = within(buckets).getByRole('radio', { name: /^All / })
    expect(all).toHaveAttribute('aria-checked', 'true')
    expect(all).toHaveAttribute('data-state', 'on')

    await user.click(within(buckets).getByRole('radio', { name: 'Apply now 0' }))
    expect(onActionBucketChange).toHaveBeenCalledWith('apply_now')
    expect(within(buckets).getByRole('radio', { name: 'Apply now 0' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.click(all)
    expect(onActionBucketChange).toHaveBeenCalledWith(undefined)
    expect(all).toHaveAttribute('aria-checked', 'true')
  })

  it('updates the action bucket from keyboard selection without clearing on reactivation', async () => {
    const user = userEvent.setup()
    const onActionBucketChange = vi.fn()

    render(
      <ActionQueueFilterHarness
        initialBucket="apply_now"
        onActionBucketChange={onActionBucketChange}
      />,
    )

    const buckets = screen.getByRole('radiogroup', { name: 'Action Buckets' })
    const applyNow = within(buckets).getByRole('radio', { name: 'Apply now 0' })
    expect(applyNow).toHaveAttribute('aria-checked', 'true')

    applyNow.focus()
    await user.keyboard('{ArrowLeft}')
    const all = within(buckets).getByRole('radio', { name: /^All / })
    expect(all).toHaveFocus()

    await user.keyboard(' ')
    expect(onActionBucketChange).toHaveBeenCalledWith(undefined)
    expect(all).toHaveAttribute('aria-checked', 'true')

    onActionBucketChange.mockClear()
    await user.click(applyNow)
    expect(onActionBucketChange).toHaveBeenCalledWith('apply_now')
    onActionBucketChange.mockClear()
    await user.click(applyNow)
    expect(onActionBucketChange).not.toHaveBeenCalled()
    expect(applyNow).toHaveAttribute('aria-checked', 'true')
  })

  it('pages through action queue results in labeled pagination', async () => {
    const user = userEvent.setup()
    const onNextPage = vi.fn()
    const onPreviousPage = vi.fn()
    const firstPage = {
      ...createActionQueueResult([createActionQueueItem()]),
      total: 80,
      offset: 0,
      hasMore: true,
    }
    const secondPage = {
      ...firstPage,
      offset: 50,
      hasMore: false,
    }

    const { rerender } = render(
      <ActionQueuePage
        actionBucket={undefined}
        contentColumnClass=""
        error={null}
        isLoading={false}
        result={firstPage}
        onActionBucketChange={vi.fn()}
        onEditApplication={vi.fn()}
        onOpenApplication={vi.fn()}
        onPreviousPage={onPreviousPage}
        onNextPage={onNextPage}
      />,
    )

    const pagination = screen.getByRole('navigation', { name: 'Action Queue pagination' })
    expect(within(pagination).getByRole('button', { name: 'Previous action queue page' })).toBeDisabled()
    expect(within(pagination).getByRole('button', { name: 'Next action queue page' })).toBeEnabled()

    await user.click(within(pagination).getByRole('button', { name: 'Next action queue page' }))
    expect(onNextPage).toHaveBeenCalledTimes(1)

    rerender(
      <ActionQueuePage
        actionBucket={undefined}
        contentColumnClass=""
        error={null}
        isLoading={false}
        result={secondPage}
        onActionBucketChange={vi.fn()}
        onEditApplication={vi.fn()}
        onOpenApplication={vi.fn()}
        onPreviousPage={onPreviousPage}
        onNextPage={onNextPage}
      />,
    )

    const paginationAfterNext = screen.getByRole('navigation', { name: 'Action Queue pagination' })
    expect(within(paginationAfterNext).getByRole('button', { name: 'Previous action queue page' })).toBeEnabled()
    expect(within(paginationAfterNext).getByRole('button', { name: 'Next action queue page' })).toBeDisabled()

    await user.click(
      within(paginationAfterNext).getByRole('button', { name: 'Previous action queue page' }),
    )
    expect(onPreviousPage).toHaveBeenCalledTimes(1)
  })
})
