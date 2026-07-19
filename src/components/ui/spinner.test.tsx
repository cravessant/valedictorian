import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Spinner } from './spinner'

afterEach(cleanup)

describe('Spinner', () => {
  it('exposes an accessible status with the default Loading label', () => {
    render(<Spinner />)

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('uses the caller label and forwards DOM identity attributes', () => {
    render(
      <Spinner
        aria-label="Saving draft"
        data-testid="draft-spinner"
        id="save-status"
      />,
    )

    const spinner = screen.getByRole('status', { name: 'Saving draft' })
    expect(spinner).toHaveAttribute('data-testid', 'draft-spinner')
    expect(spinner).toHaveAttribute('id', 'save-status')
  })
})
