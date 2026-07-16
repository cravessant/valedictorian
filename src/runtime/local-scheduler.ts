export interface LocalScheduledWorkSource {
  id: string
  nextDueAt(): Promise<string | null> | string | null
  runDue(signal?: AbortSignal): Promise<void>
  onSignal?(): void
}

export interface LocalSchedulerOptions {
  now?: () => Date
  setTimeout?: (callback: () => void, delayMs: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

export interface LocalScheduler {
  register(source: LocalScheduledWorkSource): void
  signal(): void
  start(): void
  stop(): Promise<void>
  whenIdle(): Promise<void>
}

const DEFAULT_RETRY_DELAY_MS = 1_000
const MAX_TIMER_DELAY_MS = 2_147_483_647

/**
 * Coordinates persisted local work while the app is open.
 *
 * Sources own due-work discovery and execution. The coordinator only serializes
 * wakeups, chooses the next persisted due instant, and owns the app lifecycle
 * timer. A source can therefore be reused by another scheduler deployment.
 */
export function createLocalScheduler({
  clearTimeout = (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  now = () => new Date(),
  setTimeout = (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
}: LocalSchedulerOptions = {}): LocalScheduler {
  const sources = new Map<string, LocalScheduledWorkSource>()
  let active = false
  let wakeRequested = false
  let timer: unknown = null
  let timerGeneration = 0
  let drainPromise: Promise<void> | null = null
  let currentRunController: AbortController | null = null

  const requestWake = () => {
    if (!active) return
    wakeRequested = true
    if (!drainPromise) {
      drainPromise = drain().finally(() => {
        drainPromise = null
        if (active && wakeRequested) requestWake()
      })
    }
  }

  async function drain(): Promise<void> {
    while (active && wakeRequested) {
      wakeRequested = false
      cancelTimer()
      const current = now().getTime()
      const discovered = await discover(current)

      for (const source of discovered.due) {
        if (!active) return
        const runController = new AbortController()
        currentRunController = runController
        try {
          await source.runDue(runController.signal)
        } catch {
          // One failing source must not prevent unrelated app work from running.
          discovered.retry = true
        } finally {
          if (currentRunController === runController) {
            currentRunController = null
          }
        }
      }

      if (!active || wakeRequested) continue
      await arm(discovered.retry)
    }
  }

  async function discover(currentMs: number): Promise<{
    due: LocalScheduledWorkSource[]
    nextDueAt: number | null
    retry: boolean
  }> {
    const due: LocalScheduledWorkSource[] = []
    let nextDueAt: number | null = null
    let retry = false

    for (const source of sources.values()) {
      try {
        const value = await source.nextDueAt()
        if (value === null) continue
        const dueMs = Date.parse(value)
        if (!Number.isFinite(dueMs)) {
          retry = true
          continue
        }
        if (dueMs <= currentMs) {
          due.push(source)
        } else if (nextDueAt === null || dueMs < nextDueAt) {
          nextDueAt = dueMs
        }
      } catch {
        retry = true
      }
    }

    return { due, nextDueAt, retry }
  }

  async function arm(retry: boolean): Promise<void> {
    const discovered = await discover(now().getTime())
    if (!active) return

    const shouldRetry = retry || discovered.retry
    if (!shouldRetry && discovered.due.length > 0) {
      wakeRequested = true
      return
    }

    const delayMs = shouldRetry
      ? DEFAULT_RETRY_DELAY_MS
      : discovered.nextDueAt === null
        ? null
        : Math.min(
            MAX_TIMER_DELAY_MS,
            Math.max(0, discovered.nextDueAt - now().getTime()),
          )
    if (delayMs === null) return

    const generation = ++timerGeneration
    timer = setTimeout(() => {
      if (!active || generation !== timerGeneration) return
      timer = null
      requestWake()
    }, delayMs)
  }

  function cancelTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
    timerGeneration += 1
  }

  return {
    register(source) {
      sources.set(source.id, source)
      requestWake()
    },
    signal() {
      for (const source of sources.values()) {
        source.onSignal?.()
      }
      requestWake()
    },
    start() {
      active = true
      requestWake()
    },
    stop() {
      active = false
      wakeRequested = false
      cancelTimer()
      currentRunController?.abort()
      return drainPromise ?? Promise.resolve()
    },
    whenIdle() {
      return drainPromise ?? Promise.resolve()
    },
  }
}
