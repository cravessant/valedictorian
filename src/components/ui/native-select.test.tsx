import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { NativeSelect, NativeSelectOption } from './native-select'

afterEach(cleanup)

describe('NativeSelect', () => {
  it('exposes an accessible name as a focusable native combobox', async () => {
    const user = userEvent.setup()
    render(
      <NativeSelect aria-label="Timezone" defaultValue="UTC">
        <NativeSelectOption value="UTC">UTC</NativeSelectOption>
        <NativeSelectOption value="US/Eastern">US/Eastern</NativeSelectOption>
      </NativeSelect>,
    )

    const select = screen.getByRole('combobox', { name: 'Timezone' })
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveValue('UTC')
    await user.tab()
    expect(select).toHaveFocus()
  })
})
