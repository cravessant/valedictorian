import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible'

afterEach(cleanup)

describe('Collapsible', () => {
  it('exposes accessible trigger/content slots and toggles via click and Enter', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = React.useState(false)
      return (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger>Debug details</CollapsibleTrigger>
          <CollapsibleContent>
            <p>Hidden until expanded</p>
          </CollapsibleContent>
        </Collapsible>
      )
    }

    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Debug details' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Hidden until expanded')).not.toBeInTheDocument()

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls')
    const contentId = trigger.getAttribute('aria-controls')
    expect(contentId).toBeTruthy()
    const content = document.getElementById(contentId!)
    expect(content).toBeInTheDocument()
    expect(content).toContainElement(screen.getByText('Hidden until expanded'))

    trigger.focus()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Hidden until expanded')).not.toBeInTheDocument()
  })
})
