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
  it('exposes a named root group with an accessible control', () => {
    render(
      <InputGroup aria-label="Workspace search group">
        <InputGroupInput aria-label="Workspace search" defaultValue="policy" />
        <InputGroupAddon>
          <InputGroupText>Prefix</InputGroupText>
        </InputGroupAddon>
      </InputGroup>,
    )

    expect(screen.getByRole('group', { name: 'Workspace search group' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Workspace search' })).toHaveValue('policy')
    expect(screen.getByText('Prefix')).toBeInTheDocument()
  })

  it('focuses its control when the addon is clicked, but not when an addon button is activated', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()

    render(
      <InputGroup aria-label="Company group">
        <InputGroupInput aria-label="Company" defaultValue="Acme" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="Copy company" onClick={onAction}>
            Copy
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    )

    const input = screen.getByRole('textbox', { name: 'Company' })
    const button = screen.getByRole('button', { name: 'Copy company' })
    const addon = button.parentElement
    expect(addon).toBeTruthy()

    await user.click(addon!)
    expect(input).toHaveFocus()

    input.blur()
    expect(input).not.toHaveFocus()

    await user.click(button)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(input).not.toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onAction).toHaveBeenCalledTimes(2)
    expect(input).not.toHaveFocus()
  })

  it('composes InputGroupTextarea with a block-end addon that focuses the textarea', async () => {
    const user = userEvent.setup()

    render(
      <InputGroup aria-label="Notes group">
        <InputGroupTextarea aria-label="Notes" defaultValue="hello" />
        <InputGroupAddon align="block-end">
          <InputGroupText>Footer</InputGroupText>
        </InputGroupAddon>
      </InputGroup>,
    )

    const textarea = screen.getByRole('textbox', { name: 'Notes' })
    expect(textarea.tagName).toBe('TEXTAREA')

    await user.click(screen.getByText('Footer'))
    expect(textarea).toHaveFocus()
  })
})
