import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Textarea } from './textarea'

afterEach(cleanup)

describe('Textarea', () => {
  it('exposes its shadcn slot and accessible name as a focusable textbox', async () => {
    const user = userEvent.setup()
    render(<Textarea aria-label="Disposition notes" defaultValue="Needs review" />)

    const textarea = screen.getByRole('textbox', { name: 'Disposition notes' })
    expect(textarea).toHaveAttribute('data-slot', 'textarea')
    expect(textarea).toHaveValue('Needs review')
    expect(textarea).toHaveClass(
      'border-input',
      'bg-input/30',
      'min-h-16',
      'focus-visible:ring-ring/50',
    )
    await user.tab()
    expect(textarea).toHaveFocus()
  })

  it('forwards controlled value changes through onChange', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('')
      return (
        <Textarea
          aria-label="Fit notes"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      )
    }

    render(<Harness />)
    await user.type(screen.getByRole('textbox', { name: 'Fit notes' }), 'Strong fit')
    expect(screen.getByRole('textbox', { name: 'Fit notes' })).toHaveValue('Strong fit')
  })

  it('keeps disabled textareas out of keyboard focus and blocks editing', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('locked notes')
      return (
        <>
          <Textarea
            aria-label="Application note"
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
    await user.click(screen.getByLabelText('Application note'))
    await user.keyboard('x')
    expect(screen.getByLabelText('Application note')).toHaveValue('locked notes')
  })

  it('marks invalid textareas with destructive border and ring classes', () => {
    render(<Textarea aria-invalid aria-label="Terms JSON" defaultValue="{bad" />)

    const textarea = screen.getByRole('textbox', { name: 'Terms JSON' })
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea).toHaveClass(
      'aria-invalid:border-destructive',
      'aria-invalid:ring-destructive/20',
    )
  })

  it('merges layout classes without dropping the shared focus contract', () => {
    render(
      <Textarea
        aria-label="Policy list"
        className="min-h-24 resize-y leading-5"
        defaultValue="Acme\nBeta"
      />,
    )

    const textarea = screen.getByRole('textbox', { name: 'Policy list' })
    expect(textarea).toHaveClass(
      'min-h-24',
      'resize-y',
      'leading-5',
      'focus-visible:ring-[3px]',
      'disabled:opacity-50',
    )
  })
})
