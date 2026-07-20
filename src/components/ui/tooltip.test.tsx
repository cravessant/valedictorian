import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Button } from './button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip'

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Tooltip', () => {
  it('keeps the trigger accessible name and opens on focus with a zero-delay provider', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" aria-label="Collapse sidebar" size="icon">
              Toggle
            </Button>
          </TooltipTrigger>
          <TooltipContent>Collapse sidebar</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    trigger.focus()
    expect(trigger).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Collapse sidebar')
  })

  it('opens on hover and dismisses with Escape while keeping the trigger name', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" aria-label="Close settings" size="icon">
              Close
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close settings</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Close settings' })
    await user.hover(trigger)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Close settings')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeInTheDocument()
  })
})
