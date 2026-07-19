import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Item } from './item'

afterEach(cleanup)

describe('Item', () => {
  it('forwards asChild so the caller anchor is the accessible link', () => {
    render(
      <Item asChild>
        <a href="#workspace">Open workspace link</a>
      </Item>,
    )

    const link = screen.getByRole('link', { name: 'Open workspace link' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '#workspace')
  })
})
