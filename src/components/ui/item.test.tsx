import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from './item'

afterEach(cleanup)

describe('Item', () => {
  it('exposes the root data-slot contract with default variant and size', () => {
    render(<Item>Workspace row</Item>)

    const item = screen.getByText('Workspace row')
    expect(item).toHaveAttribute('data-slot', 'item')
    expect(item).toHaveAttribute('data-variant', 'default')
    expect(item).toHaveAttribute('data-size', 'default')
  })

  it('applies outline and muted variants plus the sm size', () => {
    const { rerender } = render(
      <Item variant="outline" data-testid="item">
        Outline
      </Item>,
    )

    expect(screen.getByTestId('item')).toHaveAttribute('data-variant', 'outline')
    expect(screen.getByTestId('item')).toHaveClass('border-border')

    rerender(
      <Item variant="muted" size="sm" data-testid="item">
        Muted small
      </Item>,
    )

    expect(screen.getByTestId('item')).toHaveAttribute('data-variant', 'muted')
    expect(screen.getByTestId('item')).toHaveAttribute('data-size', 'sm')
    expect(screen.getByTestId('item')).toHaveClass('bg-muted/50', 'gap-2.5', 'px-4', 'py-3')
  })

  it('composes every exported slot with data-slot contracts', () => {
    render(
      <ItemGroup aria-label="Launcher choices">
        <Item size="sm" className="custom-item" data-testid="composed-item">
          <ItemHeader data-testid="item-header">Header</ItemHeader>
          <ItemMedia variant="icon" data-testid="item-media">
            *
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>
              <h2>Create workspace</h2>
            </ItemTitle>
            <ItemDescription className="text-xs">
              Create a new workspace under a folder.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <button type="button">Create</button>
          </ItemActions>
          <ItemFooter data-testid="item-footer">Footer</ItemFooter>
        </Item>
        <ItemSeparator data-testid="item-separator" />
        <Item size="sm">
          <ItemContent>
            <ItemTitle>Open folder as workspace</ItemTitle>
            <ItemDescription>Open an existing workspace folder.</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>,
    )

    const group = screen.getByRole('list', { name: 'Launcher choices' })
    expect(group).toHaveAttribute('data-slot', 'item-group')

    const item = screen.getByTestId('composed-item')
    expect(item).toHaveAttribute('data-slot', 'item')
    expect(item).toHaveClass('custom-item')

    expect(screen.getByTestId('item-header')).toHaveAttribute('data-slot', 'item-header')
    expect(screen.getByTestId('item-media')).toHaveAttribute('data-slot', 'item-media')
    expect(screen.getByTestId('item-media')).toHaveAttribute('data-variant', 'icon')

    const content = item.querySelector('[data-slot="item-content"]')
    expect(content).not.toBeNull()
    expect(content).toHaveClass('min-w-0')

    const title = within(item).getByRole('heading', { level: 2, name: 'Create workspace' })
    expect(title.closest('[data-slot="item-title"]')).not.toBeNull()

    const description = within(item).getByText('Create a new workspace under a folder.')
    expect(description).toHaveAttribute('data-slot', 'item-description')
    expect(description).toHaveClass('text-xs')

    const actions = item.querySelector('[data-slot="item-actions"]')
    expect(actions).not.toBeNull()
    expect(within(actions as HTMLElement).getByRole('button', { name: 'Create' })).toBeInTheDocument()

    expect(screen.getByTestId('item-footer')).toHaveAttribute('data-slot', 'item-footer')

    const separator = screen.getByTestId('item-separator')
    expect(separator).toHaveAttribute('data-slot', 'item-separator')
    expect(separator).toHaveAttribute('data-orientation', 'horizontal')
    expect(separator).toHaveClass('my-0', 'bg-border')
  })

  it('forwards asChild onto the caller element while keeping item contracts', () => {
    render(
      <Item asChild size="sm" variant="outline" className="as-child-item">
        <a href="#workspace">Open workspace link</a>
      </Item>,
    )

    const link = screen.getByRole('link', { name: 'Open workspace link' })
    expect(link).toHaveAttribute('data-slot', 'item')
    expect(link).toHaveAttribute('data-variant', 'outline')
    expect(link).toHaveAttribute('data-size', 'sm')
    expect(link).toHaveClass('as-child-item', 'border-border', 'gap-2.5')
    expect(link.tagName).toBe('A')
  })
})
