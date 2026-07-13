import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Input } from './input'

afterEach(cleanup)

describe('Input', () => {
  it('exposes its shadcn slot and accessible name as a focusable textbox', async () => {
    const user = userEvent.setup()
    render(<Input aria-label="Workspace name" defaultValue="Primary" />)

    const input = screen.getByRole('textbox', { name: 'Workspace name' })
    expect(input).toHaveAttribute('data-slot', 'input')
    expect(input).toHaveValue('Primary')
    expect(input).toHaveClass('border-input', 'bg-input/30', 'focus-visible:ring-ring/50')
    await user.tab()
    expect(input).toHaveFocus()
  })

  it('forwards controlled value changes through onChange', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('')
      return (
        <Input
          aria-label="Company"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      )
    }

    render(<Harness />)
    await user.type(screen.getByRole('textbox', { name: 'Company' }), 'Acme')
    expect(screen.getByRole('textbox', { name: 'Company' })).toHaveValue('Acme')
  })

  it('keeps disabled inputs out of keyboard focus and blocks editing', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('locked')
      return (
        <>
          <Input
            aria-label="Remote API URL"
            disabled
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="button">Next action</button>
        </>
      )
    }

    render(<Harness />)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus()
    await user.click(screen.getByLabelText('Remote API URL'))
    await user.keyboard('x')
    expect(screen.getByLabelText('Remote API URL')).toHaveValue('locked')
  })

  it('keeps read-only values visible while blocking edits', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('read-only-value')
      return (
        <Input
          aria-label="Workspace path"
          readOnly
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      )
    }

    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Workspace path' })
    expect(input).toHaveAttribute('readonly')
    await user.click(input)
    expect(input).toHaveFocus()
    await user.keyboard('x')
    expect(input).toHaveValue('read-only-value')
  })

  it('marks invalid inputs with destructive border and ring classes', () => {
    render(<Input aria-invalid aria-label="Email" defaultValue="not-an-email" />)

    const input = screen.getByRole('textbox', { name: 'Email' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveClass(
      'aria-invalid:border-destructive',
      'aria-invalid:ring-destructive/20',
    )
  })

  it('preserves native input types used by app workflows', () => {
    const { rerender } = render(
      <Input aria-label="Posted after" type="date" defaultValue="2026-07-13" />,
    )
    expect(screen.getByLabelText('Posted after')).toHaveAttribute('type', 'date')

    rerender(<Input aria-label="Min score" type="number" defaultValue="7" />)
    expect(screen.getByLabelText('Min score')).toHaveAttribute('type', 'number')

    rerender(<Input aria-label="Jobright password" type="password" defaultValue="secret" />)
    expect(screen.getByLabelText('Jobright password')).toHaveAttribute('type', 'password')

    rerender(<Input aria-label="Jobright email" type="email" defaultValue="a@b.co" />)
    expect(screen.getByRole('textbox', { name: 'Jobright email' })).toHaveAttribute('type', 'email')
  })

  it('merges layout classes without dropping the shared focus contract', () => {
    render(
      <Input
        aria-label="Search settings"
        className="mt-1 px-9 read-only:text-muted-foreground"
        readOnly
        defaultValue="policy"
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Search settings' })
    expect(input).toHaveClass(
      'mt-1',
      'px-9',
      'read-only:text-muted-foreground',
      'focus-visible:ring-[3px]',
      'disabled:opacity-50',
    )
  })
})
