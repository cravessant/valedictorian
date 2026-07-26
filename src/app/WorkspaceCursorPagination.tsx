import type { ReactElement } from 'react'

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import type { WorkspaceLocation } from './workspace-location'
import { nextWorkspacePage, previousWorkspacePage, type WorkspacePageInfo } from './workspace-page'

/**
 * Previous/Next navigation for one canonical workspace page.
 *
 * It owns only the transition: which location each direction addresses and
 * whether the page offers it. Every consumer keeps its own accessible name,
 * query inputs, table, and empty/loading/error presentation, and a consumer
 * with no navigation handler renders both directions disabled.
 */
export function WorkspaceCursorPagination({
  className,
  label,
  location,
  onNavigate,
  pageInfo,
}: {
  readonly className?: string
  readonly label: string
  readonly location: WorkspaceLocation
  readonly onNavigate?: (location: WorkspaceLocation) => void
  readonly pageInfo: WorkspacePageInfo
}): ReactElement {
  return (
    <Pagination aria-label={label} className={className ?? 'justify-end'}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            disabled={!onNavigate || !pageInfo.hasPreviousPage}
            onClick={() => {
              const previous = previousWorkspacePage(location, pageInfo)
              if (previous) onNavigate?.(previous)
            }}
          >
            Previous
          </PaginationPrevious>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            disabled={!onNavigate || !pageInfo.hasNextPage}
            onClick={() => {
              const next = nextWorkspacePage(location, pageInfo)
              if (next) onNavigate?.(next)
            }}
          >
            Next
          </PaginationNext>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
