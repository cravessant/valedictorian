const MAX_HISTORY_PAGES = 100

/** Follow the real history cursor while bounding pathological server loops. */
export async function loadHistory<T>(
  loadPage: (cursor: string | undefined) => Promise<{
    readonly items: ReadonlyArray<T>
    readonly nextCursor: string | null
  }>,
): Promise<ReadonlyArray<T>> {
  const items: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const result = await loadPage(cursor)
    items.push(...result.items)
    if (!result.nextCursor) return items
    if (seen.has(result.nextCursor)) throw new Error('History pagination returned a repeated cursor.')
    seen.add(result.nextCursor)
    cursor = result.nextCursor
  }
  throw new Error(`History exceeded the ${MAX_HISTORY_PAGES}-page safety limit.`)
}
