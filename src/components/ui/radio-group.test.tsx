import * as React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Label } from './label'
import { RadioGroup, RadioGroupItem } from './radio-group'

afterEach(cleanup)

describe('RadioGroup', () => {
  it('exposes an accessible name as a focusable radio', async () => {
    const user = userEvent.setup()
    render(
      <RadioGroup aria-label="Backend mode" defaultValue="local-desktop">
        <div className="flex items-center gap-2">
          <RadioGroupItem id="runtime-mode-local-desktop" value="local-desktop" />
          <Label htmlFor="runtime-mode-local-desktop">Local desktop</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem id="runtime-mode-remote" value="remote" />
          <Label htmlFor="runtime-mode-remote">Remote</Label>
        </div>
      </RadioGroup>,
    )

    const radio = screen.getByRole('radio', { name: 'Local desktop' })
    expect(radio).toHaveAttribute('data-state', 'checked')
    expect(screen.getByRole('radiogroup', { name: 'Backend mode' })).toBeInTheDocument()

    await user.tab()
    expect(radio).toHaveFocus()
  })

  it('forwards controlled value identity through click selection', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('local-desktop')
      return (
        <RadioGroup
          aria-label="Backend mode"
          value={value}
          onValueChange={setValue}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id="runtime-mode-local-desktop" value="local-desktop" />
            <Label htmlFor="runtime-mode-local-desktop">Local desktop</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="runtime-mode-remote" value="remote" />
            <Label htmlFor="runtime-mode-remote">Remote</Label>
          </div>
        </RadioGroup>
      )
    }

    render(<Harness />)
    expect(screen.getByRole('radio', { name: 'Local desktop' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Remote' })).not.toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Remote' }))
    expect(screen.getByRole('radio', { name: 'Remote' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Local desktop' })).not.toBeChecked()
  })

  it('selects the focused radio with Space', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('local-desktop')
      return (
        <RadioGroup
          aria-label="Backend mode"
          value={value}
          onValueChange={setValue}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id="runtime-mode-local-desktop" value="local-desktop" />
            <Label htmlFor="runtime-mode-local-desktop">Local desktop</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="runtime-mode-remote" value="remote" />
            <Label htmlFor="runtime-mode-remote">Remote</Label>
          </div>
        </RadioGroup>
      )
    }

    render(<Harness />)
    const remote = screen.getByRole('radio', { name: 'Remote' })
    remote.focus()
    expect(remote).toHaveFocus()
    await user.keyboard(' ')
    expect(remote).toBeChecked()
  })

  it('moves focus and selection together on a complete arrow key press', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('local-desktop')
      return (
        <RadioGroup
          aria-label="Backend mode"
          value={value}
          onValueChange={setValue}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id="runtime-mode-local-desktop" value="local-desktop" />
            <Label htmlFor="runtime-mode-local-desktop">Local desktop</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="runtime-mode-local-shared" value="local-shared" />
            <Label htmlFor="runtime-mode-local-shared">Local shared</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="runtime-mode-remote" value="remote" />
            <Label htmlFor="runtime-mode-remote">Remote</Label>
          </div>
        </RadioGroup>
      )
    }

    render(<Harness />)
    screen.getByRole('radio', { name: 'Local desktop' }).focus()

    // Normal press+release must select even when keyup races ahead of Radix's setTimeout focus.
    await user.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Local shared' })).toHaveFocus()
      expect(screen.getByRole('radio', { name: 'Local shared' })).toBeChecked()
    })

    await user.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Remote' })).toHaveFocus()
      expect(screen.getByRole('radio', { name: 'Remote' })).toBeChecked()
    })
  })

  it('runs consumer root onKeyUp and skips compatibility click when default is prevented', async () => {
    const user = userEvent.setup()
    const onKeyUp = vi.fn((event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') event.preventDefault()
    })
    function Harness() {
      const [value, setValue] = React.useState('local-desktop')
      return (
        <RadioGroup
          aria-label="Backend mode"
          value={value}
          onValueChange={setValue}
          onKeyUp={onKeyUp}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id="runtime-mode-local-desktop" value="local-desktop" />
            <Label htmlFor="runtime-mode-local-desktop">Local desktop</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="runtime-mode-local-shared" value="local-shared" />
            <Label htmlFor="runtime-mode-local-shared">Local shared</Label>
          </div>
        </RadioGroup>
      )
    }

    render(<Harness />)
    screen.getByRole('radio', { name: 'Local desktop' }).focus()

    await user.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Local shared' })).toHaveFocus()
    })
    expect(onKeyUp).toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'Local shared' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Local desktop' })).toBeChecked()
  })

  it('keeps disabled radios out of keyboard focus and blocks selection', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('local-desktop')
      return (
        <>
          <RadioGroup
            aria-label="Backend mode"
            value={value}
            onValueChange={setValue}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem id="runtime-mode-local-desktop" value="local-desktop" />
              <Label htmlFor="runtime-mode-local-desktop">Local desktop</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem disabled id="runtime-mode-remote" value="remote" />
              <Label htmlFor="runtime-mode-remote">Remote</Label>
            </div>
          </RadioGroup>
          <button type="button">Next action</button>
        </>
      )
    }

    render(<Harness />)
    await user.tab()
    expect(screen.getByRole('radio', { name: 'Local desktop' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus()
    await user.click(screen.getByLabelText('Remote'))
    expect(screen.getByLabelText('Remote')).not.toBeChecked()
    expect(screen.getByLabelText('Remote')).toBeDisabled()
    expect(screen.getByLabelText('Local desktop')).toBeChecked()
  })

  it('keeps an unset group with no selected radio for empty controlled value', () => {
    render(
      <RadioGroup aria-label="Willing to relocate" value="">
        <div className="flex items-center gap-2">
          <RadioGroupItem
            aria-label="Willing to relocate Yes"
            id="preference-willing-to-relocate-yes"
            value="true"
          />
          <Label htmlFor="preference-willing-to-relocate-yes">Yes</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem
            aria-label="Willing to relocate No"
            id="preference-willing-to-relocate-no"
            value="false"
          />
          <Label htmlFor="preference-willing-to-relocate-no">No</Label>
        </div>
      </RadioGroup>,
    )

    expect(screen.getByRole('radio', { name: 'Willing to relocate Yes' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Willing to relocate No' })).not.toBeChecked()
  })
})
