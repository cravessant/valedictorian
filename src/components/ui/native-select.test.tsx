import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { NativeSelect, NativeSelectOption } from './native-select'

afterEach(cleanup)

describe('NativeSelect', () => {
  it('exposes its shadcn slot and accessible name as a focusable combobox', async () => {
    const user = userEvent.setup()
    render(
      <NativeSelect aria-label="Timezone" defaultValue="UTC">
        <NativeSelectOption value="UTC">UTC</NativeSelectOption>
        <NativeSelectOption value="US/Eastern">US/Eastern</NativeSelectOption>
      </NativeSelect>,
    )

    const select = screen.getByRole('combobox', { name: 'Timezone' })
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveAttribute('data-slot', 'native-select')
    expect(select).toHaveValue('UTC')
    expect(select).toHaveClass(
      'border-input',
      'bg-input/30',
      'focus-visible:ring-ring/50',
    )
    await user.tab()
    expect(select).toHaveFocus()
  })

  it('forwards controlled value changes through onChange', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('UTC')
      return (
        <NativeSelect
          aria-label="Timezone"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        >
          <NativeSelectOption value="UTC">UTC</NativeSelectOption>
          <NativeSelectOption value="US/Eastern">US/Eastern</NativeSelectOption>
        </NativeSelect>
      )
    }

    render(<Harness />)
    const select = screen.getByRole('combobox', { name: 'Timezone' })
    expect(select).toHaveValue('UTC')
    await user.selectOptions(select, 'US/Eastern')
    expect(select).toHaveValue('US/Eastern')
  })

  it('keeps disabled selects out of keyboard focus and blocks changes', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('manual')
      return (
        <>
          <NativeSelect
            aria-label="Schedule mode"
            disabled
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            <NativeSelectOption value="manual">Manual only</NativeSelectOption>
            <NativeSelectOption value="preset">Common preset</NativeSelectOption>
          </NativeSelect>
          <button type="button">Next action</button>
        </>
      )
    }

    render(<Harness />)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus()
    await user.selectOptions(screen.getByLabelText('Schedule mode'), 'preset')
    expect(screen.getByLabelText('Schedule mode')).toHaveValue('manual')
  })

  it('marks invalid selects with destructive border and ring classes', () => {
    render(
      <NativeSelect aria-invalid aria-label="Work mode" defaultValue="">
        <NativeSelectOption value="">Any mode</NativeSelectOption>
        <NativeSelectOption value="remote">Remote</NativeSelectOption>
      </NativeSelect>,
    )

    const select = screen.getByRole('combobox', { name: 'Work mode' })
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveClass(
      'aria-invalid:border-destructive',
      'aria-invalid:ring-destructive/20',
    )
  })

  it('preserves option identity for value and label', () => {
    render(
      <NativeSelect aria-label="Birth year" defaultValue="2004">
        <NativeSelectOption value="2004">2004</NativeSelectOption>
        <NativeSelectOption value="1999">1999</NativeSelectOption>
      </NativeSelect>,
    )

    const select = screen.getByRole('combobox', { name: 'Birth year' })
    const options = Array.from(select.querySelectorAll('option'))
    expect(options.map((option) => option.value)).toEqual(['2004', '1999'])
    expect(options.map((option) => option.textContent)).toEqual(['2004', '1999'])
    expect(options[0]).toHaveAttribute('data-slot', 'native-select-option')
  })

  it('merges compact layout classes without dropping the shared focus contract', () => {
    render(
      <NativeSelect
        aria-label="Education type"
        className="min-w-0 px-2"
        defaultValue="degree"
      >
        <NativeSelectOption value="degree">degree</NativeSelectOption>
      </NativeSelect>,
    )

    const select = screen.getByRole('combobox', { name: 'Education type' })
    expect(select).toHaveClass(
      'min-w-0',
      'px-2',
      'focus-visible:ring-[3px]',
      'disabled:pointer-events-none',
      'appearance-none',
    )
  })
})
