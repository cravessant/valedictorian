import { useEffect, useMemo, useRef, useState, type ChangeEventHandler } from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type VisibilityState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ExternalLinkButton } from '@/components/ExternalLinkButton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ExternalLink, Pencil } from 'lucide-react'
import { formatEnumLabel } from '../../app/labels'
import type {
  ApplicationListItem,
  ApplicationListResult,
  ApplicationListSort,
} from './application.types'
import { formatJobTerms } from './application.types'

const ROW_HEIGHT = 54
const ROW_OVERSCAN = 4
const defaultColumnVisibility: VisibilityState = {
  location: false,
  updated: false,
}

interface ApplicationTableProps {
  result: ApplicationListResult
  sort: ApplicationListSort
  onEditApplication?: (application: ApplicationListItem) => void
  onOpenApplication?: (application: ApplicationListItem) => void
  onSortChange: (sort: ApplicationListSort) => void
  onPreviousPage: () => void
  onNextPage: () => void
}

const applicationColumns: ColumnDef<ApplicationListItem>[] = [
  {
    id: 'select',
    enableHiding: false,
    enableSorting: false,
    size: 44,
    header: ({ table }) => (
      <SelectionCheckbox
        aria-label="Select all applications on page"
        checked={table.getIsAllRowsSelected()}
        onChange={table.getToggleAllRowsSelectedHandler()}
      />
    ),
    cell: ({ row }) => (
      <SelectionCheckbox
        aria-label={`Select ${row.original.companyName}`}
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
      />
    ),
  },
  {
    accessorKey: 'companyName',
    id: 'company',
    enableHiding: false,
    size: 190,
    header: 'Company',
    cell: ({ row }) => (
      <span className="block max-w-48 truncate font-medium text-foreground" title={row.original.companyName}>
        {row.original.companyName}
      </span>
    ),
  },
  {
    accessorKey: 'roleTitle',
    id: 'role',
    enableHiding: false,
    size: 220,
    header: 'Role',
    cell: ({ row }) => (
      <span className="block max-w-56 truncate text-muted-foreground" title={row.original.roleTitle}>
        {row.original.roleTitle}
      </span>
    ),
  },
  {
    id: 'timing',
    enableSorting: false,
    size: 94,
    header: 'Timing',
    cell: ({ row }) => (
      <Badge className="max-w-24 truncate whitespace-nowrap" variant="outline">
        {formatApplicationTiming(row.original)}
      </Badge>
    ),
  },
  {
    accessorKey: 'sourceName',
    id: 'source',
    size: 118,
    header: 'Source',
    cell: ({ row }) => (
      <Badge className="max-w-28 truncate whitespace-nowrap" title={row.original.sourceName} variant="secondary">
        {row.original.sourceName}
      </Badge>
    ),
  },
  {
    accessorKey: 'status',
    id: 'status',
    enableHiding: false,
    size: 122,
    header: 'Status',
    cell: ({ row }) => (
      <Badge className="max-w-32 truncate whitespace-nowrap" variant={getStatusVariant(row.original.status)}>
        {formatEnumLabel(row.original.status)}
      </Badge>
    ),
  },
  {
    accessorKey: 'currentPriorityScore',
    id: 'priority',
    size: 76,
    header: 'Score',
    cell: ({ row }) => (
      <Badge variant={row.original.currentPriorityScore === null ? 'outline' : 'default'}>
        {formatScore(row.original)}
      </Badge>
    ),
  },
  {
    accessorKey: 'location',
    id: 'location',
    enableSorting: false,
    size: 120,
    header: 'Location',
    cell: ({ row }) => (
      <span className="block max-w-28 truncate text-muted-foreground" title={row.original.location}>
        {row.original.location}
      </span>
    ),
  },
  {
    accessorKey: 'updatedAt',
    id: 'updated',
    size: 104,
    header: 'Updated',
    cell: ({ row }) => (
      <span className="text-muted-foreground">{formatDate(row.original.updatedAt)}</span>
    ),
  },
  {
    id: 'link',
    enableSorting: false,
    size: 72,
    header: 'Link',
    cell: ({ row }) =>
      row.original.primaryLink ? (
        <ExternalLinkButton
          className="gap-1.5 px-2"
          href={row.original.primaryLink.url}
          icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          {row.original.primaryLink.label}
        </ExternalLinkButton>
      ) : (
        <span className="text-muted-foreground">None</span>
      ),
  },
]

