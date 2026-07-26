import { QueryClient, focusManager, type DefaultOptions } from '@tanstack/react-query'

/**
 * Renderer-wide TanStack Query configuration.
 *
 * Every behavior TanStack would otherwise default is restated, because the
 * workspace API is a local HTTP server rather than the public internet:
 * a rejected call surfaces immediately instead of being retried behind the
 * user's back, `networkMode: 'always'` keeps loopback requests running while
 * `navigator.onLine` is false, reconnect refetching is meaningless for a
 * loopback origin, and background refresh intervals are opted into by the
 * owning feature rather than inherited app-wide.
 */
const rendererDefaults: DefaultOptions = {
  queries: {
    gcTime: 5 * 60_000,
    networkMode: 'always',
    refetchInterval: false,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
  },
  mutations: {
    networkMode: 'always',
    retry: false,
  },
}

/**
 * TanStack v5 only watches `visibilitychange`. An Electron window that regains
 * activation without ever being hidden reports `focus` alone, which the renderer
 * has always treated as a reason to refresh, so both events stay wired. Passing
 * no argument asks the focus manager to re-evaluate visibility itself, which
 * fires on every activation rather than only on a changed boolean.
 */
function watchRendererActivation(): void {
  focusManager.setEventListener((handleActivation) => {
    const onActivate = (): void => handleActivation()
    window.addEventListener('focus', onActivate, false)
    document.addEventListener('visibilitychange', onActivate, false)
    return () => {
      window.removeEventListener('focus', onActivate)
      document.removeEventListener('visibilitychange', onActivate)
    }
  })
}

/** Build a client on the renderer defaults. Tests own the overrides they need. */
export function createRendererQueryClient(overrides: DefaultOptions = {}): QueryClient {
  watchRendererActivation()
  return new QueryClient({
    defaultOptions: {
      queries: { ...rendererDefaults.queries, ...overrides.queries },
      mutations: { ...rendererDefaults.mutations, ...overrides.mutations },
    },
  })
}

let rendererClient: QueryClient | undefined

/**
 * The one renderer-lifetime client. Constructed on first request from the app
 * composition root, never during ordinary component rendering.
 */
export function rendererQueryClient(): QueryClient {
  rendererClient ??= createRendererQueryClient()
  return rendererClient
}
