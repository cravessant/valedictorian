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
  it('composes a semantic table with caption, refs, and a labeled container region', () => {
    const tableRef = createRef<HTMLTableElement>()
    const rowRef = createRef<HTMLTableRowElement>()

    render(
      <Table
        ref={tableRef}
        aria-label="Connector status"
        containerProps={{
          'aria-label': 'Connector status viewport',
          role: 'region',
          tabIndex: 0,
        }}
        data-testid="status-table"
      >
        <TableCaption>Latest connector health</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Connector</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow ref={rowRef} data-testid="status-row">
            <TableCell>Jobright</TableCell>
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
    expect(table).toHaveAttribute('data-testid', 'status-table')
    expect(tableRef.current).toBe(table)

    const container = table.parentElement
    expect(container).not.toBeNull()
    expect(container).toHaveAttribute('aria-label', 'Connector status viewport')
    expect(container).toHaveAttribute('role', 'region')
    expect(container).toHaveAttribute('tabIndex', '0')

    const caption = within(table).getByText('Latest connector health')
    expect(caption.tagName).toBe('CAPTION')

    expect(table.querySelector('thead')).not.toBeNull()
    expect(table.querySelector('tbody')).not.toBeNull()

    const footer = screen.getByTestId('status-footer')
    expect(footer.tagName).toBe('TFOOT')
    expect(within(footer).getByText('1 connector')).toBeInTheDocument()

    expect(within(table).getByRole('columnheader', { name: 'Connector' })).toBeInTheDocument()

    const row = screen.getByTestId('status-row')
    expect(rowRef.current).toBe(row)
    expect(within(row).getByRole('cell', { name: 'Jobright' })).toBeInTheDocument()
  })
})
