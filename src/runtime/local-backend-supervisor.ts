export type LocalBackendState =
  | { status: 'starting' | 'unavailable' | 'stopped' }
  | { status: 'available'; origin: string }

export interface SupervisedBackendListener {
  close(): Promise<void>
  onClosed(listener: () => void): () => void
  onError(listener: () => void): () => void
  origin: string
}

export type LocalBackendSupervisorClock = {
  clearTimeout(id: ReturnType<typeof setTimeout>): void
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>
}

export function createLocalBackendSupervisor({
  clock = {
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setTimeout: globalThis.setTimeout.bind(globalThis),
  },
  liveness,
  restart,
  startListener,
  verifyOrigin,
}: {
  clock?: LocalBackendSupervisorClock
  liveness?: { failureThreshold: number; intervalMs: number; timeoutMs: number }
  restart: { baseDelayMs: number; maxAttempts: number; maxDelayMs: number }
  startListener: () => Promise<SupervisedBackendListener>
  verifyOrigin: (origin: string) => Promise<boolean>
}) {
  let state: LocalBackendState = { status: 'stopped' }
  let listener: SupervisedBackendListener | null = null
  let unsubscribeClosed: () => void = () => undefined
  let stopping = false
  let generation = 0
  let consecutiveProbeFailures = 0
  let livenessTimer: ReturnType<typeof setTimeout> | null = null
  let restartAttempts = 0
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  const subscribers = new Set<(nextState: LocalBackendState) => void>()
  function publish(nextState: LocalBackendState) {
    state = nextState
    for (const subscriber of subscribers) {
      subscriber(nextState)
    }
  }
  async function startAttempt() {
    const attemptGeneration = generation
    publish({ status: 'starting' })
    try {
      const started = await startListener()
      if (stopping || attemptGeneration !== generation) {
        await started.close()
        return
      }
      let failedBeforeVerification = false
      let activated = false
      let failureHandled = false
      const handleFailure = (shouldClose: boolean) => {
        if (failureHandled) return
        failureHandled = true
        if (activated) handleUnexpectedFailure(started, shouldClose)
        else failedBeforeVerification = true
      }
      const stopWatchingClosed = started.onClosed(() => handleFailure(false))
      const stopWatchingError = started.onError(() => handleFailure(true))
      const stopWatching = () => {
        stopWatchingClosed()
        stopWatchingError()
      }
      const verified = await verifyOriginWithinTimeout(started.origin)
      if (stopping || attemptGeneration !== generation) {
        stopWatching()
        releaseListener(started)
        return
      }
      if (!verified || failedBeforeVerification) {
        stopWatching()
        releaseListener(started)
        throw new Error('Local backend health verification failed.')
      }
      listener = started
      restartAttempts = 0
      unsubscribeClosed = stopWatching
      activated = true
      publish({ origin: started.origin, status: 'available' })
      consecutiveProbeFailures = 0
      scheduleLivenessProbe(started)
    } catch {
      if (!stopping && attemptGeneration === generation) {
        publish({ status: 'unavailable' })
        scheduleRestart()
      }
    }
  }
  function handleUnexpectedFailure(failed: SupervisedBackendListener, shouldClose: boolean) {
    if (stopping || listener !== failed) return
    clearLivenessTimer()
    unsubscribeClosed()
    listener = null
    publish({ status: 'unavailable' })
    if (shouldClose) releaseListener(failed)
    scheduleRestart()
  }
  async function verifyOriginWithinTimeout(origin: string) {
    if (!liveness) return verifyOrigin(origin)
    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        verifyOrigin(origin).catch(() => false),
        new Promise<boolean>((resolve) => {
          timeout = clock.setTimeout(() => resolve(false), liveness.timeoutMs)
        }),
      ])
    } finally {
      if (timeout) clock.clearTimeout(timeout)
    }
  }
  function scheduleLivenessProbe(activeListener: SupervisedBackendListener) {
    if (!liveness || stopping || listener !== activeListener || livenessTimer) return
    livenessTimer = clock.setTimeout(() => {
      livenessTimer = null
      void runLivenessProbe(activeListener)
    }, liveness.intervalMs)
  }
  async function runLivenessProbe(activeListener: SupervisedBackendListener) {
    const healthy = await verifyOriginWithinTimeout(activeListener.origin)
    if (stopping || listener !== activeListener) return
    if (healthy) {
      consecutiveProbeFailures = 0
      scheduleLivenessProbe(activeListener)
      return
    }
    consecutiveProbeFailures += 1
    if (consecutiveProbeFailures >= (liveness?.failureThreshold ?? 1)) {
      handleUnexpectedFailure(activeListener, true)
      return
    }
    scheduleLivenessProbe(activeListener)
  }
  function clearLivenessTimer() {
    if (livenessTimer) clock.clearTimeout(livenessTimer)
    livenessTimer = null
  }
  function releaseListener(failed: SupervisedBackendListener) {
    try { void failed.close().catch(() => undefined) } catch { /* Already released. */ }
  }
  function scheduleRestart() {
    if (stopping || restartAttempts >= restart.maxAttempts || restartTimer) {
      return
    }
    const delay = Math.min(
      restart.maxDelayMs,
      restart.baseDelayMs * (2 ** restartAttempts),
    )
    restartAttempts += 1
    restartTimer = clock.setTimeout(() => {
      restartTimer = null
      void startAttempt()
    }, delay)
  }
  return {
    getState: () => state,
    async retry() {
      if (stopping || state.status === 'available' || state.status === 'starting') return
      restartAttempts = 0
      if (restartTimer) clock.clearTimeout(restartTimer)
      restartTimer = null
      await startAttempt()
    },
    start: startAttempt,
    async stop() {
      stopping = true
      generation += 1
      clearLivenessTimer()
      if (restartTimer) {
        clock.clearTimeout(restartTimer)
        restartTimer = null
      }
      unsubscribeClosed()
      await listener?.close()
      listener = null
      publish({ status: 'stopped' })
    },
    subscribe(subscriber: (nextState: LocalBackendState) => void) {
      subscribers.add(subscriber)
      return () => subscribers.delete(subscriber)
    },
  }
}
export type LocalBackendSupervisor = ReturnType<typeof createLocalBackendSupervisor>
