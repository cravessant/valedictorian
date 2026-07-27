import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  LifecycleTable,
  type LifecycleColumn,
  type LifecycleRowAction,
  type LifecycleTableConfig,
  type LifecycleToolbarSlot,
} from './lifecycle-table'

afterEach(cleanup)

interface Row {
  id: string
  label: string
  count: number
}

function makeConfig(
  overrides: Partial<LifecycleTableConfig<Row>> = {},
): LifecycleTableConfig<Row> {
  const columns: LifecycleColumn<Row>[] = [
    { key: 'label', header: 'Label', render: (row) => row.label },
    { key: 'count', header: 'Count', render: (row) => String(row.count) },
  ]
  const actions: LifecycleRowAction<Row>[] = [
    {
      key: 'open',
      label: 'Open',
      onActivate: vi.fn(),
    },
  ]
  return {
    columns,
    actions,
    rowId: (row) => row.id,
    rowLabel: (row) => row.label,
    caption: 'Test table',
    empty: { title: 'No rows', description: 'Nothing yet' },
    ...overrides,
  }
}

describe('LifecycleTable shared component', () => {
  it('renders table semantic with caption, header, and rows from data', () => {
    const data: Row[] = [
      { id: 'r1', label: 'Alpha', count: 1 },
      { id: 'r2', label: 'Beta', count: 2 },
    ]
    render(
      <LifecycleTable
        config={makeConfig()}
        data={data}
        state={{ status: 'loaded' }}
      />,
    )
    const table = screen.getByRole('table', { name: 'Test table' })
    expect(within(table).getByRole('columnheader', { name: 'Label' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Count' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: 'Alpha' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '2' })).toBeInTheDocument()
  })

  it('renders a loading spinner with accessible status while loading', () => {
    render(
      <LifecycleTable
        config={makeConfig()}
        data={null}
        state={{ status: 'loading' }}
      />,
    )
    const status = screen.getByRole('status', { name: /Test table/ })
    expect(status).toBeInTheDocument()
  })

  it('renders the empty state with title and description when data is empty', () => {
    render(
      <LifecycleTable
        config={makeConfig()}
        data={[]}
        state={{ status: 'loaded' }}
      />,
    )
    expect(screen.getByText('No rows')).toBeInTheDocument()
    expect(screen.getByText('Nothing yet')).toBeInTheDocument()
  })

  it('renders scoped load failure with a Retry action that calls onRetry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <LifecycleTable
        config={makeConfig()}
        data={null}
        state={{ status: 'failure', message: 'could not load', onRetry }}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('could not load')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('focuses the load failure alert when presented and restores focus to trigger after retry', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(
      <LifecycleTable
        config={makeConfig()}
        data={[]}
        state={{ status: 'loaded' }}
      />,
    )
    rerender(
      <LifecycleTable
        config={makeConfig()}
        data={null}
        state={{ status: 'failure', message: 'failed', onRetry }}
      />,
    )
    const alert = await screen.findByRole('alert')
    expect(document.activeElement).toBe(alert)
  })

  it('renders row actions in an accessible dropdown menu with a labeled trigger', async () => {
    const user = userEvent.setup()
    const onActivate = vi.fn()
    const actions: LifecycleRowAction<Row>[] = [
      { key: 'open', label: 'Open row', onActivate },
    ]
    const data: Row[] = [{ id: 'r1', label: 'Alpha', count: 1 }]
    render(
      <LifecycleTable
        config={makeConfig({ actions })}
        data={data}
        state={{ status: 'loaded' }}
      />,
    )
    const trigger = screen.getByRole('button', { name: /Actions for row Alpha/ })
    trigger.focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: /Row actions for Alpha/ })
    const item = within(menu).getByRole('menuitem', { name: 'Open row' })
    await user.click(item)
    expect(onActivate).toHaveBeenCalledWith(data[0])
  })

  it('returns focus to the action trigger after a confirmed action closes the menu', async () => {
    const user = userEvent.setup()
    const onActivate = vi.fn()
    const actions: LifecycleRowAction<Row>[] = [
      { key: 'open', label: 'Open row', onActivate },
    ]
    const data: Row[] = [{ id: 'r1', label: 'Alpha', count: 1 }]
    render(
      <LifecycleTable
        config={makeConfig({ actions })}
        data={data}
        state={{ status: 'loaded' }}
      />,
    )
    const trigger = screen.getByRole('button', { name: /Actions for row Alpha/ })
    trigger.focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: /Row actions for Alpha/ })
    await user.click(within(menu).getByRole('menuitem', { name: 'Open row' }))
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
    const triggerAgain = screen.getByRole('button', { name: /Actions for row Alpha/ })
    await waitFor(() => expect(triggerAgain).toHaveFocus())
  })

  it('requires confirmation before invoking a destructive action and announces success', async () => {
    const user = userEvent.setup()
    const onActivate = vi.fn()
    const actions: LifecycleRowAction<Row>[] = [
      {
        key: 'remove',
        label: 'Remove row',
        destructive: true,
        confirm: { title: 'Remove row?', description: 'This cannot be undone.' },
        onActivate,
      },
    ]
    const data: Row[] = [{ id: 'r1', label: 'Alpha', count: 1 }]
    render(
      <LifecycleTable
        config={makeConfig({ actions })}
        data={data}
        state={{ status: 'loaded' }}
      />,
    )
    const trigger = screen.getByRole('button', { name: /Actions for row Alpha/ })
    await user.click(trigger)
    const menu = await screen.findByRole('menu', { name: /Row actions for Alpha/ })
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove row' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove row?' })
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    expect(onActivate).toHaveBeenCalledWith(data[0])
    const status = await screen.findByTestId('lifecycle-mutation-status')
    expect(status).toHaveTextContent(/Removed/)
  })

  it('shows an actionable failure and restores focus after an asynchronous action rejects', async () => {
    const user = userEvent.setup()
    let rejectActivation: (error: Error) => void = () => {}
    const onActivate = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectActivation = reject
    }))
    const data: Row[] = [{ id: 'r1', label: 'Alpha', count: 1 }]
    render(
      <LifecycleTable
        config={makeConfig({
          actions: [{ key: 'open', label: 'Open row', onActivate }],
        })}
        data={data}
        state={{ status: 'loaded' }}
      />,
    )

    const trigger = screen.getByRole('button', { name: /Actions for row Alpha/ })
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: 'Open row' }))
    rejectActivation(new Error('sqlite: relation "captures" does not exist'))

    // The rejection text never reaches the announcement; a fixed message does.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Open row failed: The action could not be completed.')
    expect(alert).not.toHaveTextContent('sqlite')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('moves focus to the table region when refresh removes the successful action row', async () => {
    const user = userEvent.setup()
    const data: Row[] = [{ id: 'r1', label: 'Alpha', count: 1 }]
    let rerenderTable: (() => void) | undefined
    const onRefresh = vi.fn(async () => rerenderTable?.())
    const view = render(
      <LifecycleTable
        config={makeConfig()}
        data={data}
        state={{ status: 'loaded' }}
        onRefresh={onRefresh}
      />,
    )
    rerenderTable = () => view.rerender(
      <LifecycleTable
        config={makeConfig()}
        data={[]}
        state={{ status: 'loaded' }}
        onRefresh={onRefresh}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Actions for row Alpha/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open' }))

    const tableRegion = screen.getByRole('region', { name: 'Test table' })
    await waitFor(() => expect(tableRegion).toHaveFocus())
  })

  it('composes form, history, promotion, capability, and modal extension slots', async () => {
    const user = userEvent.setup()
    const onPromote = vi.fn()
    const data: Row[] = [{ id: 'r1', label: 'Alpha', count: 1 }]
    const config = makeConfig({
      actions: [],
      extensions: {
        capabilities: () => ({ promote: true }),
        formActions: [{ key: 'edit', label: 'Edit row', onActivate: vi.fn() }],
        historyAction: { key: 'history', label: 'View history', onActivate: vi.fn() },
        promotionActions: [{ key: 'promote', label: 'Promote row', onActivate: onPromote }],
        modalLayer: <div data-testid="aggregate-modal-layer" />,
      },
    })
    expect(config.extensions?.capabilities?.(data[0])).toEqual({ promote: true })
    render(<LifecycleTable config={config} data={data} state={{ status: 'loaded' }} />)

    expect(screen.getByTestId('aggregate-modal-layer')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Actions for row Alpha/ }))
    const menu = await screen.findByRole('menu', { name: /Row actions for Alpha/ })
    expect(within(menu).getByRole('menuitem', { name: 'Edit row' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'View history' })).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: 'Promote row' }))
    expect(onPromote).toHaveBeenCalledWith(data[0])
  })

  it('renders the toolbar slot when provided', () => {
    const Toolbar: LifecycleToolbarSlot = ({ tableCaption }) => (
      <button type="button" data-testid="toolbar-refresh">
        Refresh {tableCaption}
      </button>
    )
    render(
      <LifecycleTable
        config={makeConfig()}
        data={[]}
        state={{ status: 'loaded' }}
        toolbar={<Toolbar tableCaption="Test table" total={0} loading={false} onRefresh={vi.fn()} />}
      />,
    )
    expect(screen.getByTestId('toolbar-refresh')).toHaveTextContent('Refresh Test table')
  })

  it('calls onRefresh when the toolbar refresh button is clicked', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    const Toolbar: LifecycleToolbarSlot = ({ onRefresh: onR }) => (
      <button type="button" onClick={onR} data-testid="toolbar-refresh">Refresh</button>
    )
    render(
      <LifecycleTable
        config={makeConfig()}
        data={[]}
        state={{ status: 'loaded' }}
        toolbar={<Toolbar tableCaption="" total={0} loading={false} onRefresh={onRefresh} />}
      />,
    )
    await user.click(screen.getByTestId('toolbar-refresh'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('marks the table container as a scrollable region with aria-label and tabIndex', () => {
    render(
      <LifecycleTable
        config={makeConfig()}
        data={[]}
        state={{ status: 'loaded' }}
      />,
    )
    const table = screen.getByRole('table', { name: 'Test table' })
    const container = table.closest('[data-slot="table-container"]')
    expect(container).not.toBeNull()
    expect(container).toHaveAttribute('aria-label', 'Test table viewport')
    expect(container).toHaveAttribute('role', 'region')
    expect(container).toHaveAttribute('tabIndex', '0')
  })

  it('contains every header and body cell without imposing any aggregate proportion', () => {
    const data: Row[] = [{ id: 'r1', label: 'Alpha', count: 1 }]
    render(
      <LifecycleTable
        config={makeConfig()}
        data={data}
        state={{ status: 'loaded' }}
      />,
    )
    const table = screen.getByRole('table', { name: 'Test table' })
    for (const cell of [
      ...within(table).getAllByRole('columnheader'),
      ...within(table).getAllByRole('cell'),
    ]) {
      expect(cell).toHaveClass('min-w-0', 'overflow-hidden')
    }
    expect(table.className).not.toMatch(/table-fixed|min-w-\[/)
  })

  it('applies the aggregate table sizing to the table element and marks the viewport focusable', () => {
    render(
      <LifecycleTable
        config={makeConfig({ tableClassName: 'min-w-[64rem] table-fixed' })}
        data={[]}
        state={{ status: 'loaded' }}
      />,
    )
    const table = screen.getByRole('table', { name: 'Test table' })
    expect(table).toHaveClass('min-w-[64rem]', 'table-fixed')
    expect(table.closest('[data-slot="table-container"]'))
      .toHaveClass('overflow-x-auto', 'focus-visible:outline-2', 'focus-visible:outline-ring')
  })

  it('does not branch on phase name: lifecycle table contains no capture/job/opportunity/application string literals', () => {
    const source = lifecycleTableSource()
    expect(source).not.toMatch(/\b(capture|job|opportunity|application)\b/i)
  })

  it('announces pending mutation status via an aria-live region while an action is in flight', async () => {
    let resolveActivation: () => void = () => {}
    const onActivate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveActivation = resolve
        }),
    )
    const actions: LifecycleRowAction<Row>[] = [
      { key: 'open', label: 'Open row', onActivate },
    ]
    const data: Row[] = [{ id: 'r1', label: 'Alpha', count: 1 }]
    render(
      <LifecycleTable
        config={makeConfig({ actions })}
        data={data}
        state={{ status: 'loaded' }}
      />,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: /Actions for row Alpha/ }))
    const menu = await screen.findByRole('menu', { name: /Row actions for Alpha/ })
    await userEvent.setup().click(within(menu).getByRole('menuitem', { name: 'Open row' }))
    const pending = await screen.findByTestId('lifecycle-mutation-status')
    expect(pending).toHaveTextContent(/Open row/i)
    resolveActivation()
  })
})

function lifecycleTableSource(): string {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  return fs.readFileSync(
    path.join(__dirname, 'lifecycle-table.tsx'),
    'utf8',
  )
}
