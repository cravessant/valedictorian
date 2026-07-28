import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CaptureListPresentation,
  JobId,
  ValedictorianWorkspaceClientV2,
} from '@sparxie/sdk'

import { LifecycleTable } from './lifecycle-table'
import {
  captureColumnWidths,
  captureConfig,
  createCaptureConfig,
} from './configs/capture-config'
import {
  captureContainmentDestinationHost,
  captureContainmentLinkedJobLabel,
  captureContainmentRows,
} from './capture-containment.fixture'
import { jobConfig, createJobConfig } from './configs/job-config'
import { opportunityConfig, createOpportunityConfig } from './configs/opportunity-config'
import { applicationConfig, createApplicationConfig } from './configs/application-config'

/** The canonical page boundaries a single-page lifecycle list reports. */
const emptyPageInfo = {
  startCursor: null,
  endCursor: null,
  hasPreviousPage: false,
  hasNextPage: false,
} as const


afterEach(cleanup)

interface WorkspaceClientLike {
  captures: { list: (input?: unknown) => Promise<unknown> }
  captureResolutionV2: { list: (input?: unknown) => Promise<unknown> }
  jobs: { list: (input?: unknown) => Promise<unknown> }
  opportunities: { list: (input?: unknown) => Promise<unknown> }
  applications: { list: (input?: unknown) => Promise<unknown> }
}

type LifecycleTableTestClient = WorkspaceClientLike & Pick<
  ValedictorianWorkspaceClientV2,
  'captures' | 'captureResolutionV2' | 'jobs' | 'opportunities' | 'applications'
>

function makeClient(): LifecycleTableTestClient {
  return {
    captures: { list: vi.fn(async () => ({ items: [], pageInfo: emptyPageInfo })) },
    captureResolutionV2: {
      list: vi.fn(async () => ({
        items: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasPreviousPage: false,
          hasNextPage: false,
        },
        totalCount: 0,
      })),
    },
    jobs: { list: vi.fn(async () => ({ items: [], pageInfo: emptyPageInfo })) },
    opportunities: { list: vi.fn(async () => ({ items: [], pageInfo: emptyPageInfo })) },
    applications: { list: vi.fn(async () => ({ items: [], pageInfo: emptyPageInfo })) },
  } as unknown as LifecycleTableTestClient
}

