import { useEffect, useRef } from 'react'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

function useFocusWhenPresented(active: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (active) {
      ref.current?.focus()
    }
  }, [active])
  return ref
}

function FailureRetryButton({ onRetry }: { onRetry?: () => void }) {
  if (!onRetry) return null
  return (
    <Button type="button" size="sm" variant="outline" onClick={onRetry}>
      Retry
    </Button>
  )
}

export function FormFailureAlert({
  message,
  title = 'Could not save',
}: {
  message: string
  title?: string
}) {
  const ref = useFocusWhenPresented(Boolean(message))
  return (
    <Alert
      ref={ref}
      variant="destructive"
      data-slot="form-failure"
      tabIndex={-1}
    >
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

export function ScopedLoadFailure({
  message,
  onRetry,
  title = 'Load failed',
}: {
  message: string
  onRetry?: () => void
  title?: string
}) {
  const ref = useFocusWhenPresented(Boolean(message))
  return (
    <Alert
      ref={ref}
      variant="destructive"
      data-slot="scoped-load-failure"
      className="mt-2"
      tabIndex={-1}
    >
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="gap-3">
        <p>{message}</p>
        <FailureRetryButton onRetry={onRetry} />
      </AlertDescription>
    </Alert>
  )
}

export function GlobalFailureAlert({
  message,
  onRetry,
  title = 'Service unavailable',
}: {
  message: string
  onRetry?: () => void
  title?: string
}) {
  const ref = useFocusWhenPresented(Boolean(message))
  return (
    <Alert
      ref={ref}
      variant="destructive"
      data-slot="global-failure"
      aria-live="assertive"
      tabIndex={-1}
    >
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="gap-3">
        <p>{message}</p>
        <FailureRetryButton onRetry={onRetry} />
      </AlertDescription>
    </Alert>
  )
}

export function AuthenticationFailure({
  message,
  onRetry,
  title = 'Authentication required',
}: {
  message: string
  onRetry?: () => void
  title?: string
}) {
  const ref = useFocusWhenPresented(Boolean(message))
  return (
    <Alert
      ref={ref}
      variant="destructive"
      data-slot="authentication-failure"
      tabIndex={-1}
    >
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="gap-3">
        <p>{message}</p>
        <FailureRetryButton onRetry={onRetry} />
      </AlertDescription>
    </Alert>
  )
}
