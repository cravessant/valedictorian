import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Toggle } from './toggle'

afterEach(cleanup)

describe('Toggle', () => {
  it('reflects controlled pressed state through aria-pressed', async () => {
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
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })
})
