import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from './pagination'

afterEach(cleanup)

describe('Pagination', () => {
  it('exposes a labeled navigation landmark with the pagination root slot', () => {
    render(
      <Pagination aria-label="Application pagination">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    )

    expect(
      screen.getByRole('navigation', { name: 'Application pagination' }),
    ).toBeInTheDocument()
  })

  it('activates previous and next callbacks from button controls', async () => {
    const user = userEvent.setup()
    const onPrevious = vi.fn()
    const onNext = vi.fn()

    render(
      <Pagination aria-label="Action Queue pagination">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious aria-label="Previous action queue page" onClick={onPrevious}>
              Previous
            </PaginationPrevious>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext aria-label="Next action queue page" onClick={onNext}>
              Next
            </PaginationNext>
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    )

    await user.click(screen.getByRole('button', { name: 'Next action queue page' }))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrevious).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Previous action queue page' }))
    expect(onPrevious).toHaveBeenCalledTimes(1)
  })

  it('supports keyboard focus order and Enter activation on next', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()

    render(
      <Pagination aria-label="Application pagination">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious aria-label="Previous page">Previous</PaginationPrevious>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext aria-label="Next page" onClick={onNext}>
              Next
            </PaginationNext>
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('keeps disabled previous and next controls inert to click and focus', async () => {
    const user = userEvent.setup()
    const onPrevious = vi.fn()
    const onNext = vi.fn()

    render(
      <Pagination aria-label="Application pagination">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              aria-label="Previous page"
              disabled
              onClick={onPrevious}
            >
              Previous
            </PaginationPrevious>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext aria-label="Next page" disabled onClick={onNext}>
              Next
            </PaginationNext>
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    )

    const previous = screen.getByRole('button', { name: 'Previous page' })
    const next = screen.getByRole('button', { name: 'Next page' })
    expect(previous).toBeDisabled()
    expect(next).toBeDisabled()

    await user.tab()
    expect(previous).not.toHaveFocus()
    expect(next).not.toHaveFocus()

    await user.click(previous)
    await user.click(next)
    expect(onPrevious).not.toHaveBeenCalled()
    expect(onNext).not.toHaveBeenCalled()
  })
})
