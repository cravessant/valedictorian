import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Separator } from './separator'

afterEach(cleanup)

describe('Separator', () => {
  it('keeps decorative separators out of the accessibility tree', () => {
    render(<Separator />)

    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('exposes role, name, and aria-orientation for non-decorative vertical separators', () => {
    render(
      <Separator
        decorative={false}
        orientation="vertical"
        aria-label="Sidebar boundary"
      />,
    )

    expect(screen.getByRole('separator', { name: 'Sidebar boundary' })).toHaveAttribute(
      'aria-orientation',
      'vertical',
    )
  })
})
