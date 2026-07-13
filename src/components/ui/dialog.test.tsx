import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog'

afterEach(cleanup)

describe('Dialog', () => {
  it('portals open content into document.body outside the trigger tree', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <div data-testid="dialog-host">
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Dialog title</DialogTitle>
            <DialogDescription>Dialog description</DialogDescription>
            <p>Dialog body</p>
          </DialogContent>
        </Dialog>
      </div>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open dialog' }))

    const dialog = await screen.findByRole('dialog', { name: 'Dialog title' })
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content')
    expect(within(dialog).getByText('Dialog body')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="dialog-host"]')?.contains(dialog)).toBe(false)
    expect(document.body.contains(dialog)).toBe(true)
  })

  it('associates title and description with the dialog accessible name and description', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button">Open dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirm archive</DialogTitle>
          <DialogDescription>Archived applications stay recoverable.</DialogDescription>
        </DialogContent>
      </Dialog>,
    )

    await user.click(screen.getByRole('button', { name: 'Open dialog' }))

    const dialog = await screen.findByRole('dialog', { name: 'Confirm archive' })
    expect(dialog).toHaveAccessibleDescription('Archived applications stay recoverable.')
    expect(screen.getByText('Confirm archive')).toHaveAttribute('data-slot', 'dialog-title')
    expect(screen.getByText('Archived applications stay recoverable.')).toHaveAttribute(
      'data-slot',
      'dialog-description',
    )
  })

  it('moves initial focus into the dialog when opened from a trigger', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button">Open dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Focus dialog</DialogTitle>
          <DialogDescription>Focus should enter the dialog.</DialogDescription>
          <Button type="button">First action</Button>
        </DialogContent>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open dialog' })
    trigger.focus()
    expect(trigger).toHaveFocus()

    await user.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'Focus dialog' })
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
  })

  it('traps Tab navigation within the open dialog', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button">Open dialog</Button>
        </DialogTrigger>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Tab trap</DialogTitle>
          <DialogDescription>Tab stays inside.</DialogDescription>
          <Button type="button">First</Button>
          <Button type="button">Last</Button>
        </DialogContent>
      </Dialog>,
    )

    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tab trap' })
    const first = within(dialog).getByRole('button', { name: 'First' })
    const last = within(dialog).getByRole('button', { name: 'Last' })

    first.focus()
    expect(first).toHaveFocus()

    await user.tab()
    expect(last).toHaveFocus()

    await user.tab()
    expect(first).toHaveFocus()

    await user.tab({ shift: true })
    expect(last).toHaveFocus()
  })

  it('dismisses on Escape and outside pointer down, then returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button">Open dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Dismiss dialog</DialogTitle>
          <DialogDescription>Escape and outside click close it.</DialogDescription>
        </DialogContent>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open dialog' })
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Dismiss dialog' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Dismiss dialog' })).not.toBeInTheDocument()
    })
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Dismiss dialog' })).toBeInTheDocument()

    await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Dismiss dialog' })).not.toBeInTheDocument()
    })
    expect(trigger).toHaveFocus()
  })
})
