import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Skeleton } from './skeleton'

afterEach(cleanup)

describe('Skeleton', () => {
  it('defaults to a decorative aria-hidden placeholder', () => {
    const { container } = render(<Skeleton />)

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('lets callers opt out of decorative aria-hidden', () => {
    const { container } = render(<Skeleton aria-hidden={false} />)

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'false')
  })
})
