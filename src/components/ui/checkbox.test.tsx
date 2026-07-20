import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Checkbox } from './checkbox'
import { Label } from './label'

afterEach(cleanup)

describe('Checkbox', () => {
  it('exposes an accessible name as a focusable checkbox that toggles from its label', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Checkbox id="seed-demo-data" />
        <Label htmlFor="seed-demo-data">Seed demo data</Label>
      </>,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Seed demo data' })
    expect(checkbox).not.toBeChecked()
    await user.tab()
    expect(checkbox).toHaveFocus()
    await user.click(screen.getByText('Seed demo data'))
    expect(checkbox).toBeChecked()
  })

  it('exposes indeterminate state for partial table selection', () => {
    render(
      <Checkbox aria-label="Select all applications on page" checked="indeterminate" />,
    )

    const checkbox = screen.getByRole('checkbox', {
      name: 'Select all applications on page',
    })
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed')
  })
})
