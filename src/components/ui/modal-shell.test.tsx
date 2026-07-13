import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ModalShell } from './modal-shell'

afterEach(cleanup)

describe('ModalShell keyboard behavior', () => {
  it('moves focus inside, traps Tab in both directions, closes on Escape, and restores focus', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Inspect record</button>
          {open ? (
            <ModalShell title="Record detail" onClose={() => setOpen(false)}>
              <button type="button">First detail action</button>
              <a href="https://example.test/jobs">Last detail action</a>
            </ModalShell>
          ) : null}
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Inspect record' })
    trigger.focus()
    fireEvent.click(trigger)

    const close = screen.getByRole('button', { name: 'Close Record detail' })
    const last = screen.getByRole('link', { name: 'Last detail action' })
    expect(close).toHaveFocus()

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()

    close.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Record detail' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
