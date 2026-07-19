import type { ErrorPresentation } from '@/app/error-presentation'
import {
  AuthenticationFailure,
  GlobalFailureAlert,
  ScopedLoadFailure,
} from '@/components/ui/error-primitives'

/**
 * Renders the failure's contextual surface in place.
 * App-wide global ownership requires deliberate producer registration via
 * `takeLocalLoadFailure` / `reportGlobalFailure` — this view never registers.
 */
export function LoadFailureView({
  failure,
  onRetry,
}: {
  failure: Pick<ErrorPresentation, 'message' | 'retryable' | 'surface' | 'title'>
  onRetry?: () => void
}) {
  if (failure.surface === 'none' || !failure.message) {
    return null
  }

  const retry = failure.retryable ? onRetry : undefined

  if (failure.surface === 'authentication') {
    return (
      <AuthenticationFailure
        message={failure.message}
        title={failure.title}
        onRetry={retry}
      />
    )
  }

  if (failure.surface === 'global') {
    return (
      <GlobalFailureAlert
        message={failure.message}
        title={failure.title}
        onRetry={retry}
      />
    )
  }

  return (
    <ScopedLoadFailure
      message={failure.message}
      title={failure.title}
      onRetry={retry}
    />
  )
}
