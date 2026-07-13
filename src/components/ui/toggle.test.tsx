import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Toggle } from './toggle'

afterEach(cleanup)

describe('Toggle', () => {
  it('exposes its shadcn slot and controlled pressed state with aria-pressed', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [pressed, setPressed] = React.useState(false)
      return (
        <Toggle
          aria-label="Bold"
          pressed={pressed}
          onPressedChange={setPressed}
        >
          Bold
        </Toggle>
      )
    }

    render(<Harness />)

    const toggle = screen.getByRole('button', { name: 'Bold' })
    expect(toggle).toHaveAttribute('data-slot', 'toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAttribute('data-state', 'off')
    expect(toggle).toHaveClass(
      'focus-visible:border-ring',
      'focus-visible:ring-ring/50',
      'motion-reduce:transition-none',
    )

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveAttribute('data-state', 'on')
  })

  it('toggles with Space and keeps disabled toggles unpressable', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [pressed, setPressed] = React.useState(false)
      return (
        <>
          <Toggle
            aria-label="Italic"
            pressed={pressed}
            onPressedChange={setPressed}
          >
            Italic
          </Toggle>
          <Toggle aria-label="Underline" disabled>
            Underline
          </Toggle>
        </>
      )
    }

    render(<Harness />)

    const italic = screen.getByRole('button', { name: 'Italic' })
    italic.focus()
    expect(italic).toHaveFocus()
    await user.keyboard(' ')
    expect(italic).toHaveAttribute('aria-pressed', 'true')

    const underline = screen.getByRole('button', { name: 'Underline' })
    expect(underline).toBeDisabled()
    await user.click(underline)
    expect(underline).toHaveAttribute('aria-pressed', 'false')
  })
})
