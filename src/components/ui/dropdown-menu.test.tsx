import * as React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './dropdown-menu'

afterEach(cleanup)

describe('DropdownMenu', () => {
  it('exposes an accessible asChild trigger that opens a labeled menu', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Columns
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Column visibility" align="end">
          <DropdownMenuCheckboxItem checked>Source</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    const trigger = screen.getByRole('button', { name: 'Columns' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(trigger)

    const menu = await screen.findByRole('menu', { name: 'Column visibility' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Source' }),
    ).toBeChecked()
  })

  it('opens the menu with Enter and Space on the trigger', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button">Columns</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Column visibility">
          <DropdownMenuCheckboxItem checked>Source</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    const trigger = screen.getByRole('button', { name: 'Columns' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('menu', { name: 'Column visibility' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    expect(trigger).toHaveFocus()
    await user.keyboard(' ')
    expect(await screen.findByRole('menu', { name: 'Column visibility' })).toBeInTheDocument()
  })

  it('moves focus to the first item on keyboard open and through items with ArrowDown', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button">Columns</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Column visibility">
          <DropdownMenuCheckboxItem checked>Source</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={false}>Score</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={false}>Link</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    const trigger = screen.getByRole('button', { name: 'Columns' })
    trigger.focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: 'Column visibility' })
    const source = within(menu).getByRole('menuitemcheckbox', { name: 'Source' })
    const score = within(menu).getByRole('menuitemcheckbox', { name: 'Score' })
    const link = within(menu).getByRole('menuitemcheckbox', { name: 'Link' })

    await waitFor(() => {
      expect(source).toHaveFocus()
    })

    await user.keyboard('{ArrowDown}')
    expect(score).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(link).toHaveFocus()
  })

  it('toggles controlled checkbox items with Space and Enter without closing', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [sourceVisible, setSourceVisible] = React.useState(true)
      const [scoreVisible, setScoreVisible] = React.useState(false)
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button">Columns</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent aria-label="Column visibility">
            <DropdownMenuCheckboxItem
              checked={sourceVisible}
              onCheckedChange={setSourceVisible}
              onSelect={(event) => event.preventDefault()}
            >
              Source
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={scoreVisible}
              onCheckedChange={setScoreVisible}
              onSelect={(event) => event.preventDefault()}
            >
              Score
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Columns' })
    trigger.focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: 'Column visibility' })
    const source = within(menu).getByRole('menuitemcheckbox', { name: 'Source' })
    const score = within(menu).getByRole('menuitemcheckbox', { name: 'Score' })

    expect(source).toBeChecked()
    expect(score).not.toBeChecked()

    await waitFor(() => {
      expect(source).toHaveFocus()
    })
    await user.keyboard(' ')
    expect(source).not.toBeChecked()
    expect(screen.getByRole('menu', { name: 'Column visibility' })).toBeInTheDocument()

    await user.keyboard('{ArrowDown}')
    expect(score).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(score).toBeChecked()
    expect(screen.getByRole('menu', { name: 'Column visibility' })).toBeInTheDocument()
  })

  it('skips disabled checkbox items during arrow navigation and blocks toggling', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [sourceVisible, setSourceVisible] = React.useState(true)
      const [linkVisible, setLinkVisible] = React.useState(true)
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button">Columns</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent aria-label="Column visibility">
            <DropdownMenuCheckboxItem
              checked={sourceVisible}
              onCheckedChange={setSourceVisible}
              onSelect={(event) => event.preventDefault()}
            >
              Source
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked disabled onSelect={(event) => event.preventDefault()}>
              Timing
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={linkVisible}
              onCheckedChange={setLinkVisible}
              onSelect={(event) => event.preventDefault()}
            >
              Link
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }

    render(<Harness />)
    screen.getByRole('button', { name: 'Columns' }).focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: 'Column visibility' })
    const source = within(menu).getByRole('menuitemcheckbox', { name: 'Source' })
    const timing = within(menu).getByRole('menuitemcheckbox', { name: 'Timing' })
    const link = within(menu).getByRole('menuitemcheckbox', { name: 'Link' })

    await waitFor(() => {
      expect(source).toHaveFocus()
    })
    await user.keyboard('{ArrowDown}')
    expect(link).toHaveFocus()
    expect(timing).toHaveAttribute('aria-disabled', 'true')
    expect(timing).toBeChecked()

    await user.click(timing)
    expect(timing).toBeChecked()
  })
})
