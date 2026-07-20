import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Button } from './button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog'

afterEach(cleanup)

describe('AlertDialog', () => {
  it('exposes alertdialog role with accessible name and description', async () => {
    const user = userEvent.setup()
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button">Open alert</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the item.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    )

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open alert' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete item' })
    expect(dialog).toHaveAccessibleDescription('This permanently removes the item.')
  })

  it('cancels on Escape and Cancel, returns focus to the trigger, and ignores outside pointer down', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button">Open alert</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm delete</AlertDialogTitle>
            <AlertDialogDescription>Cancel must not confirm.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onAction}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open alert' })
    await user.click(trigger)
    expect(await screen.findByRole('alertdialog', { name: 'Confirm delete' })).toBeInTheDocument()

    await user.click(document.querySelector('[data-slot="alert-dialog-overlay"]')!)
    expect(screen.getByRole('alertdialog', { name: 'Confirm delete' })).toBeInTheDocument()
    expect(onAction).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Confirm delete' })).not.toBeInTheDocument()
    })
    expect(trigger).toHaveFocus()
    expect(onAction).not.toHaveBeenCalled()

    await user.click(trigger)
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm delete' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Confirm delete' })).not.toBeInTheDocument()
    })
    expect(trigger).toHaveFocus()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('moves focus into the alert and confirms with the destructive action', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button">Open alert</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm delete</AlertDialogTitle>
            <AlertDialogDescription>Confirm runs the action.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onAction}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open alert' })
    trigger.focus()
    await user.click(trigger)

    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm delete' })
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    const confirm = within(dialog).getByRole('button', { name: 'Delete' })
    await user.click(confirm)

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Confirm delete' })).not.toBeInTheDocument()
    })
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveFocus()
  })
})
