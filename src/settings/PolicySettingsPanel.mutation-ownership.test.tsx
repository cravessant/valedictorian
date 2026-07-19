import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDestructiveToastDedupe } from '@/components/ui/use-toast'
import { PolicySettingsPanel } from './PolicySettingsPanel'
import { createPolicyApi } from '../App.test-helpers'
import type { PolicyConfig } from 'sparxie'

const sonnerToast = vi.hoisted(() => {
  let nextId = 0
  const toastFn = vi.fn(() => `toast-default-${nextId++}`)
  return Object.assign(toastFn, {
    dismiss: vi.fn(),
    error: vi.fn(() => `toast-error-${nextId++}`),
    success: vi.fn(() => `toast-success-${nextId++}`),
    resetIds() {
      nextId = 0
    },
  })
})

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: sonnerToast,
}))

afterEach(cleanup)

beforeEach(() => {
  clearDestructiveToastDedupe()
  sonnerToast.resetIds()
  sonnerToast.mockClear()
  sonnerToast.error.mockClear()
  sonnerToast.success.mockClear()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('PolicySettingsPanel mutation target ownership', () => {
  it('ignores a deferred save success after policyApi switches', async () => {
    const pending = deferred<PolicyConfig>()
    const oldApi = createPolicyApi()
    const newApi = createPolicyApi()
    const initial = await oldApi.config.get()
    vi.mocked(oldApi.config.get).mockResolvedValue(initial)
    vi.mocked(newApi.config.get).mockResolvedValue(initial)
    vi.mocked(oldApi.config.update).mockReturnValueOnce(pending.promise)

    const { rerender } = render(<PolicySettingsPanel policyApi={oldApi} />)
    expect(await screen.findByRole('button', { name: 'Save Action Queue decisions' }))
      .toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Apply cutoff'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Action Queue decisions' }))
    await waitFor(() => expect(oldApi.config.update).toHaveBeenCalledTimes(1))

    rerender(<PolicySettingsPanel policyApi={newApi} />)
    await waitFor(() => expect(newApi.config.get).toHaveBeenCalled())

    await act(async () => {
      pending.resolve({
        ...initial,
        actionQueue: {
          ...initial.actionQueue,
          scoreCutoff: 99,
        },
      })
      await pending.promise
    })

    expect(sonnerToast.success).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('99')).not.toBeInTheDocument()
    expect(newApi.config.update).not.toHaveBeenCalled()
  })
})
