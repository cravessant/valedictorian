import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Spinner } from './spinner'

afterEach(cleanup)

describe('Spinner', () => {
  it('exposes an accessible status with spin classes, reduced-motion opt-out, and prop forwarding', () => {
    render(
      <Spinner
        aria-label="Saving draft"
        className="size-3.5 text-muted-foreground"
        data-testid="draft-spinner"
        id="save-status"
      />,
    )

    const spinner = screen.getByRole('status', { name: 'Saving draft' })
    expect(spinner).toHaveAttribute('data-testid', 'draft-spinner')
    expect(spinner).toHaveAttribute('id', 'save-status')
    expect(spinner).toHaveClass(
      'animate-spin',
      'motion-reduce:animate-none',
      'size-3.5',
      'text-muted-foreground',
    )
    expect(spinner).not.toHaveClass('size-4')

    cleanup()
    render(<Spinner />)
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveClass(
      'size-4',
      'animate-spin',
      'motion-reduce:animate-none',
    )
  })
})
