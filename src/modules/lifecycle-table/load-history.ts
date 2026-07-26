import type { LifecyclePageInfo } from '@sparxie/sdk'

const MAX_HISTORY_PAGES = 100

/** Address the page after a boundary cursor, or the first page when there is none. */
export function afterPage(
  after: string | undefined,
): { readonly after?: never } | { readonly after: string } {
  return after === undefined ? {} : { after }
}

/** Follow the canonical forward page boundary while bounding pathological server loops. */
export async function loadHistory<T>(
  loadPage: (after: string | undefined) => Promise<{
    readonly items: ReadonlyArray<T>
    readonly pageInfo: LifecyclePageInfo
  }>,
): Promise<ReadonlyArray<T>> {
  const items: T[] = []
  const seen = new Set<string>()
  let after: string | undefined
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const result = await loadPage(after)
    items.push(...result.items)
    const next = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null
    if (!next) return items
    if (seen.has(next)) throw new Error('History pagination returned a repeated cursor.')
    seen.add(next)
    after = next
  }
  throw new Error(`History exceeded the ${MAX_HISTORY_PAGES}-page safety limit.`)
}
