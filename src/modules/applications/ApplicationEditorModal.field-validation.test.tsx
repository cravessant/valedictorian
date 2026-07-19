import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationEditorModal } from './ApplicationEditorModal'
import { fieldControlId } from '@/lib/field-control-id'
import { createApplicationDetail } from '../../App.test-helpers'

afterEach(cleanup)

describe('ApplicationEditorModal field validation', () => {
  it('keeps Terms JSON client validation field-local with focus', async () => {
    const onCreate = vi.fn()
    render(
      <ApplicationEditorModal
        mode="add"
        onAppendNote={async () => createApplicationDetail()}
        onClose={() => undefined}
        onCreate={onCreate}
        onSaved={() => undefined}
        onUpdate={async () => createApplicationDetail()}
        onUpdateStatus={async () => createApplicationDetail()}
        onUpdateWorkflow={async () => createApplicationDetail()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Timing mode'), { target: { value: 'terms' } })
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Intern' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Manual' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/i }))

    const control = await screen.findByLabelText('Terms JSON')
    const errorId = `${fieldControlId('application-editor', 'Terms JSON')}-error`
    const fieldError = await screen.findByText('Terms JSON is required for term timing.')
    expect(fieldError).toHaveAttribute('data-slot', 'field-error')
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAttribute('aria-describedby', errorId)
    expect(screen.queryByText('Could not save')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="form-failure"]')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(control))
    expect(onCreate).not.toHaveBeenCalled()
  })
})
