// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FormModal, type FormModalProps, type FieldSpec } from './form-modal'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
Element.prototype.scrollIntoView = vi.fn()

afterEach(cleanup)

interface FormShape {
  readonly name: string
  readonly count: string
}

const fields: ReadonlyArray<FieldSpec<FormShape>> = [
  { key: 'name', label: 'Name', inputType: 'text', placeholder: 'Acme' },
  { key: 'count', label: 'Count', inputType: 'text', placeholder: '0' },
]

function makeProps(overrides: Partial<FormModalProps<FormShape>> = {}): FormModalProps<FormShape> {
  return {
    open: true,
    title: 'Edit row',
    description: 'Update the row fields.',
    fields,
    value: { name: '', count: '' },
    onChange: vi.fn(),
    onSubmit: vi.fn(async () => {}),
    onCancel: vi.fn(),
    pending: false,
    ...overrides,
  }
}

describe('FormModal', () => {
  it('renders a labeled dialog with each field labelled', () => {
    render(<FormModal {...makeProps()} />)
    expect(screen.getByRole('dialog', { name: 'Edit row' })).toHaveAccessibleDescription('Update the row fields.')
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Count' })).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    render(<FormModal {...makeProps({ open: false })} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('fires onSubmit only when validation passes and reports field errors otherwise', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(<FormModal {...makeProps({
      onSubmit,
      validate: (v) => v.name.trim() === '' ? { fieldErrors: { name: 'Name is required.' } } : null,
    })} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.')

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Acme')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Acme', count: '' })
  })

  it('preserves the draft across a failed submission', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => { throw new Error('boom') })
    render(<FormModal {...makeProps({ onSubmit })} />)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Acme')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Acme')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows an unsaved-change confirm dialog on cancel after edits, and restores focus on discard', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<FormModal {...makeProps({ onCancel })} />)
    const nameField = screen.getByRole('textbox', { name: 'Name' })
    nameField.focus()
    await user.type(nameField, 'Acme')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('alertdialog', { name: /discard/i })).toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('retains dirty state when the parent controls the updated value', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    function ControlledForm() {
      const [value, setValue] = useState<FormShape>({ name: '', count: '' })
      return <FormModal {...makeProps({ value, onChange: setValue, onCancel })} />
    }
    render(<ControlledForm />)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Acme')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByRole('alertdialog', { name: /discard/i })).toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('closes via the unsaved discard path using ESC after confirming', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<FormModal {...makeProps({ onCancel })} />)
    await user.type(screen.getByRole('textbox', { name: 'Count' }), '5')
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('alertdialog', { name: /discard/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('announces pending state and disables submit while a submission is in flight', () => {
    const onCancel = vi.fn()
    render(<FormModal {...makeProps({ pending: true, onCancel })} />)
    const save = screen.getByRole('button', { name: /Save/i })
    expect(save).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/saving/i)
    screen.getAllByRole('button', { name: 'Close' })[0]?.click()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('restores opener focus after close', async () => {
    const user = userEvent.setup()
    const opener = document.createElement('button')
    opener.textContent = 'Opener'
    document.body.appendChild(opener)
    opener.focus()

    const { rerender } = render(<FormModal {...makeProps()} />)
    await act(async () => { await user.click(screen.getByRole('button', { name: 'Cancel' })) })
    rerender(<FormModal {...makeProps({ open: false })} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('uses a scrollable region for tall forms', () => {
    render(<FormModal {...makeProps()} />)
    const region = screen.getByRole('region', { name: /form fields/i })
    expect(region).toBeInTheDocument()
  })
})
