import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)
Element.prototype.scrollIntoView = vi.fn()

afterEach(cleanup)

describe('Command', () => {
  it('exposes its shadcn slots and searchable list with an accessible name', async () => {
    const user = userEvent.setup()
    render(
      <Command aria-label="Timezone picker" className="rounded-md border">
        <CommandInput placeholder="Search timezone..." />
        <CommandList>
          <CommandEmpty>No timezone found.</CommandEmpty>
          <CommandGroup heading="Timezones">
            <CommandItem value="UTC">UTC</CommandItem>
            <CommandItem value="America/New_York">America/New_York</CommandItem>
            <CommandItem value="US/Eastern">US/Eastern</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )

    const root = screen.getByLabelText('Timezone picker')
    expect(root).toHaveAttribute('data-slot', 'command')
    expect(screen.getByRole('combobox')).toHaveAttribute('data-slot', 'command-input')
    expect(screen.getByRole('listbox')).toHaveAttribute('data-slot', 'command-list')
    expect(screen.getByRole('option', { name: 'UTC' })).toHaveAttribute(
      'data-slot',
      'command-item',
    )

    await user.type(screen.getByPlaceholderText('Search timezone...'), 'Eastern')
    expect(screen.getByRole('option', { name: 'US/Eastern' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'UTC' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'America/New_York' })).not.toBeInTheDocument()
  })

  it('shows an empty state when filtering matches nothing', async () => {
    const user = userEvent.setup()
    render(
      <Command aria-label="Timezone picker">
        <CommandInput placeholder="Search timezone..." />
        <CommandList>
          <CommandEmpty>No timezone found.</CommandEmpty>
          <CommandGroup>
            <CommandItem value="UTC">UTC</CommandItem>
            <CommandItem value="US/Eastern">US/Eastern</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )

    await user.type(screen.getByPlaceholderText('Search timezone...'), 'zzz')
    expect(screen.getByText('No timezone found.')).toBeInTheDocument()
    expect(screen.getByText('No timezone found.').closest('[data-slot="command-empty"]')).not.toBeNull()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('selects the highlighted option with ArrowDown and Enter', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <Command aria-label="Timezone picker">
        <CommandInput placeholder="Search timezone..." />
        <CommandList>
          <CommandEmpty>No timezone found.</CommandEmpty>
          <CommandGroup>
            <CommandItem value="UTC" onSelect={onSelect}>UTC</CommandItem>
            <CommandItem value="US/Eastern" onSelect={onSelect}>US/Eastern</CommandItem>
            <CommandItem value="Europe/London" onSelect={onSelect}>Europe/London</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )

    const input = screen.getByPlaceholderText('Search timezone...')
    input.focus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('US/Eastern')
  })

  it('keeps disabled items out of pointer selection', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <Command aria-label="Timezone picker">
        <CommandInput placeholder="Search timezone..." />
        <CommandList>
          <CommandGroup>
            <CommandItem disabled value="UTC" onSelect={onSelect}>UTC</CommandItem>
            <CommandItem value="US/Eastern" onSelect={onSelect}>US/Eastern</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )

    const disabled = screen.getByRole('option', { name: 'UTC' })
    expect(disabled).toHaveAttribute('data-disabled', 'true')
    expect(disabled).toHaveAttribute('aria-disabled', 'true')
    await user.click(disabled)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
