import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplicationEditorModal } from './ApplicationEditorModal'

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ApplicationEditorModal', () => {
  it('portals the add-application dialog and keeps pending save disabled until completion', async () => {
    let resolveCreate: ((value: unknown) => void) | undefined
    const onCreate = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    const onClose = vi.fn()
    const onSaved = vi.fn(async () => undefined)

    render(
      <div data-testid="editor-host">
        <ApplicationEditorModal
          mode="add"
          onClose={onClose}
          onCreate={onCreate as never}
          onSaved={onSaved}
        />
      </div>,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Add application' })
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content')
    expect(document.body.contains(dialog)).toBe(true)
    expect(document.querySelector('[data-testid="editor-host"]')?.contains(dialog)).toBe(false)

    fireEvent.change(within(dialog).getByLabelText('Company'), {
      target: { value: 'Delta Labs' },
    })
    fireEvent.change(within(dialog).getByLabelText('Role'), {
      target: { value: 'Software Engineering Intern' },
    })
    fireEvent.change(within(dialog).getByLabelText('Source'), {
      target: { value: 'LinkedIn' },
    })
    fireEvent.change(within(dialog).getByLabelText('Country'), {
      target: { value: 'US' },
    })
    fireEvent.change(within(dialog).getByLabelText('Primary URL'), {
      target: { value: 'https://jobs.example.com/delta' },
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save application' }))

    expect(within(dialog).getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(onCreate).toHaveBeenCalled()

    resolveCreate?.({
      id: 'application-2',
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
    })

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })
})
