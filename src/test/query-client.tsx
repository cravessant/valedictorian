import { render, type RenderResult } from '@testing-library/react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'

import { createRendererQueryClient } from '../app/query-client'

/**
 * A fresh client per test. Retries stay off so a rejected call is asserted at the
 * first failure, and the cache lives exactly as long as the test does — the
 * client is discarded with it, so nothing leaks between cases.
 */
export function testQueryClient(): QueryClient {
  return createRendererQueryClient({
    queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
    mutations: { retry: false },
  })
}

/** Render under a test-owned query client, preserving `rerender` semantics. */
export function renderWithQueryClient(
  ui: ReactElement,
  { client = testQueryClient() }: { readonly client?: QueryClient } = {},
): RenderResult {
  return render(ui, {
    wrapper: ({ children }: { children?: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}