function ApplicationTable({
  result,
  sort,
  onEditApplication,
  onOpenApplication,
  onSortChange,
  onPreviousPage,
  onNextPage,
}: ApplicationTableProps) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    defaultColumnVisibility,
  )
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnsOpen, setColumnsOpen] = useState(false)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const sorting = useMemo(() => sortToSortingState(sort), [sort])
  const rowIds = result.items.map((item) => item.id).join('|')
  const pageStart = result.total === 0 ? 0 : result.offset + 1
  const pageEnd = Math.min(result.offset + result.items.length, result.total)

  useEffect(() => {
    setRowSelection({})
  }, [rowIds])

  const columns = useMemo(() => {
    if (!onEditApplication) {
      return applicationColumns
    }

    return [
      ...applicationColumns,
      {
        id: 'actions',
        enableHiding: false,
        enableSorting: false,
        size: 56,
        header: 'Edit',
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Edit ${row.original.companyName}`}
            onClick={(event) => {
              event.stopPropagation()
              onEditApplication(row.original)
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        ),
      } satisfies ColumnDef<ApplicationListItem>,
    ]
  }, [onEditApplication])

  const table = useReactTable({
    data: result.items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualPagination: true,
    manualSorting: true,
    enableSortingRemoval: false,
    rowCount: result.total,
    state: {
      columnVisibility,
      rowSelection,
      sorting,
    },
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onSortingChange: (updater) => {
      onSortChange(sortingStateToSort(resolveUpdater(updater, sorting)))
    },
  })
  const rows = table.getRowModel().rows
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.id ?? index,
    getScrollElement: () => tableContainerRef.current,
    initialRect: {
      height: 420,
      width: 1000,
    },
    observeElementRect: (instance, callback) => {
      const scrollElement = instance.scrollElement
      let isActive = true

      const notifyRect = () => {
        if (isActive) {
          const rect = scrollElement?.getBoundingClientRect()
          callback({
            height: rect?.height || 420,
            width: rect?.width || 1000,
          })
        }
      }

      queueMicrotask(() => {
        notifyRect()
      })

      if (scrollElement && typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => notifyRect())
        observer.observe(scrollElement)

        return () => {
          isActive = false
          observer.disconnect()
        }
      }

      return () => {
        isActive = false
      }
    },
    observeElementOffset: (instance, callback) => {
      const scrollElement = instance.scrollElement
      let isActive = true

      if (!scrollElement) {
        queueMicrotask(() => {
          if (isActive) {
            callback(0, false)
          }
        })

        return () => {
          isActive = false
        }
      }

      const notifyOffset = (isScrolling: boolean) => {
        const offset = scrollElement.scrollTop

        queueMicrotask(() => {
          if (isActive) {
            callback(offset, isScrolling)
          }
        })
      }
      const handleScroll = () => notifyOffset(true)

      notifyOffset(false)
      scrollElement.addEventListener('scroll', handleScroll, { passive: true })

      return () => {
        isActive = false
        scrollElement.removeEventListener('scroll', handleScroll)
      }
    },
    overscan: ROW_OVERSCAN,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0
  const visibleColumnCount = table.getVisibleLeafColumns().length

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Applications</p>
          <p className="text-xs text-muted-foreground">
            Showing {pageStart}-{pageEnd} of {result.total}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {table.getSelectedRowModel().rows.length} selected
          </span>
          <div className="relative">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={columnsOpen}
              onClick={() => setColumnsOpen((current) => !current)}
            >
              Columns
            </Button>
            {columnsOpen ? (
              <div
                role="group"
                aria-label="Column visibility"
                className="absolute right-0 z-10 mt-2 grid min-w-40 gap-2 rounded-md border border-border bg-card p-3 shadow-sm"
              >
                {table
                  .getAllLeafColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => (
                    <label
                      key={column.id}
                      className="flex items-center gap-2 text-xs text-foreground"
                    >
                      <input
                        aria-label={`${getColumnLabel(column.id)} column`}
                        checked={column.getIsVisible()}
                        type="checkbox"
                        onChange={column.getToggleVisibilityHandler()}
                      />
                      {getColumnLabel(column.id)}
                    </label>
                  ))}
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Previous page"
            disabled={result.offset === 0}
            onClick={onPreviousPage}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Next page"
            disabled={!result.hasMore}
            onClick={onNextPage}
          >
            Next
          </Button>
        </div>
      </div>

      <div
        ref={tableContainerRef}
        role="region"
        aria-label="Applications table viewport"
        className="min-h-0 flex-1 overflow-auto"
      >
        <Table
          aria-label="Applications"
          className="table-fixed"
          style={{ minWidth: table.getTotalSize() }}
        >
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={getColumnChromeClassName(header.column.id)}
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-auto min-w-0 px-0 py-0 text-xs font-medium uppercase text-muted-foreground hover:bg-transparent hover:text-foreground"
                        aria-label={`Sort by ${getColumnLabel(header.column.id).toLowerCase()}`}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span aria-hidden="true">{getSortMark(header.column.getIsSorted())}</span>
                      </Button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="text-muted-foreground">
                  No applications found.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {paddingTop > 0 ? (
                  <TableRow aria-hidden="true">
                    <TableCell
                      colSpan={visibleColumnCount}
                      style={{ height: `${paddingTop}px`, padding: 0 }}
                    />
                  </TableRow>
                ) : null}
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index]

                  return (
                    <TableRow
                      key={row.id}
                      className={onOpenApplication ? 'cursor-pointer' : undefined}
                      data-state={row.getIsSelected() ? 'selected' : undefined}
                      onClick={() => onOpenApplication?.(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={getColumnChromeClassName(cell.column.id)}
                          style={{ width: cell.column.getSize() }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })}
                {paddingBottom > 0 ? (
                  <TableRow aria-hidden="true">
                    <TableCell
                      colSpan={visibleColumnCount}
                      style={{ height: `${paddingBottom}px`, padding: 0 }}
                    />
                  </TableRow>
                ) : null}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(current) : updater
}

function sortToSortingState(sort: ApplicationListSort): SortingState {
  if (sort === 'company_asc') {
    return [{ id: 'company', desc: false }]
  }

  if (sort === 'company_desc') {
    return [{ id: 'company', desc: true }]
  }

  if (sort === 'role_asc') {
    return [{ id: 'role', desc: false }]
  }

  if (sort === 'role_desc') {
    return [{ id: 'role', desc: true }]
  }

  if (sort === 'source_asc') {
    return [{ id: 'source', desc: false }]
  }

  if (sort === 'source_desc') {
    return [{ id: 'source', desc: true }]
  }

  if (sort === 'status_asc') {
    return [{ id: 'status', desc: false }]
  }

  if (sort === 'status_desc') {
    return [{ id: 'status', desc: true }]
  }

  if (sort === 'priority_asc') {
    return [{ id: 'priority', desc: false }]
  }

  if (sort === 'updated_asc') {
    return [{ id: 'updated', desc: false }]
  }

  if (sort === 'updated_desc') {
    return [{ id: 'updated', desc: true }]
  }

  return [{ id: 'priority', desc: true }]
}

function sortingStateToSort(sorting: SortingState): ApplicationListSort {
  const [nextSort] = sorting

  if (!nextSort) {
    return 'priority_desc'
  }

  if (nextSort.id === 'company') {
    return nextSort.desc ? 'company_desc' : 'company_asc'
  }

  if (nextSort.id === 'role') {
    return nextSort.desc ? 'role_desc' : 'role_asc'
  }

  if (nextSort.id === 'source') {
    return nextSort.desc ? 'source_desc' : 'source_asc'
  }

  if (nextSort.id === 'status') {
    return nextSort.desc ? 'status_desc' : 'status_asc'
  }

  if (nextSort.id === 'updated') {
    return nextSort.desc ? 'updated_desc' : 'updated_asc'
  }

  if (nextSort.id === 'priority') {
    return nextSort.desc ? 'priority_desc' : 'priority_asc'
  }

  return 'priority_desc'
}

function getColumnLabel(columnId: string) {
  if (columnId === 'priority') {
    return 'Score'
  }

  if (columnId === 'select') {
    return 'Select'
  }

  return columnId.charAt(0).toUpperCase() + columnId.slice(1)
}

function getSortMark(sortState: false | 'asc' | 'desc') {
  if (sortState === 'asc') {
    return '↑'
  }

  if (sortState === 'desc') {
    return '↓'
  }

  return ''
}

function getStatusVariant(status: ApplicationListItem['status']): BadgeProps['variant'] {
  if (status === 'submitted' || status === 'already_applied') {
    return 'success'
  }

  if (status === 'needs_user_info') {
    return 'warning'
  }

  return 'outline'
}

function getColumnChromeClassName(columnId: string) {
  if (columnId === 'actions') {
    return undefined
  }

  if (columnId === 'select') {
    return 'w-11 px-0 text-center'
  }

  return undefined
}

interface SelectionCheckboxProps {
  'aria-label': string
  checked: boolean
  onChange: ChangeEventHandler<HTMLInputElement>
}

function SelectionCheckbox({
  checked,
  onChange,
  ...props
}: SelectionCheckboxProps) {
  return (
    <input
      {...props}
      checked={checked}
      className="mx-auto block h-4 w-4 rounded border-border bg-background accent-primary"
      type="checkbox"
      onChange={onChange}
      onClick={(event) => event.stopPropagation()}
    />
  )
}

function formatScore(application: ApplicationListItem) {
  return application.currentPriorityScore === null
    ? 'Unscored'
    : `${application.currentPriorityScore}/10`
}

function formatApplicationTiming(application: ApplicationListItem) {
  if (application.term) {
    return application.term
  }

  const termsLabel = formatJobTerms(application.terms)
  return termsLabel || 'Unknown'
}

function formatDate(value: string) {
  return value.slice(0, 10)
}

export { ApplicationTable, ROW_HEIGHT }
