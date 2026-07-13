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

  it('keeps peer-disabled styling so a disabled sibling control dims the label', () => {
    render(
      <div>
        <input className="peer" disabled id="schedule-mode" />
        <Label htmlFor="schedule-mode">Schedule mode</Label>
      </div>,
    )

    const label = screen.getByText('Schedule mode')
    expect(label).toHaveAttribute('data-slot', 'label')
    expect(label).toHaveClass(
      'peer-disabled:cursor-not-allowed',
      'peer-disabled:opacity-50',
      'group-data-[disabled=true]:pointer-events-none',
      'group-data-[disabled=true]:opacity-50',
    )
  })

  it('merges layout classes while preserving an accessible name for nested disabled controls', () => {
    render(
      <Label className="grid gap-1 text-xs text-muted-foreground">
        Local API sharing
        <input aria-label="Local API sharing" disabled type="checkbox" />
      </Label>,
    )

    const checkbox = screen.getByLabelText('Local API sharing')
    expect(checkbox).toBeDisabled()
    expect(checkbox.closest('[data-slot="label"]')).toHaveClass(
      'grid',
      'gap-1',
      'text-xs',
      'text-muted-foreground',
      'font-medium',
    )
  })
})
