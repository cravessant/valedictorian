import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Label } from './label'
import { Switch } from './switch'

afterEach(cleanup)

describe('Switch', () => {
  it('exposes an accessible name as a focusable switch that toggles from its label', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Switch id="local-api-sharing" />
        <Label htmlFor="local-api-sharing">Local API sharing</Label>
      </>,
    )

    const toggle = screen.getByRole('switch', { name: 'Local API sharing' })
    expect(toggle).not.toBeChecked()
    await user.tab()
    expect(toggle).toHaveFocus()
    await user.click(screen.getByText('Local API sharing'))
    expect(toggle).toBeChecked()
  })
})
