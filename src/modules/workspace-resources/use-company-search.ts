import { useEffect, useRef, useState } from 'react'
import type { CompanySearchResult, WorkspaceCompaniesClient } from '@sparxie/sdk'

export const COMPANY_SEARCH_DEBOUNCE_MS = 200
export const COMPANY_SEARCH_LIMIT = 20

export type CompanySearchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'ready'; readonly items: readonly CompanySearchResult[]; readonly truncated: boolean }
  | { readonly kind: 'failed' }

/** Debounces active-Company search and admits only the newest response. */
export function useCompanySearch(
  client: Pick<WorkspaceCompaniesClient, 'search'> | null,
  query: string,
): CompanySearchState {
  const [state, setState] = useState<CompanySearchState>({ kind: 'idle' })
  const issued = useRef(0)
  const mounted = useRef(true)
  const trimmed = query.trim()

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const sequence = ++issued.current
    if (!client || !trimmed) {
      setState({ kind: 'idle' })
      return
    }
    setState({ kind: 'searching' })
    function admit(next: CompanySearchState) {
      if (mounted.current && sequence === issued.current) setState(next)
    }
    const timer = window.setTimeout(() => {
      void client.search({
        query: trimmed,
        scope: 'active',
        limit: COMPANY_SEARCH_LIMIT,
      }).then(
        (page) => admit({ kind: 'ready', items: page.items, truncated: page.truncated }),
        () => admit({ kind: 'failed' }),
      )
    }, COMPANY_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [client, trimmed])

  return state
}

export function hasExactCompanyNameMatch(
  items: readonly CompanySearchResult[],
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  return items.some((item) => item.displayName.toLocaleLowerCase() === normalized)
}
