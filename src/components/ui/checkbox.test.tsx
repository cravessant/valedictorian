import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Checkbox } from './checkbox'
import { Label } from './label'

afterEach(cleanup)

describe('Checkbox', () => {
  it('exposes its shadcn slot and accessible name as a focusable checkbox', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Checkbox id="seed-demo-data" />
        <Label htmlFor="seed-demo-data">Seed demo data</Label>
      </>,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Seed demo data' })
    expect(checkbox).toHaveAttribute('data-slot', 'checkbox')
    expect(checkbox).toHaveAttribute('data-state', 'unchecked')
    expect(checkbox).toHaveClass(
      'border-input',
      'bg-input/30',
      'focus-visible:ring-ring/50',
      'data-[state=checked]:bg-primary',
    )
    await user.tab()
    expect(checkbox).toHaveFocus()
    await user.click(screen.getByText('Seed demo data'))
    expect(checkbox).toBeChecked()
  })

  it('forwards controlled checked state through click and Space', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [checked, setChecked] = React.useState(false)
      return (
        <Checkbox
          aria-label="Primary link"
          checked={checked}
          onCheckedChange={(value) => setChecked(value === true)}
        />
      )
    }

    render(<Harness />)
    const checkbox = screen.getByRole('checkbox', { name: 'Primary link' })
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)
    expect(checkbox).toBeChecked()

    checkbox.focus()
    expect(checkbox).toHaveFocus()
    await user.keyboard(' ')
    expect(checkbox).not.toBeChecked()
  })

  it('keeps disabled checkboxes out of keyboard focus and blocks toggling', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [checked, setChecked] = React.useState(false)
      return (
        <>
          <Checkbox
            aria-label="Available to automation"
            checked={checked}
            disabled
            onCheckedChange={(value) => setChecked(value === true)}
          />
          <button type="button">Next action</button>
        </>
      )
    }

    render(<Harness />)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus()
    await user.click(screen.getByLabelText('Available to automation'))
    expect(screen.getByLabelText('Available to automation')).not.toBeChecked()
  })

  it('exposes indeterminate state for partial table selection', () => {
    render(
      <Checkbox aria-label="Select all applications on page" checked="indeterminate" />,
    )

    const checkbox = screen.getByRole('checkbox', {
      name: 'Select all applications on page',
    })
    expect(checkbox).toHaveAttribute('data-state', 'indeterminate')
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed')
    expect(checkbox.querySelector('[data-slot="checkbox-indicator"]')).not.toBeNull()
  })

  it('marks invalid checkboxes with destructive border and ring classes', () => {
    render(<Checkbox aria-invalid aria-label="Has applied" />)

    const checkbox = screen.getByRole('checkbox', { name: 'Has applied' })
    expect(checkbox).toHaveAttribute('aria-invalid', 'true')
    expect(checkbox).toHaveClass(
      'aria-invalid:border-destructive',
      'aria-invalid:ring-destructive/20',
    )
  })

  it('merges layout classes without dropping the shared focus contract', () => {
    render(
      <Checkbox
        aria-label="Source column"
        className="mx-auto block"
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Source column' })
    expect(checkbox).toHaveClass(
      'mx-auto',
      'block',
      'focus-visible:ring-[3px]',
      'disabled:opacity-50',
      'size-4',
    )
  })
})
