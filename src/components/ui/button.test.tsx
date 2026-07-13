import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './button'

afterEach(cleanup)

describe('Button', () => {
  it('exposes its shadcn slot, variant, and size contract', () => {
    render(
      <Button variant="destructive" size="icon-sm" aria-label="Delete application">
        ×
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Delete application' })
    expect(button).toHaveAttribute('data-slot', 'button')
    expect(button).toHaveAttribute('data-variant', 'destructive')
    expect(button).toHaveAttribute('data-size', 'icon-sm')
    expect(button).toHaveClass('bg-destructive', 'size-8')
  })

  it('composes an accessible button-like link with asChild', () => {
    render(
      <Button asChild variant="link">
        <a href="https://example.com/help">Open help</a>
      </Button>,
    )

    const link = screen.getByRole('link', { name: 'Open help' })
    expect(link).toHaveAttribute('href', 'https://example.com/help')
    expect(link).toHaveAttribute('data-slot', 'button')
    expect(link).toHaveAttribute('data-variant', 'link')
  })

  it('keeps disabled actions out of keyboard focus and prevents activation', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <>
        <Button disabled onClick={onClick}>Save</Button>
        <button type="button">Next action</button>
      </>,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
