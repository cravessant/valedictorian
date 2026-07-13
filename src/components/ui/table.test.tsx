import { cleanup, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table'

afterEach(cleanup)

describe('Table', () => {
  it('composes a semantic table with caption, data slots, forwarding, and overflow container', () => {
    const tableRef = createRef<HTMLTableElement>()
    const rowRef = createRef<HTMLTableRowElement>()

    render(
      <Table
        ref={tableRef}
        aria-label="Connector status"
        className="min-w-[640px] table-fixed"
        data-testid="status-table"
      >
        <TableCaption className="text-xs">Latest connector health</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-40">Connector</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow ref={rowRef} data-state="selected" data-testid="status-row">
            <TableCell className="font-medium">Jobright</TableCell>
            <TableCell>healthy</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter data-testid="status-footer">
          <TableRow>
            <TableCell colSpan={2}>1 connector</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    )

    const table = screen.getByRole('table', { name: 'Connector status' })
    expect(table).toHaveAttribute('data-slot', 'table')
    expect(table).toHaveAttribute('data-testid', 'status-table')
    expect(table).toHaveClass('w-full', 'caption-bottom', 'text-sm', 'min-w-[640px]', 'table-fixed')
    expect(tableRef.current).toBe(table)

    const container = table.parentElement
    expect(container).not.toBeNull()
    expect(container).toHaveAttribute('data-slot', 'table-container')
    expect(container).toHaveClass('relative', 'w-full', 'overflow-x-auto')

    const caption = within(table).getByText('Latest connector health')
    expect(caption.tagName).toBe('CAPTION')
    expect(caption).toHaveAttribute('data-slot', 'table-caption')
    expect(caption).toHaveClass('text-muted-foreground', 'text-xs')

    const header = table.querySelector('[data-slot="table-header"]')
    expect(header).not.toBeNull()
    expect(header?.tagName).toBe('THEAD')

    const body = table.querySelector('[data-slot="table-body"]')
    expect(body).not.toBeNull()
    expect(body?.tagName).toBe('TBODY')

    const footer = screen.getByTestId('status-footer')
    expect(footer).toHaveAttribute('data-slot', 'table-footer')
    expect(footer.tagName).toBe('TFOOT')
    expect(within(footer).getByText('1 connector')).toBeInTheDocument()

    const head = within(table).getByRole('columnheader', { name: 'Connector' })
    expect(head).toHaveAttribute('data-slot', 'table-head')
    expect(head).toHaveClass(
      'h-10',
      'px-3',
      'text-xs',
      'font-medium',
      'uppercase',
      'text-muted-foreground',
      'w-40',
    )

    const row = screen.getByTestId('status-row')
    expect(row).toHaveAttribute('data-slot', 'table-row')
    expect(row).toHaveAttribute('data-state', 'selected')
    expect(row).toHaveClass('border-b', 'border-border', 'hover:bg-muted/45')
    expect(rowRef.current).toBe(row)

    const cell = within(row).getByRole('cell', { name: 'Jobright' })
    expect(cell).toHaveAttribute('data-slot', 'table-cell')
    expect(cell).toHaveClass('px-3', 'py-3', 'align-middle', 'text-sm', 'font-medium')
  })
})
