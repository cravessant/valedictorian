import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToggleGroup, ToggleGroupItem } from './toggle-group'

afterEach(cleanup)

describe('ToggleGroup', () => {
  it('exposes slots and controlled single selection with aria-pressed', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('all')
      return (
        <ToggleGroup
          type="single"
          aria-label="Action Buckets"
          value={value}
          onValueChange={setValue}
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="apply_now">Apply now</ToggleGroupItem>
        </ToggleGroup>
      )
    }

    render(<Harness />)

    const group = screen.getByRole('radiogroup', { name: 'Action Buckets' })
    expect(group).toHaveAttribute('data-slot', 'toggle-group')

    const all = screen.getByRole('radio', { name: 'All' })
    const applyNow = screen.getByRole('radio', { name: 'Apply now' })
    expect(all).toHaveAttribute('data-slot', 'toggle-group-item')
    expect(all).toHaveAttribute('aria-checked', 'true')
    expect(all).toHaveAttribute('data-state', 'on')
    expect(applyNow).toHaveAttribute('aria-checked', 'false')
    expect(applyNow).toHaveAttribute('data-state', 'off')

    await user.click(applyNow)
    expect(applyNow).toHaveAttribute('aria-checked', 'true')
    expect(applyNow).toHaveAttribute('data-state', 'on')
    expect(all).toHaveAttribute('aria-checked', 'false')
    expect(all).toHaveAttribute('data-state', 'off')
  })

  it('moves focus with arrow keys and activates the focused item with Space', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('all')
      return (
        <ToggleGroup
          type="single"
          aria-label="Action Buckets"
          value={value}
          onValueChange={(next) => {
            if (next) setValue(next)
          }}
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="apply_now">Apply now</ToggleGroupItem>
          <ToggleGroupItem value="blocked">Blocked</ToggleGroupItem>
        </ToggleGroup>
      )
    }

    render(<Harness />)
    screen.getByRole('radio', { name: 'All' }).focus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Apply now' })).toHaveFocus()

    await user.keyboard(' ')
    expect(screen.getByRole('radio', { name: 'Apply now' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'false')
  })

  it('keeps disabled items out of keyboard focus and blocks selection', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('all')
      return (
        <>
          <ToggleGroup
            type="single"
            aria-label="Action Buckets"
            value={value}
            onValueChange={(next) => {
              if (next) setValue(next)
            }}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="blocked" disabled>
              Blocked
            </ToggleGroupItem>
          </ToggleGroup>
          <button type="button">Next action</button>
        </>
      )
    }

    render(<Harness />)
    await user.tab()
    expect(screen.getByRole('radio', { name: 'All' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus()

    await user.click(screen.getByRole('radio', { name: 'Blocked' }))
    expect(screen.getByRole('radio', { name: 'Blocked' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Blocked' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true')
  })

  it('does not clear the selected item when it is reactivated', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    function Harness() {
      const [value, setValue] = React.useState('apply_now')
      return (
        <ToggleGroup
          type="single"
          aria-label="Action Buckets"
          value={value}
          onValueChange={(next) => {
            onValueChange(next)
            if (!next) return
            setValue(next)
          }}
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="apply_now">Apply now</ToggleGroupItem>
        </ToggleGroup>
      )
    }

    render(<Harness />)
    const applyNow = screen.getByRole('radio', { name: 'Apply now' })
    expect(applyNow).toHaveAttribute('aria-checked', 'true')

    await user.click(applyNow)
    expect(onValueChange).toHaveBeenCalledWith('')
    expect(applyNow).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'false')
  })
})
