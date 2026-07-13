import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card'

afterEach(cleanup)

describe('Card', () => {
  it('composes every exported slot with data-slot contracts and caller-owned semantics', () => {
    render(
      <Card aria-label="Connector run summary" className="gap-3 rounded-md p-4 shadow-none">
        <CardHeader className="px-0">
          <CardTitle>
            <h3>Jobright public jobs</h3>
          </CardTitle>
          <CardDescription className="text-xs">
            manual · 2026-07-09T16:00:00.000Z
          </CardDescription>
          <CardAction>
            <span data-testid="status-action">failed</span>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2 px-0">
          <p>Detail attempts: 3</p>
        </CardContent>
        <CardFooter className="px-0" data-testid="card-footer">
          Optional footer
        </CardFooter>
      </Card>,
    )

    const card = screen.getByLabelText('Connector run summary')
    expect(card).toHaveAttribute('data-slot', 'card')
    expect(card).toHaveClass('flex', 'flex-col', 'border', 'bg-card', 'text-card-foreground')
    expect(card).toHaveClass('gap-3', 'rounded-md', 'p-4', 'shadow-none')

    const header = card.querySelector('[data-slot="card-header"]')
    expect(header).not.toBeNull()
    expect(header).toHaveClass('px-0')
    expect(header).toHaveClass(
      'has-data-[slot=card-action]:grid-cols-[1fr_auto]',
    )

    const title = within(card).getByRole('heading', { level: 3, name: 'Jobright public jobs' })
    expect(title.closest('[data-slot="card-title"]')).not.toBeNull()

    const description = within(card).getByText('manual · 2026-07-09T16:00:00.000Z')
    expect(description).toHaveAttribute('data-slot', 'card-description')
    expect(description).toHaveClass('text-muted-foreground', 'text-xs')

    const action = card.querySelector('[data-slot="card-action"]')
    expect(action).not.toBeNull()
    expect(within(action as HTMLElement).getByTestId('status-action')).toHaveTextContent('failed')

    const content = card.querySelector('[data-slot="card-content"]')
    expect(content).not.toBeNull()
    expect(content).toHaveClass('px-0', 'space-y-2')
    expect(within(content as HTMLElement).getByText('Detail attempts: 3')).toBeInTheDocument()

    const footer = screen.getByTestId('card-footer')
    expect(footer).toHaveAttribute('data-slot', 'card-footer')
    expect(footer).toHaveClass('flex', 'items-center', 'px-0')
    expect(footer).toHaveTextContent('Optional footer')
  })
})
