import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './empty'

afterEach(cleanup)

describe('Empty', () => {
  it('composes every exported slot with semantic title, paragraph description, and public data slots', () => {
    render(
      <Empty aria-label="Empty action queue" className="gap-4 border-solid p-6" data-testid="empty-root">
        <EmptyHeader className="gap-3">
          <EmptyMedia variant="icon" data-testid="empty-media-icon">
            <span aria-hidden="true">*</span>
          </EmptyMedia>
          <EmptyTitle>
            <h2>No action queue items</h2>
          </EmptyTitle>
          <EmptyDescription className="text-xs">
            No items match the current bucket.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent data-testid="empty-content">
          <button type="button">Retry</button>
        </EmptyContent>
      </Empty>,
    )

    const root = screen.getByLabelText('Empty action queue')
    expect(root).toHaveAttribute('data-slot', 'empty')
    expect(root).toHaveAttribute('data-testid', 'empty-root')
    expect(root).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center', 'gap-4', 'border-solid', 'p-6')

    const header = root.querySelector('[data-slot="empty-header"]')
    expect(header).not.toBeNull()
    expect(header).toHaveClass('gap-3')

    const media = screen.getByTestId('empty-media-icon')
    expect(media).toHaveAttribute('data-slot', 'empty-icon')
    expect(media).toHaveAttribute('data-variant', 'icon')
    expect(media).toHaveClass('rounded-lg', 'bg-muted')

    const title = within(root).getByRole('heading', { level: 2, name: 'No action queue items' })
    expect(title.closest('[data-slot="empty-title"]')).not.toBeNull()

    const description = within(root).getByText('No items match the current bucket.')
    expect(description.tagName).toBe('P')
    expect(description).toHaveAttribute('data-slot', 'empty-description')
    expect(description).toHaveClass('text-muted-foreground', 'text-xs')

    const content = screen.getByTestId('empty-content')
    expect(content).toHaveAttribute('data-slot', 'empty-content')
    expect(within(content).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('keeps the default EmptyMedia variant and forwards HTML attributes', () => {
    render(
      <EmptyMedia data-testid="empty-media-default" id="media-default" title="Decorative media">
        Icon
      </EmptyMedia>,
    )

    const media = screen.getByTestId('empty-media-default')
    expect(media).toHaveAttribute('data-slot', 'empty-icon')
    expect(media).toHaveAttribute('data-variant', 'default')
    expect(media).toHaveAttribute('id', 'media-default')
    expect(media).toHaveAttribute('title', 'Decorative media')
    expect(media).toHaveClass('bg-transparent')
  })

  it('constrains EmptyHeader to the parent width so title and description can wrap in narrow containers', () => {
    render(
      <Empty aria-label="Narrow empty panel">
        <EmptyHeader>
          <EmptyTitle>
            <h2>No action queue items</h2>
          </EmptyTitle>
          <EmptyDescription>No items match the current bucket.</EmptyDescription>
        </EmptyHeader>
      </Empty>,
    )

    const header = screen.getByLabelText('Narrow empty panel').querySelector('[data-slot="empty-header"]')
    expect(header).not.toBeNull()
    expect(header).toHaveClass('w-full', 'min-w-0', 'max-w-sm')
  })
})
