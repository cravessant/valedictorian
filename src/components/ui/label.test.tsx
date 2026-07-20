import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Label } from './label'

afterEach(cleanup)

describe('Label', () => {
  it('associates a control through htmlFor so the accessible name comes from the label', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Label htmlFor="workspace-name">Workspace name</Label>
        <input id="workspace-name" />
      </>,
    )

    const input = screen.getByLabelText('Workspace name')
    expect(input).toHaveAttribute('id', 'workspace-name')
    await user.click(screen.getByText('Workspace name'))
    expect(input).toHaveFocus()
  })

  it('associates a nested control so clicking the label text focuses the input', async () => {
    const user = userEvent.setup()
    render(
      <Label>
        Remote API URL
        <input aria-label="Remote API URL" />
      </Label>,
    )

    const input = screen.getByLabelText('Remote API URL')
    await user.click(screen.getByText('Remote API URL'))
    expect(input).toHaveFocus()
  })
})
