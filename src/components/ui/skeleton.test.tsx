import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Skeleton } from './skeleton'

afterEach(cleanup)

describe('Skeleton', () => {
  it('renders the shadcn skeleton slot with accent pulse styling', () => {
    const { container } = render(<Skeleton />)

    const skeleton = container.querySelector('[data-slot="skeleton"]')
    expect(skeleton).not.toBeNull()
    expect(skeleton).toHaveClass('animate-pulse', 'rounded-md', 'bg-accent')
  })

  it('disables pulse animation under reduced motion', () => {
    const { container } = render(<Skeleton />)

    expect(container.querySelector('[data-slot="skeleton"]')).toHaveClass(
      'motion-reduce:animate-none',
    )
  })

  it('defaults to a decorative aria-hidden placeholder', () => {
    const { container } = render(<Skeleton />)

    expect(container.querySelector('[data-slot="skeleton"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('forwards DOM props and lets callers override aria-hidden', () => {
    const { container } = render(
      <Skeleton aria-hidden={false} data-testid="profile-skeleton" id="loading-block" />,
    )

    const skeleton = container.querySelector('[data-slot="skeleton"]')
    expect(skeleton).toHaveAttribute('data-testid', 'profile-skeleton')
    expect(skeleton).toHaveAttribute('id', 'loading-block')
    expect(skeleton).toHaveAttribute('aria-hidden', 'false')
  })

  it('merges caller className without dropping the shared skeleton contract', () => {
    const { container } = render(<Skeleton className="h-32 w-full" />)

    expect(container.querySelector('[data-slot="skeleton"]')).toHaveClass(
      'h-32',
      'w-full',
      'animate-pulse',
      'rounded-md',
      'bg-accent',
      'motion-reduce:animate-none',
    )
  })
})
