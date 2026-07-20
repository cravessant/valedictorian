import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Input } from './input'

afterEach(cleanup)

describe('Input', () => {
  it('exposes an accessible name as a focusable textbox', async () => {
    const user = userEvent.setup()
    render(<Input aria-label="Workspace name" defaultValue="Primary" />)

    const input = screen.getByRole('textbox', { name: 'Workspace name' })
    expect(input).toHaveValue('Primary')
    await user.tab()
    expect(input).toHaveFocus()
  })
})
