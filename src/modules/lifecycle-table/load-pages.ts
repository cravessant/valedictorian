import type { LifecyclePageInfo } from '@sparxie/sdk'

const MAX_PAGES = 100

/** Address the page after a boundary cursor, or the first page when there is none. */
export function afterPage(
  after: string | undefined,
): { readonly after?: never } | { readonly after: string } {
  return after === undefined ? {} : { after }
}

/**
 * Drain a whole projection by following the canonical forward page boundary,
 * bounding pathological server loops. Used wherever a surface needs the complete
 * set rather than one addressed page: aggregate history and workbench counts.
 */
export async function loadAllPages<T>(
  loadPage: (after: string | undefined) => Promise<{
    readonly items: ReadonlyArray<T>
    readonly pageInfo: LifecyclePageInfo
  }>,
): Promise<ReadonlyArray<T>> {
  const items: T[] = []
  const seen = new Set<string>()
  let after: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await loadPage(after)
    items.push(...result.items)
    const next = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null
    if (!next) return items
    if (seen.has(next)) throw new Error('Pagination returned a repeated cursor.')
    seen.add(next)
    after = next
  }
  throw new Error(`Pagination exceeded the ${MAX_PAGES}-page safety limit.`)
}
