import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPolicyConfig, type PolicyConfig } from '@sparxie/sdk'
import { clearDestructiveToastDedupe } from '@/components/ui/use-toast'
import { PolicySettingsPanel } from './PolicySettingsPanel'
import { createPolicyApi } from '../App.test-helpers'

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

  it('resets policy defaults only after alert confirmation and clears pending section saves', async () => {
    const policyApi = createPolicyApi()
    const initial = await policyApi.config.get()
    vi.mocked(policyApi.config.get).mockResolvedValue({
      ...initial,
      scoring: { ...initial.scoring, applyCutoff: 5 },
    })

    render(<PolicySettingsPanel policyApi={policyApi} />)
    expect(await screen.findByRole('button', { name: 'Save Action Queue decisions' }))
      .toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Apply cutoff'), { target: { value: '9' } })
    expect(screen.getByLabelText('Apply cutoff')).toHaveValue(9)
    expect(screen.getByRole('button', { name: 'Save Action Queue decisions' })).toBeEnabled()
    expect(policyApi.config.update).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reset policy' }))
    const cancelDialog = await screen.findByRole('alertdialog', { name: 'Reset policy?' })
    expect(policyApi.config.reset).not.toHaveBeenCalled()
    expect(cancelDialog).toHaveAccessibleDescription(
      'This restores default policy buckets, gates, and sourcing windows.',
    )
    fireEvent.click(within(cancelDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Reset policy?' })).not.toBeInTheDocument()
    })
    expect(policyApi.config.reset).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Apply cutoff')).toHaveValue(9)

    fireEvent.click(screen.getByRole('button', { name: 'Reset policy' }))
    const confirmDialog = await screen.findByRole('alertdialog', { name: 'Reset policy?' })
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Reset policy' }))

    await waitFor(() => {
      expect(policyApi.config.reset).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByLabelText('Apply cutoff')).toHaveValue(defaultPolicyConfig.scoring.applyCutoff)
    expect(screen.getByRole('button', { name: 'Save Action Queue decisions' })).toBeDisabled()
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Reset policy?' })).not.toBeInTheDocument()
    })
    expect(sonnerToast.success).toHaveBeenCalledWith('Policy reset.', expect.anything())
  })

  it('keeps the policy reset alert open with an error and disables confirm while pending', async () => {
    const policyApi = createPolicyApi()
    let rejectReset: ((reason?: unknown) => void) | undefined
    policyApi.config.reset = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectReset = reject
        }),
    )

    render(<PolicySettingsPanel policyApi={policyApi} />)
    expect(await screen.findByRole('button', { name: 'Reset policy' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reset policy' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Reset policy?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset policy' }))

    await waitFor(() => {
      expect(policyApi.config.reset).toHaveBeenCalledTimes(1)
    })
    expect(within(dialog).getByRole('button', { name: 'Resetting...' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()

    rejectReset?.(new Error('Policy store unavailable.'))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'form-failure')
    expect(alert).toHaveTextContent('An unexpected error occurred.')
    expect(document.activeElement).toBe(alert)
    expect(within(dialog).queryByText('Policy store unavailable.')).not.toBeInTheDocument()
    expect(screen.queryByText('Policy update failed')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Reset policy' })).toBeEnabled()
    expect(screen.getByRole('alertdialog', { name: 'Reset policy?' })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="form-failure"]')).toHaveLength(1)
    expect(sonnerToast.error).not.toHaveBeenCalled()
    expect(sonnerToast.success).not.toHaveBeenCalled()
  })

  it('owns policy save failures with one form surface and never duplicates a toast', async () => {
    const policyApi = createPolicyApi()
    policyApi.config.update = vi.fn(async () => {
      throw new Error('ENOENT /var/policy.json stack')
    })

    render(<PolicySettingsPanel policyApi={policyApi} />)
    expect(await screen.findByRole('button', { name: 'Save Action Queue decisions' }))
      .toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Apply cutoff'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Action Queue decisions' }))

    await waitFor(() => {
      expect(policyApi.config.update).toHaveBeenCalled()
    })

    const formFailure = await screen.findByRole('alert')
    expect(formFailure).toHaveAttribute('data-slot', 'form-failure')
    expect(formFailure).toHaveTextContent('An unexpected error occurred.')
    expect(screen.queryByText('ENOENT /var/policy.json stack')).not.toBeInTheDocument()
    expect(screen.queryByText('Policy update failed')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Apply cutoff')).toHaveValue(7)
    expect(document.querySelectorAll('[data-slot="form-failure"]')).toHaveLength(1)
    expect(sonnerToast.error).not.toHaveBeenCalled()
  })
})
