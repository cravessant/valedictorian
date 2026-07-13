import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Button } from './button'
import { ButtonGroup } from './button-group'

afterEach(cleanup)

describe('ButtonGroup', () => {
  it('exposes its shadcn root slot and group role', () => {
    render(
      <ButtonGroup aria-label="Example pagination">
        <Button type="button">Previous</Button>
        <Button type="button">Next</Button>
      </ButtonGroup>,
    )

    const group = screen.getByRole('group', { name: 'Example pagination' })
    expect(group).toHaveAttribute('data-slot', 'button-group')
  })

  it('merges orientation and className onto the root contract', () => {
    render(
      <ButtonGroup
        aria-label="Vertical actions"
        orientation="vertical"
        className="custom-group"
      >
        <Button type="button">Up</Button>
        <Button type="button">Down</Button>
      </ButtonGroup>,
    )

    const group = screen.getByRole('group', { name: 'Vertical actions' })
    expect(group).toHaveAttribute('data-orientation', 'vertical')
    expect(group).toHaveClass('flex-col', 'custom-group', 'w-fit')
  })

  it('keeps ordinary Tab order across grouped buttons without arrow-key selection', async () => {
    const user = userEvent.setup()

    render(
      <ButtonGroup aria-label="Pagination">
        <Button type="button">Previous</Button>
        <Button type="button">Next</Button>
      </ButtonGroup>,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Previous' })).not.toHaveFocus()
  })

  it('leaves a disabled child button disabled and unfocusable', async () => {
    const user = userEvent.setup()
    const onPrevious = vi.fn()

    render(
      <ButtonGroup aria-label="Pagination">
        <Button type="button" disabled onClick={onPrevious}>
          Previous
        </Button>
        <Button type="button">Next</Button>
      </ButtonGroup>,
    )

    const previous = screen.getByRole('button', { name: 'Previous' })
    expect(previous).toBeDisabled()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()

    await user.click(previous)
    expect(onPrevious).not.toHaveBeenCalled()
  })
})