describe('lifecycle typed configs', () => {
  it('captureConfig exposes the canonical presentation and calls captureResolutionV2.list', async () => {
    const client = makeClient()
    await captureConfig.list(client)
    expect(client.captureResolutionV2.list).toHaveBeenCalledWith({
      filter: 'all',
      sort: 'observed_desc',
      limit: 50,
    })
    const config = captureConfig.table
    expect(config.caption).toMatch(/Captures/)
    expect(config.columns.length).toBeGreaterThan(0)
    const headerLabels = config.columns.map((c) => c.header)
    expect(headerLabels).toEqual([
      'Lead',
      'Source',
      'Destination',
      'Status',
      'Linked Job',
      'Observed',
      'Next action',
    ])
    expect(config.empty.title).not.toBe('')
  })

  it('jobConfig exposes Job labels, columns, and calls workspace.jobs.list', async () => {
    const client = makeClient()
    await jobConfig.list(client)
    expect(client.jobs.list).toHaveBeenCalled()
    const config = jobConfig.table
    expect(config.caption).toMatch(/Jobs/)
    const headerLabels = config.columns.map((c) => c.header)
    expect(headerLabels).toContain('Company')
    expect(headerLabels).toContain('Role')
    expect(headerLabels).toContain('Availability')
  })

  it('opportunityConfig exposes Opportunity labels, columns, and calls workspace.opportunities.list', async () => {
    const client = makeClient()
    await opportunityConfig.list(client)
    expect(client.opportunities.list).toHaveBeenCalled()
    const config = opportunityConfig.table
    expect(config.caption).toMatch(/Opportunities/)
    const headerLabels = config.columns.map((c) => c.header)
    expect(headerLabels).toContain('Fit')
    expect(headerLabels).toContain('Disposition')
  })

  it('applicationConfig exposes Application labels, columns, and calls workspace.applications.list', async () => {
    const client = makeClient()
    await applicationConfig.list(client)
    expect(client.applications.list).toHaveBeenCalled()
    const config = applicationConfig.table
    expect(config.caption).toMatch(/Applications/)
    const headerLabels = config.columns.map((c) => c.header)
    expect(headerLabels).toContain('Status')
    expect(headerLabels).toContain('Company')
  })

  it('does not expose inert row actions before aggregate modal behavior is wired', () => {
    expect(captureConfig.table.actions).toEqual([])
    expect(jobConfig.table.actions).toEqual([])
    expect(opportunityConfig.table.actions).toEqual([])
    expect(applicationConfig.table.actions).toEqual([])
  })

  it('lets every aggregate compose typed capability, form, history, promotion, and modal extensions', () => {
    const extensionSlots = {
      capabilities: () => ({ edit: true }),
      formActions: [],
      historyAction: { key: 'history', label: 'History', onActivate: () => {} },
      promotionActions: [],
      modalLayer: <div />,
    }
    const configs = [
      createJobConfig(extensionSlots),
      createOpportunityConfig(extensionSlots),
      createApplicationConfig(extensionSlots),
    ]
    for (const config of configs) {
      expect(config.table.extensions?.capabilities).toBeTypeOf('function')
      expect(config.table.extensions?.historyAction?.key).toBe('history')
      expect(config.table.extensions?.modalLayer).toBeDefined()
    }
  })

  it('renders the Capture table through the shared LifecycleTable with sample items', () => {
    const items = [{
      captureId: 'cap-1',
      captureRevision: 1,
      observedAt: '2025-01-01T00:00:00Z',
      lead: { roleTitle: 'Engineer', companyName: 'Acme', fallbackLabel: 'Acme lead' },
      source: { displayName: 'Jobright', provider: 'jobright' },
      destination: { state: 'resolving' as const, displayHost: null },
      readiness: 'ready' as const,
      processingSummary: 'processing' as const,
      activeProcessing: true,
      linkedJob: null,
      primaryIntent: null,
    }]
    render(
      <LifecycleTable
        config={captureConfig.table}
        data={items}
        state={{ status: 'loaded' }}
      />,
    )
    const table = screen.getByRole('table', { name: /Captures/ })
    expect(within(table).getByText('Engineer')).toBeInTheDocument()
    expect(within(table).getByText('Jobright')).toBeInTheDocument()
  })

  it('routes duplicate and Company-assignment resolution intents into the completion flow', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    const items = [
      captureWithIntent('capture-duplicate', 'resolve_duplicate_job'),
      captureWithIntent('capture-assignment', 'resolve_company_assignment'),
    ]
    render(
      <LifecycleTable
        config={createCaptureConfig({ onComplete }).table}
        data={items}
        state={{ status: 'loaded' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Resolve duplicate Job' }))
    await user.click(screen.getByRole('button', { name: 'Resolve company assignment' }))

    expect(onComplete).toHaveBeenNthCalledWith(1, 'capture-duplicate', {
      kind: 'resolve_duplicate_job',
      conflictingJobIds: ['job-duplicate'],
      supportedActions: ['attach'],
    }, items[0])
    expect(onComplete).toHaveBeenNthCalledWith(2, 'capture-assignment', {
      kind: 'resolve_company_assignment',
      jobId: 'job-assignment',
      currentCompanyId: 'company-assignment',
    }, items[1])
  })

  it('exposes read-only resolution details for destination outcomes no completion intent explains', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    const onViewResolution = vi.fn((_row: CaptureListPresentation) => {})
    const items = [
      destinationOutcome('capture-authenticate', 'blocked', {
        kind: 'authenticate_provider',
        connectorInstanceId: 'connector-1',
      }),
      destinationOutcome('capture-correct', 'unavailable', { kind: 'correct_capture' }),
      destinationOutcome('capture-security', 'blocked', null),
      destinationOutcome('capture-completable', 'blocked', { kind: 'complete_job_information' }),
    ]
    render(
      <LifecycleTable
        config={createCaptureConfig({ onComplete, onViewResolution }).table}
        data={items}
        state={{ status: 'loaded' }}
      />,
    )

    const table = screen.getByRole('table', { name: /Captures/ })
    expect(within(table).getAllByText('Needs attention').length).toBeGreaterThan(0)
    const details = within(table).getAllByRole('button', { name: 'View resolution details' })
    expect(details).toHaveLength(3)
    for (const detail of details) await user.click(detail)

    expect(onViewResolution.mock.calls.map(([row]: [CaptureListPresentation]) => row.captureId))
      .toEqual(['capture-authenticate', 'capture-correct', 'capture-security'])
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('withholds resolution details for resolving destinations and non-ready Captures', () => {
    const items = [
      destinationOutcome('capture-resolving', 'resolving', null),
      { ...destinationOutcome('capture-removed', 'blocked', null), readiness: 'removed' as const },
      {
        ...destinationOutcome('capture-pending', 'unavailable', null),
        readiness: 'materialization_pending' as const,
      },
    ]
    render(
      <LifecycleTable
        config={createCaptureConfig({ onViewResolution: vi.fn() }).table}
        data={items}
        state={{ status: 'loaded' }}
      />,
    )

    expect(screen.queryByRole('button', { name: 'View resolution details' }))
      .not.toBeInTheDocument()
  })
})

describe('Capture column containment', () => {
  const clampedControlNames = [
    captureContainmentLinkedJobLabel,
    'View resolution details',
    'Complete Job information',
  ] as const

  function renderContainmentRows(options: Parameters<typeof createCaptureConfig>[0] = {}) {
    render(
      <LifecycleTable
        config={createCaptureConfig({
          onComplete: vi.fn(),
          onOpenJob: vi.fn(),
          onViewResolution: vi.fn(),
          ...options,
        }).table}
        data={captureContainmentRows}
        state={{ status: 'loaded' }}
      />,
    )
    return screen.getByRole('button', { name: captureContainmentLinkedJobLabel })
  }

  it('budgets every Capture column under a fixed layout with a useful minimum width', () => {
    const config = captureConfig.table
    expect(config.tableClassName).toContain('table-fixed')
    expect(config.tableClassName).toMatch(/min-w-\[\d+rem\]/)
    expect(Object.fromEntries(config.columns.map((column) => [column.key, column.className])))
      .toEqual(captureColumnWidths)

    const share = (key: keyof typeof captureColumnWidths) =>
      Number(/\[(\d+)%\]/.exec(captureColumnWidths[key])?.[1])
    const compact = ['source', 'destination', 'status', 'observedAt', 'next-action'] as const
    for (const key of compact) {
      expect(share('lead')).toBeGreaterThan(share(key))
      expect(share('linked-job')).toBeGreaterThan(share(key))
    }
    const keys = Object.keys(captureColumnWidths) as (keyof typeof captureColumnWidths)[]
    expect(keys.reduce((total, key) => total + share(key), 0)).toBeLessThanOrEqual(100)
  })

  it('clamps Capture values to two lines and breaks unbroken hosts inside their own cell', () => {
    const linkedJob = renderContainmentRows()

    expect(linkedJob.firstElementChild)
      .toHaveClass('line-clamp-2', 'break-words', 'whitespace-normal')
    expect(screen.getByText(captureContainmentDestinationHost))
      .toHaveClass('line-clamp-2', '[overflow-wrap:anywhere]')
    for (const cell of screen.getAllByRole('cell')) {
      expect(cell).toHaveClass('min-w-0', 'overflow-hidden')
    }
  })

  it('keeps Observed and Next action independently legible beside a long linked-Job value', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    renderContainmentRows({ onComplete })

    const rows = screen.getAllByRole('row')
    const linkedJobRow = rows.find((row) => within(row).queryByRole('button', {
      name: captureContainmentLinkedJobLabel,
    }))
    expect(within(linkedJobRow!).getByText(/2026/)).toBeInTheDocument()
    expect(within(linkedJobRow!).getByText('View Job')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Complete Job information' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it.each(clampedControlNames)('reveals the full "%s" label on keyboard focus', async (name) => {
    renderContainmentRows()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    const control = screen.getByRole('button', { name })
    control.focus()
    expect(control).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(name)
  })

  it.each(clampedControlNames)('reveals the full "%s" label on pointer hover', async (name) => {
    const user = userEvent.setup()
    renderContainmentRows()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.hover(screen.getByRole('button', { name }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(name)
  })

  it('keeps the activation payload and focus of every disclosed Capture control', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    const onOpenJob = vi.fn()
    const onViewResolution = vi.fn((_row: CaptureListPresentation) => {})
    const linkedJob = renderContainmentRows({ onComplete, onOpenJob, onViewResolution })

    await user.click(linkedJob)
    expect(onOpenJob).toHaveBeenCalledWith(
      'job-long-linked',
      'capture-job-link-capture-long-linked-job',
    )
    expect(screen.getByRole('button', { name: captureContainmentLinkedJobLabel }))
      .toBe(linkedJob)

    await user.click(screen.getByRole('button', { name: 'Complete Job information' }))
    expect(onComplete).toHaveBeenCalledWith(
      'capture-needs-information',
      { kind: 'complete_job_information' },
      captureContainmentRows[1],
    )

    await user.click(screen.getByRole('button', { name: 'View resolution details' }))
    expect(onViewResolution).toHaveBeenCalledWith(captureContainmentRows[2])
  })
})

function destinationOutcome(
  captureId: string,
  state: CaptureListPresentation['destination']['state'],
  primaryIntent: CaptureListPresentation['primaryIntent'],
): CaptureListPresentation {
  return {
    captureId,
    captureRevision: 1,
    observedAt: '2025-01-01T00:00:00Z',
    lead: { roleTitle: 'Engineer', companyName: 'Acme', fallbackLabel: 'Acme lead' },
    source: { displayName: 'Jobright', provider: 'jobright' },
    destination: { state, displayHost: null },
    readiness: 'ready',
    processingSummary: 'blocked',
    activeProcessing: false,
    linkedJob: null,
    primaryIntent,
  }
}

/** Readable non-UUID identifiers keep these UI assertions legible. */
function testJobId(value: string) {
  return value as JobId
}

function captureWithIntent(
  captureId: string,
  kind: 'resolve_duplicate_job' | 'resolve_company_assignment',
): CaptureListPresentation {
  return {
    captureId,
    captureRevision: 1,
    observedAt: '2025-01-01T00:00:00Z',
    lead: { roleTitle: 'Engineer', companyName: 'Acme', fallbackLabel: 'Acme lead' },
    source: { displayName: 'Jobright', provider: 'jobright' },
    destination: { state: 'resolved' as const, displayHost: 'jobs.example.com' },
    readiness: 'ready' as const,
    processingSummary: 'blocked' as const,
    activeProcessing: false,
    linkedJob: null,
    primaryIntent: kind === 'resolve_duplicate_job'
      ? { kind, conflictingJobIds: [testJobId('job-duplicate')], supportedActions: ['attach'] }
      : {
          kind,
          jobId: testJobId('job-assignment'),
          currentCompanyId: 'company-assignment',
        },
  }
}
