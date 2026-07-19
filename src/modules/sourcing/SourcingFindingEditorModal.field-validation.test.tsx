import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourcingFindingEditorModal } from './SourcingFindingEditorModal'
import { fieldControlId } from '@/lib/field-control-id'

afterEach(cleanup)

describe('SourcingFindingEditorModal field validation', () => {
  it('keeps priority score errors field-local with focus and accessible relationships', async () => {
    const onCreate = vi.fn()
    render(
      <SourcingFindingEditorModal
        mode="add"
        onClose={() => undefined}
        onCreate={onCreate}
      />,
    )

    fireEvent.change(screen.getByLabelText('Priority score'), {
      target: { value: 'not-a-number' },
    })
    fireEvent.change(screen.getByLabelText('Company'), {
      target: { value: 'Acme' },
    })
    fireEvent.change(screen.getByLabelText('Role'), {
      target: { value: 'Intern' },
    })
    fireEvent.change(screen.getByLabelText('Workflow run'), {
      target: { value: 'run-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save opportunity' }))

    const control = screen.getByLabelText('Priority score')
    const errorId = `${fieldControlId('sourcing-finding', 'Priority score')}-error`
    const fieldError = await screen.findByText('Priority score must be a number.')
    expect(fieldError).toHaveAttribute('data-slot', 'field-error')
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAttribute('aria-describedby', errorId)
    expect(screen.queryByText('Could not save')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="form-failure"]')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(control))
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Priority score')).toHaveValue('not-a-number')
  })

  it('keeps Terms JSON client validation field-local with focus and accessible relationships', async () => {
    const onCreate = vi.fn()
    render(
      <SourcingFindingEditorModal
        mode="add"
        onClose={() => undefined}
        onCreate={onCreate}
      />,
    )

    fireEvent.change(screen.getByLabelText('Timing mode'), { target: { value: 'terms' } })
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Intern' } })
    fireEvent.change(screen.getByLabelText('Workflow run'), { target: { value: 'run-1' } })
    fireEvent.change(screen.getByLabelText('Terms JSON'), {
      target: { value: '{"not":"an-array"}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save opportunity' }))

    const control = await screen.findByLabelText('Terms JSON')
    const errorId = `${fieldControlId('sourcing-finding', 'Terms JSON')}-error`
    const fieldError = await screen.findByText('Terms JSON must be an array.')
    expect(fieldError).toHaveAttribute('data-slot', 'field-error')
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAttribute('aria-describedby', errorId)
    expect(screen.queryByText('Could not save')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="form-failure"]')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(control))
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Terms JSON')).toHaveValue('{"not":"an-array"}')
  })
})
