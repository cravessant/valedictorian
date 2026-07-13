import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge } from './badge'

describe('Badge', () => {
  it('renders the current shadcn badge contract with merged classes', () => {
    render(<Badge className="tracking-wide">Queued</Badge>)

    const badge = screen.getByText('Queued')
    expect(badge.tagName).toBe('SPAN')
    expect(badge).toHaveAttribute('data-slot', 'badge')
    expect(badge).toHaveAttribute('data-variant', 'default')
    expect(badge).toHaveClass('w-fit', 'rounded-full', 'tracking-wide')
  })
})
