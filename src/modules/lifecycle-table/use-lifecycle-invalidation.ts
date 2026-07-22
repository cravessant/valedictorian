import { useEffect, useRef } from 'react'

export interface LifecycleInvalidationOptions {
  readonly enabled: boolean
  readonly intervalMs?: number
}

/**
 * Aggregate-neutral refresh invalidation for the lifecycle workbench. Fires
 * the supplied refresh on window focus, document visibility return, and a
 * slow interval. Overlapping invocations are coalesced and stale completions
 * are ignored when a newer refresh started before an in-flight one resolved.
 * Listeners and timers are cleaned on unmount.
 */
export function useLifecycleInvalidation(
  refresh: () => Promise<void> | void,
  { enabled, intervalMs = 60_000 }: LifecycleInvalidationOptions,
): void {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const inFlight = useRef<Promise<void> | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    if (!enabled) return

    const run = (): void => {
      if (inFlight.current !== null) return
      const gen = ++generation.current
      const maybe = refreshRef.current()
      if (maybe && typeof maybe.then === 'function') {
        inFlight.current = Promise.resolve(maybe).catch(() => {})
        void inFlight.current.finally(() => {
          if (gen === generation.current) inFlight.current = null
          else inFlight.current = null
        })
      }
    }

    const onFocus = (): void => run()
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') run()
    }
    const timer = window.setInterval(run, intervalMs)

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
      generation.current += 1
      inFlight.current = null
    }
  }, [enabled, intervalMs])
}
