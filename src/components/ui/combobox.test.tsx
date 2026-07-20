import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Combobox } from './combobox'
import { Field, FieldLabel } from './field'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)
Element.prototype.scrollIntoView = vi.fn()

afterEach(cleanup)

const timezoneOptions = [
  { label: 'UTC', value: 'UTC' },
  { label: 'America/New_York', value: 'America/New_York' },
  { label: 'US/Eastern', value: 'US/Eastern' },
]

describe('Combobox', () => {
  it('exposes an accessible combobox name and opens a searchable list', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('UTC')
      return (
        <Field>
          <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
          <Combobox
            id="timezone"
            options={timezoneOptions}
            value={value}
            onValueChange={setValue}
          />
        </Field>
      )
    }

    render(<Harness />)

    const trigger = screen.getByRole('combobox', { name: 'Timezone' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('UTC')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'US/Eastern' })).toBeInTheDocument()
  })

  it('filters options and selects by click while preserving value identity', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('')
      return (
        <Combobox
          aria-label="Timezone"
          emptyText="No timezone found."
          options={timezoneOptions}
          placeholder="Select timezone"
          searchPlaceholder="Search timezone..."
          value={value}
          onValueChange={setValue}
        />
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('combobox', { name: 'Timezone' })
    expect(trigger).toHaveTextContent('Select timezone')

    await user.click(trigger)
    await user.type(screen.getByPlaceholderText('Search timezone...'), 'Eastern')
    expect(screen.getByRole('option', { name: 'US/Eastern' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'UTC' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'US/Eastern' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('US/Eastern')
  })

  it('selects with ArrowDown and Enter from the open list', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('UTC')
      return (
        <Combobox
          aria-label="Timezone"
          options={timezoneOptions}
          value={value}
          onValueChange={setValue}
        />
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('combobox', { name: 'Timezone' })
    await user.click(trigger)
    const input = screen.getByPlaceholderText('Search...')
    input.focus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(trigger).toHaveTextContent('America/New_York')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows an empty state when search matches nothing', async () => {
    const user = userEvent.setup()
    render(
      <Combobox
        aria-label="Timezone"
        emptyText="No timezone found."
        options={timezoneOptions}
        value="UTC"
        onValueChange={() => {}}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Timezone' }))
    await user.type(screen.getByPlaceholderText('Search...'), 'zzz')
    expect(screen.getByText('No timezone found.')).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('marks invalid and disabled triggers and blocks opening when disabled', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Combobox
          aria-invalid
          aria-label="Birth year"
          disabled
          options={[{ label: '2004', value: '2004' }]}
          value="2004"
          onValueChange={() => {}}
        />
        <button type="button">Next action</button>
      </>,
    )

    const trigger = screen.getByRole('combobox', { name: 'Birth year' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('aria-invalid', 'true')

    await user.tab()
    expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus()
    await user.click(trigger)
    expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument()
  })

  it('returns focus to the trigger after selecting an option', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState('')
      return (
        <Combobox
          aria-label="Source"
          options={[
            { label: 'Any source', value: '' },
            { label: 'LinkedIn', value: 'source-linkedin' },
          ]}
          placeholder="Any source"
          value={value}
          onValueChange={setValue}
        />
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('combobox', { name: 'Source' })
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'LinkedIn' }))
    expect(trigger).toHaveTextContent('LinkedIn')
    expect(trigger).toHaveFocus()
  })
})
