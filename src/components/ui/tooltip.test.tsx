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

  it('exposes provider/trigger/content data slots with class and prop forwarding', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger data-testid="tooltip-trigger">Help</TooltipTrigger>
          <TooltipContent
            className="max-w-xs"
            data-testid="tooltip-content"
            id="help-tip"
          >
            Help tip
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    const trigger = screen.getByTestId('tooltip-trigger')
    expect(trigger).toHaveAttribute('data-slot', 'tooltip-trigger')
    trigger.focus()

    const content = await screen.findByTestId('tooltip-content')
    expect(content).toHaveAttribute('data-slot', 'tooltip-content')
    expect(content).toHaveAttribute('id', 'help-tip')
    expect(content).toHaveClass(
      'bg-foreground',
      'text-background',
      'animate-in',
      'motion-reduce:animate-none',
      'motion-reduce:transition-none',
      'max-w-xs',
    )
    expect(content.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Help tip')
  })
})
