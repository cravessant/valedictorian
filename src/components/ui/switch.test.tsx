import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Label } from './label'
import { Switch } from './switch'

afterEach(cleanup)

describe('Switch', () => {
  it('exposes its shadcn slot and accessible name as a focusable switch', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Switch id="local-api-sharing" />
        <Label htmlFor="local-api-sharing">Local API sharing</Label>
      </>,
    )

    const toggle = screen.getByRole('switch', { name: 'Local API sharing' })
    expect(toggle).toHaveAttribute('data-slot', 'switch')
    expect(toggle).toHaveAttribute('data-state', 'unchecked')
    expect(toggle).toHaveClass(
      'data-[state=checked]:bg-primary',
      'focus-visible:ring-ring/50',
      'disabled:opacity-50',
    )
    await user.tab()
    expect(toggle).toHaveFocus()
    await user.click(screen.getByText('Local API sharing'))
    expect(toggle).toBeChecked()
  })

  it('forwards controlled checked state through click and Space', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [checked, setChecked] = React.useState(false)
      return (
        <Switch
          aria-label="Use remote backend"
          checked={checked}
          onCheckedChange={setChecked}
        />
      )
    }

    render(<Harness />)
    const toggle = screen.getByRole('switch', { name: 'Use remote backend' })
    expect(toggle).not.toBeChecked()

    await user.click(toggle)
    expect(toggle).toBeChecked()

    toggle.focus()
    expect(toggle).toHaveFocus()
    await user.keyboard(' ')
    expect(toggle).not.toBeChecked()
  })

  it('keeps disabled switches out of keyboard focus and blocks toggling', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [checked, setChecked] = React.useState(false)
      return (
        <>
          <Switch
            aria-label="Local API sharing"
            checked={checked}
            disabled
            onCheckedChange={setChecked}
          />
          <button type="button">Next action</button>
        </>
      )
    }

    render(<Harness />)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus()
    await user.click(screen.getByLabelText('Local API sharing'))
    expect(screen.getByLabelText('Local API sharing')).not.toBeChecked()
  })

  it('exposes default and sm sizes through data slots', () => {
    const { rerender } = render(<Switch aria-label="Default size" />)
    const defaultToggle = screen.getByRole('switch', { name: 'Default size' })
    expect(defaultToggle).toHaveAttribute('data-size', 'default')
    expect(defaultToggle.querySelector('[data-slot="switch-thumb"]')).not.toBeNull()

    rerender(<Switch aria-label="Default size" size="sm" />)
    expect(screen.getByRole('switch', { name: 'Default size' })).toHaveAttribute(
      'data-size',
      'sm',
    )
  })

  it('merges layout classes without dropping the shared focus contract', () => {
    render(
      <Switch
        aria-label="Runtime preference"
        className="mx-auto block"
        data-testid="runtime-switch"
      />,
    )

    const toggle = screen.getByRole('switch', { name: 'Runtime preference' })
    expect(toggle).toHaveAttribute('data-testid', 'runtime-switch')
    expect(toggle).toHaveClass(
      'mx-auto',
      'block',
      'focus-visible:ring-[3px]',
      'disabled:opacity-50',
      'data-[size=default]:w-8',
    )
  })
})
