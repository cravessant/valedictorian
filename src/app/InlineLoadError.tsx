import { LoadFailureView } from '@/components/ui/load-failure-view'
import type { ErrorPresentation } from './error-presentation'

export function InlineLoadError({
  failure,
  onRetry,
}: {
  failure: Pick<ErrorPresentation, 'message' | 'retryable' | 'surface' | 'title'>
  onRetry?: () => void
}) {
  return <LoadFailureView failure={failure} onRetry={onRetry} />
}
