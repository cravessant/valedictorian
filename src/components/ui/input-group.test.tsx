import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from './input-group'

afterEach(cleanup)

describe('InputGroup', () => {
  it('exposes root, input, addon, and text slot/role/class contracts', () => {
    render(
      <InputGroup>
        <InputGroupInput aria-label="Workspace search" defaultValue="policy" />
        <InputGroupAddon>
          <InputGroupText>Prefix</InputGroupText>
        </InputGroupAddon>
      </InputGroup>,
    )

    const root = document.querySelector('[data-slot="input-group"]')
    expect(root).toBeTruthy()
    expect(root).toHaveAttribute('role', 'group')
    expect(root).toHaveClass(
      'group/input-group',
      'border-input',
      'bg-input/30',
      'h-9',
      'has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50',
    )

    const input = screen.getByRole('textbox', { name: 'Workspace search' })
    expect(input).toHaveAttribute('data-slot', 'input-group-control')
    expect(input).toHaveClass('flex-1', 'border-0', 'bg-transparent', 'focus-visible:ring-0')

    const addon = document.querySelector('[data-slot="input-group-addon"]')
    expect(addon).toBeTruthy()
    expect(addon).toHaveAttribute('role', 'group')
    expect(addon).toHaveAttribute('data-align', 'inline-start')
    expect(addon).toHaveClass('order-first', 'pl-3')

    expect(screen.getByText('Prefix')).toHaveClass('text-muted-foreground')
  })

  it('focuses its control when the addon is clicked, but not when an addon button is activated', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()

    render(
      <InputGroup>
        <InputGroupInput aria-label="Company" defaultValue="Acme" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="Copy company" onClick={onAction}>
            Copy
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    )

    const input = screen.getByRole('textbox', { name: 'Company' })
    const addon = document.querySelector('[data-slot="input-group-addon"]')
    expect(addon).toBeTruthy()

    await user.click(addon!)
    expect(input).toHaveFocus()

    input.blur()
    expect(input).not.toHaveFocus()

    const button = screen.getByRole('button', { name: 'Copy company' })
    await user.click(button)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(input).not.toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onAction).toHaveBeenCalledTimes(2)
    expect(input).not.toHaveFocus()
  })

  it('keeps disabled controls out of keyboard focus and dims disabled groups', async () => {
    const user = userEvent.setup()

    render(
      <>
        <InputGroup data-disabled="true">
          <InputGroupInput aria-label="Locked search" disabled defaultValue="locked" />
          <InputGroupAddon>
            <InputGroupText>Search</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <button type="button">Next action</button>
      </>,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus()

    const root = document.querySelector('[data-slot="input-group"]')
    expect(root).toHaveAttribute('data-disabled', 'true')
    expect(screen.getByLabelText('Locked search')).toBeDisabled()
    expect(document.querySelector('[data-slot="input-group-addon"]')).toHaveClass(
      'group-data-[disabled=true]/input-group:opacity-50',
    )
  })

  it('propagates child aria-invalid into the parent error-state class contract', () => {
    render(
      <InputGroup>
        <InputGroupInput aria-invalid aria-label="Email" defaultValue="bad" />
        <InputGroupAddon>
          <InputGroupText>@</InputGroupText>
        </InputGroupAddon>
      </InputGroup>,
    )

    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true')
    expect(document.querySelector('[data-slot="input-group"]')).toHaveClass(
      'has-[[data-slot][aria-invalid=true]]:border-destructive',
      'has-[[data-slot][aria-invalid=true]]:ring-destructive/20',
    )
  })

  it('composes InputGroupTextarea with a block-end addon that focuses the textarea', async () => {
    const user = userEvent.setup()

    render(
      <InputGroup>
        <InputGroupTextarea aria-label="Notes" defaultValue="hello" />
        <InputGroupAddon align="block-end">
          <InputGroupText>Footer</InputGroupText>
        </InputGroupAddon>
      </InputGroup>,
    )

    const textarea = screen.getByRole('textbox', { name: 'Notes' })
    expect(textarea).toHaveAttribute('data-slot', 'input-group-control')
    expect(textarea.tagName).toBe('TEXTAREA')
    expect(textarea).toHaveClass('resize-none', 'bg-transparent')

    const addon = document.querySelector('[data-slot="input-group-addon"]')
    expect(addon).toHaveAttribute('data-align', 'block-end')
    expect(addon).toHaveClass('order-last', 'w-full')

    await user.click(addon!)
    expect(textarea).toHaveFocus()
  })

  it('merges caller classes on the root and control without dropping shared contracts', () => {
    render(
      <InputGroup className="max-w-sm">
        <InputGroupInput
          aria-label="Search settings"
          className="placeholder:italic"
          defaultValue="policy"
        />
        <InputGroupAddon className="text-foreground" align="inline-start">
          <InputGroupText className="font-semibold">Go</InputGroupText>
        </InputGroupAddon>
      </InputGroup>,
    )

    expect(document.querySelector('[data-slot="input-group"]')).toHaveClass(
      'max-w-sm',
      'bg-input/30',
      'has-[[data-slot=input-group-control]:focus-visible]:ring-[3px]',
    )
    expect(screen.getByRole('textbox', { name: 'Search settings' })).toHaveClass(
      'placeholder:italic',
      'flex-1',
      'focus-visible:ring-0',
    )
    expect(document.querySelector('[data-slot="input-group-addon"]')).toHaveClass(
      'text-foreground',
      'order-first',
    )
    expect(screen.getByText('Go')).toHaveClass('font-semibold', 'text-muted-foreground')
  })
})
