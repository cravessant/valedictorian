export interface IsolatedValidationReadinessGate {
  rendererLoaded(): void
  windowReady(): void
}

export function createIsolatedValidationReadinessGate({
  delayMs = 0,
  onReady,
  schedule = setTimeout,
}: {
  readonly delayMs?: number
  readonly onReady: () => void
  readonly schedule?: typeof setTimeout
}): IsolatedValidationReadinessGate {
  let published = false
  let rendererLoaded = false
  let windowReady = false

  function publishWhenReady() {
    if (published || !rendererLoaded || !windowReady) return
    published = true
    if (delayMs === 0) {
      onReady()
      return
    }
    schedule(onReady, delayMs)
  }

  return {
    rendererLoaded() {
      rendererLoaded = true
      publishWhenReady()
    },
    windowReady() {
      windowReady = true
      publishWhenReady()
    },
  }
}
