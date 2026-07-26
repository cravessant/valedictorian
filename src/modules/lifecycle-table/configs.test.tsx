import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaptureListPresentation, ValedictorianWorkspaceClientV2 } from '@sparxie/sdk'

import { LifecycleTable } from './lifecycle-table'
import { captureConfig, createCaptureConfig } from './configs/capture-config'
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

function makeClient(): WorkspaceClientLike & Pick<ValedictorianWorkspaceClientV2, 'captures' | 'jobs' | 'opportunities' | 'applications'> {
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
  } as unknown as WorkspaceClientLike & Pick<ValedictorianWorkspaceClientV2, 'captures' | 'jobs' | 'opportunities' | 'applications'>
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
    const onViewResolution = vi.fn()
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

function captureWithIntent(
  captureId: string,
  kind: 'resolve_duplicate_job' | 'resolve_company_assignment',
) {
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
      ? { kind, conflictingJobIds: ['job-duplicate'], supportedActions: ['attach'] }
      : { kind, jobId: 'job-assignment', currentCompanyId: 'company-assignment' },
  }
}
