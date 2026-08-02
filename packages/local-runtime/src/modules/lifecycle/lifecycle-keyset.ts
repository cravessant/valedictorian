/**
 * Shared keyset traversal for the lifecycle read models.
 *
 * The four lifecycle lists (plus the Application technical lists) all page over
 * a stable `(primary, id)` ordering, so the predicate, the ordering, and the
 * adjacency probe live here once. Each read model supplies its own table,
 * columns, and filters; nothing else about an aggregate leaks in.
 */
import { and, asc, desc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { PgliteDatabase } from '../../db/pglite.js'
import { decodeKeysetCursor, type LifecyclePageWindow } from './lifecycle-page.dto.js'

/** Read surface only — the workspace database or an open transaction. */
export type KeysetReadExec = Pick<PgliteDatabase, 'select'>

/** The `(primary, id)` columns a list is ordered and paged by. */
export interface LifecycleKeysetColumns {
  readonly primary: AnyPgColumn
  readonly id: AnyPgColumn
}

/** Rows strictly beyond `cursor`, walking against the ordering when `backward`. */
export function lifecycleKeysetCondition(
  columns: LifecycleKeysetColumns,
  cursor: string,
  backward: boolean,
): SQL | undefined {
  const decoded = decodeKeysetCursor(cursor)
  if (!decoded) return undefined
  const compare = backward ? lt : gt
  return or(
    compare(columns.primary, decoded.primary),
    and(eq(columns.primary, decoded.primary), compare(columns.id, decoded.id)),
  )
}

/** The traversal predicate for a resolved window, or nothing on the first page. */
export function lifecycleKeysetWindow(
  columns: LifecycleKeysetColumns,
  window: LifecyclePageWindow,
): SQL[] {
  if (window.cursor === null) return []
  const condition = lifecycleKeysetCondition(columns, window.cursor, window.backward)
  return condition ? [condition] : []
}

/** Traversal order: descending for a `before` request, restored by the page assembly. */
export function lifecycleKeysetOrder(
  columns: LifecycleKeysetColumns,
  window: LifecyclePageWindow,
): SQL[] {
  return window.backward
    ? [desc(columns.primary), desc(columns.id)]
    : [asc(columns.primary), asc(columns.id)]
}

/**
 * Answer whether a row still survives beyond a boundary under the same filters.
 *
 * Page metadata cannot be inferred from the request direction: the rows a cursor
 * URL was anchored on may have been removed since it was addressed. The page
 * assembly asks this instead, so the reported adjacency describes the filtered
 * dataset as it is now rather than as the request assumed it to be.
 */
export function createLifecycleAdjacencyProbe(
  exec: KeysetReadExec,
  table: PgTable,
  filters: readonly SQL[],
  columns: LifecycleKeysetColumns,
) {
  return async (cursor: string, backward: boolean): Promise<boolean> => {
    const condition = lifecycleKeysetCondition(columns, cursor, backward)
    if (!condition) return false
    const [row] = await exec
      .select({ value: sql<number>`1` })
      .from(table)
      .where(and(...filters, condition))
      .limit(1)
    return row !== undefined
  }
}
