import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Button } from './button'
import { ButtonGroup } from './button-group'

afterEach(cleanup)

describe('ButtonGroup', () => {
  it('exposes an accessible named group for its child actions', () => {
    render(
      <ButtonGroup aria-label="Example pagination">
        <Button type="button">Previous</Button>
        <Button type="button">Next</Button>
      </ButtonGroup>,
    )

    expect(screen.getByRole('group', { name: 'Example pagination' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
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
