export interface CaptureRunFilter {
  readonly connectorInstanceId: string
  readonly connectorRunId: string
}

export interface ConnectorProvenanceTarget {
  readonly connectorRunId: string
  readonly id: string
  readonly kind: 'instance' | 'run' | 'scope'
}

const VIEW_CAPTURES_EVENT = 'valedictorian:view-captures'

export function openCapturesForRun(filter: CaptureRunFilter): void {
  window.dispatchEvent(new CustomEvent<CaptureRunFilter>(VIEW_CAPTURES_EVENT, { detail: filter }))
}

export function onOpenCapturesForRun(listener: (filter: CaptureRunFilter) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<CaptureRunFilter>).detail)
  window.addEventListener(VIEW_CAPTURES_EVENT, handle)
  return () => window.removeEventListener(VIEW_CAPTURES_EVENT, handle)
}
