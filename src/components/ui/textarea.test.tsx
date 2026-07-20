import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Textarea } from './textarea'

afterEach(cleanup)

describe('Textarea', () => {
  it('exposes an accessible name as a focusable textbox', async () => {
    const user = userEvent.setup()
    render(<Textarea aria-label="Disposition notes" defaultValue="Needs review" />)

    const textarea = screen.getByRole('textbox', { name: 'Disposition notes' })
    expect(textarea).toHaveValue('Needs review')
    await user.tab()
    expect(textarea).toHaveFocus()
  })
})
