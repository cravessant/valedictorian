import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type SonnerToastData = Record<string, unknown>

const sonnerToast = vi.hoisted(() => {
  let nextId = 0
  const toastFn = vi.fn(
    (_message: string, _data?: SonnerToastData): string | number => `toast-default-${nextId++}`,
  )
  return Object.assign(toastFn, {
    dismiss: vi.fn(),
    error: vi.fn(
      (_message: string, _data?: SonnerToastData): string | number => `toast-error-${nextId++}`,
    ),
    success: vi.fn(
      (_message: string, _data?: SonnerToastData): string | number => `toast-success-${nextId++}`,
    ),
    resetIds() {
      nextId = 0
    },
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
  beforeEach(async () => {
    vi.resetModules()
    sonnerToast.resetIds()
    sonnerToast.mockClear()
    sonnerToast.success.mockClear()
    sonnerToast.error.mockClear()
    sonnerToast.dismiss.mockClear()
    SonnerToaster.mockClear()
    const { clearDestructiveToastDedupe } = await import('./use-toast')
    clearDestructiveToastDedupe()
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
      id: 'toast-default-0',
    })
    expect(successHandle.id).toBe('toast-success-1')
    expect(errorHandle.id).toBe('toast-error-2')

    defaultHandle.dismiss()
    expect(sonnerToast.dismiss).toHaveBeenCalledWith('toast-default-0')

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

  it('deduplicates destructive action toasts by stable operation identity', async () => {
    const { toast } = await import('./use-toast')

    const first = toast({
      description: 'Opportunity could not be promoted.',
      operationId: 'promote:finding-1',
      title: 'Action failed',
      variant: 'destructive',
    })
    const duplicate = toast({
      description: 'Opportunity could not be promoted.',
      operationId: 'promote:finding-1',
      title: 'Action failed',
      variant: 'destructive',
    })
    const distinctAttempt = toast({
      description: 'Opportunity could not be promoted.',
      operationId: 'promote:finding-1:attempt-2',
      title: 'Action failed',
      variant: 'destructive',
    })

    expect(sonnerToast.error).toHaveBeenCalledTimes(2)
    expect(duplicate.id).toBe(first.id)
    expect(distinctAttempt.id).not.toBe(first.id)

    first.dismiss()
    const afterDismiss = toast({
      description: 'Opportunity could not be promoted.',
      operationId: 'promote:finding-1',
      title: 'Action failed',
      variant: 'destructive',
    })
    expect(sonnerToast.error).toHaveBeenCalledTimes(3)
    expect(afterDismiss.id).not.toBe(first.id)
  })

  it('clears one operationId so a later mount can emit the same destructive toast', async () => {
    const { clearDestructiveToastDedupeFor, toast } = await import('./use-toast')

    toast({
      description: 'Settings could not be saved.',
      operationId: 'settings:update',
      title: 'Action failed',
      variant: 'destructive',
    })
    expect(sonnerToast.error).toHaveBeenCalledTimes(1)

    clearDestructiveToastDedupeFor('settings:update')

    toast({
      description: 'Settings could not be saved.',
      operationId: 'settings:update',
      title: 'Action failed',
      variant: 'destructive',
    })
    expect(sonnerToast.error).toHaveBeenCalledTimes(2)
  })

  it('preserves native numeric toast IDs for dedupe dismissal and lifecycle cleanup', async () => {
    let nextNumericId = 100
    sonnerToast.error.mockImplementation(() => nextNumericId++)

    const { toast } = await import('./use-toast')

    const first = toast({
      description: 'Jobright run could not be completed.',
      operationId: 'connector-run:instance-1',
      title: 'Action failed',
      variant: 'destructive',
    })
    expect(first.id).toBe(100)
    expect(typeof first.id).toBe('number')

    const duplicate = toast({
      description: 'Jobright run could not be completed.',
      operationId: 'connector-run:instance-1',
      title: 'Action failed',
      variant: 'destructive',
    })
    expect(sonnerToast.error).toHaveBeenCalledTimes(1)
    expect(duplicate.id).toBe(100)
    expect(typeof duplicate.id).toBe('number')

    first.dismiss()
    expect(sonnerToast.dismiss).toHaveBeenCalledWith(100)

    const afterDismiss = toast({
      description: 'Jobright run could not be completed.',
      operationId: 'connector-run:instance-1',
      title: 'Action failed',
      variant: 'destructive',
    })
    expect(sonnerToast.error).toHaveBeenCalledTimes(2)
    expect(afterDismiss.id).toBe(101)
    expect(typeof afterDismiss.id).toBe('number')

    const dismissOptions = sonnerToast.error.mock.calls[1]?.[1] as {
      onAutoClose?: () => void
      onDismiss?: () => void
    }
    dismissOptions.onDismiss?.()
    const afterLifecycleCleanup = toast({
      description: 'Jobright run could not be completed.',
      operationId: 'connector-run:instance-1',
      title: 'Action failed',
      variant: 'destructive',
    })
    expect(sonnerToast.error).toHaveBeenCalledTimes(3)
    expect(afterLifecycleCleanup.id).toBe(102)
  })

  it('does not let delayed lifecycle cleanup from toast A clear newer toast B ownership', async () => {
    let nextNumericId = 200
    sonnerToast.error.mockImplementation(() => nextNumericId++)
    const { clearDestructiveToastDedupe, toast } = await import('./use-toast')
    clearDestructiveToastDedupe()

    const first = toast({
      description: 'first failure',
      operationId: 'settings:update',
      title: 'Action failed',
      variant: 'destructive',
    })
    const firstLifecycle = sonnerToast.error.mock.calls[0]?.[1] as {
      onAutoClose?: () => void
      onDismiss?: () => void
    }

    first.dismiss()
    const second = toast({
      description: 'second failure',
      operationId: 'settings:update',
      title: 'Action failed',
      variant: 'destructive',
    })
    expect(second.id).toBe(201)
    expect(sonnerToast.error).toHaveBeenCalledTimes(2)

    // Delayed callbacks from the old toast must not clear the newer ownership.
    firstLifecycle.onDismiss?.()
    firstLifecycle.onAutoClose?.()

    const duplicateOfSecond = toast({
      description: 'second failure again',
      operationId: 'settings:update',
      title: 'Action failed',
      variant: 'destructive',
    })
    expect(sonnerToast.error).toHaveBeenCalledTimes(2)
    expect(duplicateOfSecond.id).toBe(second.id)

    const secondLifecycle = sonnerToast.error.mock.calls[1]?.[1] as {
      onAutoClose?: () => void
      onDismiss?: () => void
    }
    secondLifecycle.onAutoClose?.()
    const afterSecondLifecycle = toast({
      description: 'third failure',
      operationId: 'settings:update',
      title: 'Action failed',
      variant: 'destructive',
    })
    expect(sonnerToast.error).toHaveBeenCalledTimes(3)
    expect(afterSecondLifecycle.id).toBe(202)
  })
})

function renderHookToast<Hook>(useToast: () => Hook) {
  let result!: Hook
  function Probe() {
    result = useToast()
    return null
  }
  render(<Probe />)
  return result
}
