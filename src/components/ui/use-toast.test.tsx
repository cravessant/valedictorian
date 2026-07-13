import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sonnerToast = vi.hoisted(() => {
  const toastFn = vi.fn(() => 'toast-default')
  return Object.assign(toastFn, {
    dismiss: vi.fn(),
    error: vi.fn(() => 'toast-error'),
    success: vi.fn(() => 'toast-success'),
  })
})

const SonnerToaster = vi.hoisted(() =>
  vi.fn((props: Record<string, unknown>) => (
    <div
      data-close-button={String(props.closeButton)}
      data-position={String(props.position)}
      data-rich-colors={String(props.richColors)}
      data-testid="sonner-toaster"
      data-theme={String(props.theme)}
      style={props.style as Record<string, string> | undefined}
    />
  )),
)

vi.mock('sonner', () => ({
  Toaster: SonnerToaster,
  toast: sonnerToast,
}))

describe('useToast sonner adapter', () => {
  beforeEach(() => {
    sonnerToast.mockClear()
    sonnerToast.success.mockClear()
    sonnerToast.error.mockClear()
    sonnerToast.dismiss.mockClear()
    SonnerToaster.mockClear()
  })

  it('maps ToastInput variants through sonner and themes the Toaster', async () => {
    const { toast, useToast } = await import('./use-toast')
    const { Toaster } = await import('./sonner')

    const onAction = vi.fn()
    const defaultHandle = toast({
      action: { label: 'Retry', onClick: onAction },
      description: 'Try again later.',
      title: 'Queued',
    })
    const successHandle = toast({
      description: 'Profile saved.',
      title: 'Saved',
      variant: 'success',
    })
    const errorHandle = toast({
      description: 'Disk is full.',
      title: 'Save failed',
      variant: 'destructive',
    })

    expect(sonnerToast).toHaveBeenCalledWith('Queued', {
      action: { label: 'Retry', onClick: expect.any(Function) },
      description: 'Try again later.',
    })
    expect(sonnerToast.success).toHaveBeenCalledWith('Saved', {
      description: 'Profile saved.',
    })
    expect(sonnerToast.error).toHaveBeenCalledWith('Save failed', {
      description: 'Disk is full.',
    })

    const forwardedAction = sonnerToast.mock.calls[0]?.[1]?.action as {
      onClick: () => void
    }
    forwardedAction.onClick()
    expect(onAction).toHaveBeenCalledTimes(1)

    expect(defaultHandle).toEqual({
      dismiss: expect.any(Function),
      id: 'toast-default',
    })
    expect(successHandle.id).toBe('toast-success')
    expect(errorHandle.id).toBe('toast-error')

    defaultHandle.dismiss()
    expect(sonnerToast.dismiss).toHaveBeenCalledWith('toast-default')

    const hook = renderHookToast(useToast)
    expect(hook.toast).toBe(toast)
    expect(hook.dismiss).toBe(sonnerToast.dismiss)

    render(<Toaster />)

    const toaster = SonnerToaster.mock.calls[0]?.[0] as {
      closeButton?: boolean
      position?: string
      richColors?: boolean
      style?: Record<string, string>
      theme?: string
    }

    expect(toaster.theme).toBe('dark')
    expect(toaster.richColors).toBe(true)
    expect(toaster.closeButton).toBe(true)
    expect(toaster.position).toBe('bottom-right')
    expect(toaster.style).toMatchObject({
      '--normal-bg': 'var(--popover)',
      '--normal-border': 'var(--border)',
      '--normal-text': 'var(--popover-foreground)',
    })
  })
})

function renderHookToast(useToast: () => {
  dismiss: typeof sonnerToast.dismiss
  toast: (input: unknown) => unknown
}) {
  let result!: ReturnType<typeof useToast>
  function Probe() {
    result = useToast()
    return null
  }
  render(<Probe />)
  return result
}
