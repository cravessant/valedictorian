import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Separator } from './separator'

afterEach(cleanup)

describe('Separator', () => {
  it('renders a decorative horizontal divider with the shared border token', () => {
    const { container } = render(<Separator />)

    const separator = container.querySelector('[data-slot="separator"]')
    expect(separator).not.toBeNull()
    expect(separator).toHaveAttribute('data-orientation', 'horizontal')
    expect(separator).toHaveClass(
      'shrink-0',
      'bg-border',
      'data-[orientation=horizontal]:h-px',
      'data-[orientation=horizontal]:w-full',
    )
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('applies vertical orientation sizing through the shared data-orientation contract', () => {
    const { container } = render(<Separator orientation="vertical" />)

    const separator = container.querySelector('[data-slot="separator"]')
    expect(separator).toHaveAttribute('data-orientation', 'vertical')
    expect(separator).toHaveClass(
      'bg-border',
      'data-[orientation=vertical]:h-full',
      'data-[orientation=vertical]:w-px',
    )
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('exposes a semantic separator role when decorative is opted out', () => {
    render(<Separator decorative={false} aria-label="Section boundary" />)

    const separator = screen.getByRole('separator', { name: 'Section boundary' })
    expect(separator).toHaveAttribute('data-slot', 'separator')
    expect(separator).toHaveAttribute('data-orientation', 'horizontal')
  })

  it('sets aria-orientation for semantic vertical separators', () => {
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

  it('merges layout spacing classes without dropping the shared border contract', () => {
    const { container } = render(<Separator className="my-4" />)

    expect(container.querySelector('[data-slot="separator"]')).toHaveClass(
      'my-4',
      'shrink-0',
      'bg-border',
      'data-[orientation=horizontal]:h-px',
    )
  })
})
