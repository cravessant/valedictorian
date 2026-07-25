import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaptureListPresentation, Job, ValedictorianWorkspaceClientV2 } from '@sparxie/sdk'

import { LifecycleWorkbench } from './lifecycle-workbench'
import { useWorkspaceLocation } from '@/app/use-workspace-location'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/components/ui/use-toast', () => ({ toast }))

const originalMatchMedia = window.matchMedia
afterEach(() => {
  cleanup()
  toast.mockReset()
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
  window.matchMedia = originalMatchMedia
  window.history.replaceState(null, '', '/')
})

interface TestPage {
  items: unknown[]
  limit: number
  nextCursor: string | null
}

function emptyPage(): TestPage {
  return { items: [], limit: 50, nextCursor: null }
}

function capturePage(items: CaptureListPresentation[] = []) {
  return {
    items,
    pageInfo: {
      startCursor: items.length > 0 ? 'start' : null,
      endCursor: items.length > 0 ? 'end' : null,
      hasPreviousPage: false,
      hasNextPage: false,
    },
    totalCount: items.length,
  }
}

function makeClient() {
  const removeCapture = vi.fn(async () => ({
    status: 'removed' as const,
    id: 'capture-remove',
    choice: 'reject_if_dependents' as const,
    removedAt: '2026-07-24T00:00:00Z',
    affectedDependentIds: [],
    audit: { actor: 'desktop' as const, timestamp: '2026-07-24T00:00:00Z' },
  }))
  const lists = {
    captures: vi.fn(async (_input?: unknown) => capturePage()),
    jobs: vi.fn(async (_input?: unknown) => emptyPage()),
    opportunities: vi.fn(async (_input?: unknown) => emptyPage()),
    applications: vi.fn(async (_input?: unknown) => emptyPage()),
  }
  const client = {
    captures: {
      list: lists.captures,
      remove: removeCapture,
    },
    captureResolutionV2: {
      list: lists.captures,
      get: vi.fn(),
      complete: vi.fn(),
    },
    jobs: {
      list: lists.jobs,
      get: vi.fn(async (jobId: string) => ({ id: jobId, factsRevision: 1, removedAt: null })),
    },
    companies: {
      previewMatches: vi.fn().mockResolvedValue({ items: [], truncated: false }),
      search: vi.fn().mockResolvedValue({ items: [], truncated: false }),
      lookup: vi.fn(async (companyId: string) => ({
        requested: {
          id: companyId,
          revision: 1,
          displayName: 'Assigned Company',
          status: 'active',
        },
      })),
    },
    companyAssignments: {
      get: vi.fn(async (jobId: string) => ({
        jobId,
        assignmentRevision: 1,
        workspaceCompany: {
          companyId: '01900000-0000-7000-8000-000000000099',
          revision: 1,
          displayName: 'Assigned Company',
          status: 'active',
        },
        jobFactsCompanyName: 'Posting Company',
        roleTitle: 'Role',
        namesDiffer: true,
      })),
    },
    opportunities: { list: lists.opportunities },
    applications: { list: lists.applications },
  } as unknown as ValedictorianWorkspaceClientV2
  return { client, lists, removeCapture }
}

describe('LifecycleWorkbench', () => {
  it('loads every aggregate through the workspace client and switches the shared table wiring', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    render(<LifecycleWorkbench client={client} />)

    expect(await screen.findByText('No captures')).toBeInTheDocument()
    await waitFor(() => {
      expect(lists.captures).toHaveBeenCalledTimes(1)
      expect(lists.jobs).toHaveBeenCalledTimes(2)
      expect(lists.opportunities).toHaveBeenCalledTimes(1)
      expect(lists.applications).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: /Jobs/ }))
    expect(await screen.findByRole('table', { name: 'Jobs' })).toBeInTheDocument()
    expect(screen.getByText('No jobs')).toBeInTheDocument()
  })

  it('loads an addressed Job by ID even when it is absent from the list page', async () => {
    const addressedJobId = '01900000-0000-7000-8000-000000000001'
    const { client, lists } = makeClient()
    lists.jobs.mockRejectedValueOnce(new Error('Jobs page unavailable'))
    const get = vi.fn(async () => ({
      id: addressedJobId,
      facts: {
        roleTitle: 'Directly Addressed Role',
        companyName: 'Direct Company',
        sourceName: 'Test source',
      },
      availability: { state: 'active' },
    }))
    Object.assign(client.jobs, { get })

    render(
      <LifecycleWorkbench
        client={client}
        selectedPhase="jobs"
        selectedResourceId={addressedJobId}
      />,
    )

    expect(await screen.findByRole('heading', {
      name: 'Directly Addressed Role',
    })).toHaveFocus()
    expect(get).toHaveBeenCalledWith(addressedJobId)
    expect(screen.getByRole('alert')).toHaveTextContent('Jobs page unavailable')
  })

  it('links the assigned Company as primary and keeps differing posting facts secondary', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    const job = {
      id: '01900000-0000-7000-8000-000000000001',
      facts: {
        companyName: 'Posting Company',
        roleTitle: 'Engineer',
        sourceName: 'Test source',
      },
      availability: { state: 'active' },
      externalIdentities: [],
      removedAt: null,
    } as unknown as Job
    lists.jobs.mockResolvedValue({
      items: [job],
      limit: 50,
      nextCursor: null,
    })
    const navigate = vi.fn()
    render(
      <LifecycleWorkbench
        client={client}
        selectedPhase="jobs"
        onWorkspaceNavigate={navigate}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Assigned Company' }))

    expect(screen.getByText('Posting says: Posting Company')).toBeInTheDocument()
    expect(navigate).toHaveBeenCalledWith({
      view: 'companies',
      resourceId: '01900000-0000-7000-8000-000000000099',
    })
  })

  it('uses the canonical Capture filters on one operational surface', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    render(<LifecycleWorkbench client={client} />)

    const filters = await screen.findByRole('radiogroup', { name: 'Capture filter' })
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: 'Needs attention' }))
    await waitFor(() => expect(lists.captures).toHaveBeenLastCalledWith({
      filter: 'needs_attention',
      sort: 'observed_desc',
      limit: 50,
    }))
    expect(filters).toBeInTheDocument()
  })

  it('uses opaque Capture cursors in both directions', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    lists.captures.mockResolvedValueOnce({
      ...capturePage(),
      pageInfo: {
        startCursor: 'opaque-start',
        endCursor: 'opaque-end',
        hasPreviousPage: false,
        hasNextPage: true,
      },
    })
    const navigate = vi.fn()
    const { rerender } = render(
      <LifecycleWorkbench
        client={client}
        workspaceEntry={{ location: { view: 'captures' }, cursorChain: [] }}
        onWorkspaceNavigate={navigate}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Go to next page' }))
    expect(navigate).toHaveBeenCalledWith({
      view: 'captures',
      cursor: 'opaque-end',
      cursorDirection: 'after',
    }, {
      cursorChain: [{ view: 'captures' }],
    })

    lists.captures.mockResolvedValueOnce({
      ...capturePage(),
      pageInfo: {
        startCursor: 'opaque-return',
        endCursor: 'opaque-end-2',
        hasPreviousPage: true,
        hasNextPage: false,
      },
    })
    rerender(
      <LifecycleWorkbench
        client={client}
        workspaceEntry={{
          location: {
            view: 'captures',
            cursor: 'opaque-end',
            cursorDirection: 'after',
          },
          cursorChain: [{ view: 'captures' }],
        }}
        onWorkspaceNavigate={navigate}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Go to previous page' }))
    expect(navigate).toHaveBeenLastCalledWith({
      view: 'captures',
      cursor: 'opaque-return',
      cursorDirection: 'before',
    }, {
      cursorChain: [],
    })
  })

  it('renders the backend-owned Capture presentation without technical fields', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    const capture: CaptureListPresentation = {
      captureId: 'capture-one',
      captureRevision: 7,
      observedAt: '2026-07-23T00:00:00Z',
      lead: {
        roleTitle: 'Platform Engineer',
        companyName: 'Acme',
        fallbackLabel: 'Acme lead',
      },
      source: { displayName: 'Jobright', provider: 'jobright' },
      destination: { state: 'resolved', displayHost: 'jobs.example.com' },
      readiness: 'ready',
      processingSummary: 'promoted',
      activeProcessing: false,
      linkedJob: {
        jobId: '01900000-0000-7000-8000-000000000001' as Job['id'],
        roleTitle: 'Platform Engineer',
        companyName: 'Acme',
      },
      primaryIntent: {
        kind: 'view_job',
        jobId: '01900000-0000-7000-8000-000000000001' as Job['id'],
      },
    }
    lists.captures.mockResolvedValue(capturePage([capture]))
    const openResource = vi.fn()

    render(<LifecycleWorkbench client={client} onOpenResource={openResource} />)

    const table = await screen.findByRole('table', { name: 'Captures' })
    expect(table).toHaveTextContent('Platform Engineer')
    expect(table).toHaveTextContent('Jobright')
    expect(table).toHaveTextContent('jobs.example.com')
    expect(table).toHaveTextContent('Job created')
    expect(table).toHaveTextContent('View Job')
    expect(table).not.toHaveTextContent('Revision')
    expect(table).not.toHaveTextContent('Evidence')
    await user.click(screen.getByRole('button', { name: 'Platform Engineer · Acme' }))
    expect(openResource).toHaveBeenCalledWith(
      '01900000-0000-7000-8000-000000000001',
      'capture-job-link-capture-one',
    )
  })

  it('completes a Capture through the provenance modal, refreshes both rows, and wires View Job navigation', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    const capture = completionCapture('capture-complete')
    lists.captures.mockResolvedValue(capturePage([capture]))
    const get = vi.fn().mockResolvedValue({
      captureId: 'capture-complete', captureRevision: 1, expectedGenerationId: 'gen-1',
      sourceSummary: { displayName: 'Job board', provider: 'board', observedAt: '2026-07-23T00:00:00.000Z' },
      provenance: [], destination: { status: 'resolved', url: 'https://jobs.example.com/role' },
      rawEvidence: [{ captureRevision: 1, evidenceIndex: 0, label: 'Title', displayValue: 'Engineer' }],
      exactEvidenceReferences: [{ captureId: 'capture-complete', captureRevision: 1, evidenceIndexes: [0] }],
      jobDefaults: { companyName: 'Acme', roleTitle: 'Platform Engineer' }, lastIssue: null,
    })
    const complete = vi.fn().mockResolvedValue({
      status: 'created', jobId: 'job-created', companyId: 'company-created', createdJob: true,
      existingJobComparison: 'not_compared',
    })
    Object.assign(client.captureResolutionV2, { get, complete })
    const openResource = vi.fn()
    render(<LifecycleWorkbench client={client} onOpenResource={openResource} />)

    await user.click(await screen.findByRole('button', { name: 'Complete Job information' }))
    await user.click(await screen.findByRole('button', { name: 'Create Job' }))

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(lists.captures).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(lists.jobs.mock.calls.length).toBeGreaterThanOrEqual(4))
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Job created' }))
    const toastInput = toast.mock.calls[0]?.[0] as { action: { onClick: () => void } }
    toastInput.action.onClick()
    expect(openResource).toHaveBeenCalledWith('job-created', 'capture-job-link-capture-complete')
  })

  it('opens the shared removal flow from clean and dirty completion drafts after the live projection drops the row', async () => {
    const user = userEvent.setup()
    const { client, lists, removeCapture } = makeClient()
    const capture = completionCapture('capture-remove')
    let captureInProjection = true
    lists.captures.mockImplementation(async () => capturePage(captureInProjection ? [capture] : []))
    const get = vi.fn(async (captureId: string) => completionDetail(captureId))
    const complete = vi.fn()
    Object.assign(client.captureResolutionV2, { get, complete })
    const { rerender } = render(<LifecycleWorkbench client={client} />)

    await user.click(await screen.findByRole('button', { name: 'Complete Job information' }))
    captureInProjection = false
    rerender(
      <LifecycleWorkbench
        client={client}
        workspaceEntry={{ location: { view: 'captures', filter: 'needs_attention' }, cursorChain: [] }}
      />,
    )
    expect(await screen.findByText('No captures')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Remove Capture' }))
    let removal = await screen.findByRole('dialog', { name: 'Remove Capture' })
    expect(removal).toHaveTextContent('capture-remove')
    await user.click(within(removal).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove Capture' })).not.toBeInTheDocument())

    const roleTitle = screen.getByLabelText('Role title')
    await user.clear(roleTitle)
    await user.type(roleTitle, 'Principal Engineer')
    await user.click(screen.getByRole('button', { name: 'Remove Capture' }))
    removal = await screen.findByRole('dialog', { name: 'Remove Capture' })
    await user.click(within(removal).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove Capture' })).not.toBeInTheDocument())
    expect(screen.getByLabelText('Role title')).toHaveValue('Principal Engineer')
    expect(removeCapture).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  it('preserves shared removal blocker and error context over a dirty completion draft', async () => {
    const user = userEvent.setup()
    const { client, lists, removeCapture } = makeClient()
    const capture = completionCapture('capture-remove')
    lists.captures.mockResolvedValue(capturePage([capture]))
    removeCapture
      .mockResolvedValueOnce({
        status: 'blocked',
        id: 'capture-remove',
        blocker: { code: 'impossible_state', message: 'Linked Jobs require a choice.' },
        dependentIds: ['job-1'],
        supportedChoices: ['preserve_historical_lineage'],
      })
      .mockRejectedValueOnce(new Error('Capture removal is unavailable.'))
    const complete = vi.fn()
    Object.assign(client.captureResolutionV2, {
      get: vi.fn(async (captureId: string) => completionDetail(captureId)),
      complete,
    })
    render(<LifecycleWorkbench client={client} />)

    await user.click(await screen.findByRole('button', { name: 'Complete Job information' }))
    const roleTitle = await screen.findByLabelText('Role title')
    await user.clear(roleTitle)
    await user.type(roleTitle, 'Principal Engineer')
    await user.click(screen.getByRole('button', { name: 'Remove Capture' }))
    let removal = await screen.findByRole('dialog', { name: 'Remove Capture' })
    await user.type(within(removal).getByRole('textbox', { name: 'Rationale' }), 'Duplicate intake.')
    await user.click(within(removal).getByRole('button', { name: 'Check and remove' }))

    expect(await within(removal).findByRole('alert')).toHaveTextContent('job-1')
    expect(within(removal).getByRole('combobox', { name: 'Removal option' })).toBeInTheDocument()
    await user.click(within(removal).getByRole('button', { name: 'Discard changes' }))
    const discard = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })
    await user.click(within(discard).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove Capture' })).not.toBeInTheDocument())

    expect(screen.getByLabelText('Role title')).toHaveValue('Principal Engineer')
    await user.click(screen.getByRole('button', { name: 'Remove Capture' }))
    removal = await screen.findByRole('dialog', { name: 'Remove Capture' })
    await user.type(within(removal).getByRole('textbox', { name: 'Rationale' }), 'No longer relevant.')
    await user.click(within(removal).getByRole('button', { name: 'Check and remove' }))

    expect(await screen.findByTestId('lifecycle-outcome-error')).toHaveTextContent('Capture removal is unavailable.')
    expect(screen.getByRole('dialog', { name: 'Remove Capture' })).toBeInTheDocument()
    expect(complete).not.toHaveBeenCalled()
  })

  it('closes completion and refreshes the active Capture row after shared removal succeeds', async () => {
    const user = userEvent.setup()
    const { client, lists, removeCapture } = makeClient()
    const capture = completionCapture('capture-remove')
    let active = true
    lists.captures.mockImplementation(async () => capturePage(active ? [capture] : []))
    removeCapture.mockImplementation(async () => {
      active = false
      return {
        status: 'removed' as const,
        id: 'capture-remove',
        choice: 'reject_if_dependents' as const,
        removedAt: '2026-07-24T00:00:00Z',
        affectedDependentIds: [],
        audit: { actor: 'desktop' as const, timestamp: '2026-07-24T00:00:00Z' },
      }
    })
    const complete = vi.fn()
    Object.assign(client.captureResolutionV2, {
      get: vi.fn(async (captureId: string) => completionDetail(captureId)),
      complete,
    })
    render(<LifecycleWorkbench client={client} />)

    await user.click(await screen.findByRole('button', { name: 'Complete Job information' }))
    await user.click(await screen.findByRole('button', { name: 'Remove Capture' }))
    const removal = await screen.findByRole('dialog', { name: 'Remove Capture' })
    await user.type(within(removal).getByRole('textbox', { name: 'Rationale' }), 'Duplicate intake.')
    await user.click(within(removal).getByRole('button', { name: 'Check and remove' }))

    await waitFor(() => expect(removeCapture).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('dialog', {
      name: 'Complete Capture into a Job',
    })).not.toBeInTheDocument())
    expect(await screen.findByText('No captures')).toBeInTheDocument()
    expect(await screen.findByTestId('lifecycle-outcome-removed')).toHaveTextContent('Removed.')
    expect(complete).not.toHaveBeenCalled()
  })

  it('opens both duplicate and Company-assignment intents in the completion modal with fresh Capture details', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    lists.captures.mockResolvedValue(capturePage([
      captureIntent('capture-duplicate', 'resolve_duplicate_job'),
      captureIntent('capture-assignment', 'resolve_company_assignment'),
    ]))
    const get = vi.fn(async (captureId: string) => completionDetail(captureId))
    Object.assign(client.captureResolutionV2, { get })
    render(<LifecycleWorkbench client={client} />)

    await user.click(await screen.findByRole('button', { name: 'Resolve duplicate Job' }))
    expect(await screen.findByLabelText('Job facts company')).toHaveValue('Acme')
    expect(get).toHaveBeenLastCalledWith('capture-duplicate')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Resolve company assignment' }))
    expect(await screen.findByLabelText('Job facts company')).toHaveValue('Acme')
    expect(get).toHaveBeenLastCalledWith('capture-assignment')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('opens the Capture detail read-only when a destination outcome has no completion intent', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    lists.captures.mockResolvedValue(capturePage([securityOutcomeCapture('capture-security')]))
    const get = vi.fn(async (captureId: string) => securityOutcomeDetail(captureId))
    const jobsGet = vi.fn()
    const complete = vi.fn()
    Object.assign(client.captureResolutionV2, { get, complete })
    Object.assign(client.jobs, { get: jobsGet })
    render(<LifecycleWorkbench client={client} />)

    await user.click(await screen.findByRole('button', { name: 'View resolution details' }))

    const dialog = await screen.findByRole('dialog', { name: 'Capture resolution details' })
    expect(screen.queryByRole('dialog', {
      name: 'Complete Capture into a Job',
    })).not.toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('capture-security')
    const outcome = await within(dialog).findByRole('region', {
      name: 'Destination resolution outcome',
    })
    expect(outcome).toHaveTextContent('destination_security_rejected')
    expect(outcome).toHaveTextContent('rejected_scheme')
    expect(outcome).not.toHaveTextContent('javascript:')
    // Read-only: no completion editor and no reachable mutation control.
    expect(within(dialog).queryByLabelText('Job facts company')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Create Job' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Remove Capture' }))
      .not.toBeInTheDocument()
    expect(within(dialog).getByText('Close')).toBeInTheDocument()
    // A read-only view synthesizes no completion intent, so no recovery loads.
    expect(jobsGet).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  it('shows a terminal client-unavailable failure instead of loading forever', async () => {
    render(<LifecycleWorkbench client={null} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace HTTP client is unavailable.',
    )
  })

  it('recovers when the renderer backend becomes available after initial startup', async () => {
    let available = false
    let backendListener: ((state: { status: string }) => void) | undefined
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      return new Response(JSON.stringify(
        url.includes('/capture-resolution/captures') ? capturePage() : emptyPage(),
      ), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    })
    Object.defineProperty(window, 'valedictorianHttp', {
      configurable: true,
      value: {
        apiBaseUrl: 'http://127.0.0.1:4317',
        workspaceId: 'workspace-1',
        request,
        getBackendState: () => available
          ? { status: 'available', origin: 'http://127.0.0.1:4317' }
          : { status: 'starting' },
        onBackendStateChanged: (listener: (state: { status: string }) => void) => {
          backendListener = listener
          return vi.fn()
        },
      },
    })
    render(<LifecycleWorkbench />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace HTTP client is unavailable.',
    )
    available = true
    await act(async () => backendListener?.({ status: 'available' }))

    expect(await screen.findByText('No captures')).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(5)
  })

  it('retries a failed aggregate load from the rendered failure action', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    lists.captures.mockRejectedValueOnce(new Error('captures unavailable'))
    render(<LifecycleWorkbench client={client} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('captures unavailable')
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('No captures')).toBeInTheDocument()
    expect(lists.captures).toHaveBeenCalledTimes(2)
  })

  it('keeps the visible Jobs page bounded while draining its complete projection', async () => {
    const { client, lists } = makeClient()
    for (const [phase, list] of Object.entries(lists)
      .filter(([phase]) => phase !== 'jobs' && phase !== 'captures')) {
      list
        .mockResolvedValueOnce({ items: [], limit: 100, nextCursor: `${phase}-page-2` })
        .mockResolvedValueOnce(emptyPage())
    }
    lists.jobs.mockImplementation(async (input?: unknown) => {
      const query = input as { cursor?: string; limit?: number }
      if (query.limit === 50) return emptyPage()
      return query.cursor === 'jobs-page-2'
        ? emptyPage()
        : { items: [], limit: 100, nextCursor: 'jobs-page-2' }
    })
    render(<LifecycleWorkbench client={client} />)

    await waitFor(() => {
      expect(lists.captures).toHaveBeenCalledTimes(1)
      expect(lists.opportunities).toHaveBeenCalledTimes(2)
      expect(lists.applications).toHaveBeenCalledTimes(2)
      expect(lists.jobs).toHaveBeenCalledTimes(3)
    })
    for (const [phase, list] of Object.entries(lists)
      .filter(([phase]) => phase !== 'jobs' && phase !== 'captures')) {
      expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({
        cursor: `${phase}-page-2`,
        limit: 100,
      }))
    }
    expect(lists.jobs).toHaveBeenCalledWith({
      includeRemoved: false,
      limit: 50,
    })
    expect(lists.jobs).toHaveBeenCalledWith({
      cursor: 'jobs-page-2',
      includeRemoved: false,
      limit: 100,
    })
  })

  it('uses the exact legacy Jobs next cursor and exact prior list location', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    const nextCursor = 'opaque/+==:\u0000\n +'
    lists.jobs.mockResolvedValueOnce({
      items: [],
      limit: 50,
      nextCursor,
    })
    const navigate = vi.fn()
    const { rerender } = render(
      <LifecycleWorkbench
        client={client}
        selectedPhase="jobs"
        workspaceEntry={{
          location: { view: 'jobs', filter: 'include_removed' },
          cursorChain: [],
        }}
        onWorkspaceNavigate={navigate}
      />,
    )
    await waitFor(() => expect(lists.jobs).toHaveBeenCalledWith({
      includeRemoved: true,
      limit: 50,
    }))

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(navigate).toHaveBeenCalledWith({
      view: 'jobs',
      filter: 'include_removed',
      cursor: nextCursor,
      cursorDirection: 'after',
    }, {
      cursorChain: [{ view: 'jobs', filter: 'include_removed' }],
    })

    rerender(
      <LifecycleWorkbench
        client={client}
        selectedPhase="jobs"
        workspaceEntry={{
          location: {
            view: 'jobs',
            filter: 'include_removed',
            cursor: nextCursor,
            cursorDirection: 'after',
          },
          cursorChain: [{ view: 'jobs', filter: 'include_removed' }],
        }}
        onWorkspaceNavigate={navigate}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Go to previous page' }))
    expect(navigate).toHaveBeenLastCalledWith(
      { view: 'jobs', filter: 'include_removed' },
      { cursorChain: [] },
    )
  })

  it('routes the Jobs Show removed filter through a selection-clearing location reset', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    Object.assign(client.jobs, { get: vi.fn(async () => null) })
    const navigate = vi.fn()
    render(
      <LifecycleWorkbench
        client={client}
        selectedPhase="jobs"
        selectedResourceId="01900000-0000-7000-8000-000000000001"
        workspaceEntry={{
          location: {
            view: 'jobs',
            filter: 'include_removed',
            resourceId: '01900000-0000-7000-8000-000000000001',
            cursor: 'page-two',
            cursorDirection: 'after',
          },
          cursorChain: [{ view: 'jobs', filter: 'include_removed' }],
        }}
        onWorkspaceNavigate={navigate}
      />,
    )
    const showRemoved = await screen.findByRole('checkbox', { name: 'Show removed' })
    expect(showRemoved).toBeChecked()
    await user.click(showRemoved)
    expect(navigate).toHaveBeenCalledWith({
      view: 'jobs',
      filter: 'all',
    }, { cursorChain: [] })
  })

  it('restores the exact origin Job row and page when narrow Back uses browser history', async () => {
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
    const jobId = '01900000-0000-7000-8000-000000000001'
    const cursor = 'opaque/+ page'
    window.history.replaceState(
      null,
      '',
      `/?view=jobs&filter=include_removed&cursor=${encodeURIComponent(cursor)}&direction=after`,
    )
    const { client, lists } = makeClient()
    const job = {
      id: jobId,
      facts: {
        roleTitle: 'Narrow Job',
        companyName: 'Origin Company',
        sourceName: 'Test',
      },
      availability: { state: 'active' },
      externalIdentities: [],
    } as unknown as Job
    lists.jobs.mockResolvedValue({ items: [job], limit: 50, nextCursor: null })
    Object.assign(client.jobs, { get: vi.fn(async () => job) })
    render(<JobsHistoryHarness client={client} />)

    const origin = await screen.findByRole('button', { name: 'Narrow Job' })
    await userEvent.click(origin)
    await screen.findByRole('button', { name: 'Back to Jobs' })
    await userEvent.click(screen.getByRole('button', { name: 'Back to Jobs' }))

    await waitFor(() => expect(origin).toHaveFocus())
    expect(new URL(window.location.href).searchParams.get('cursor')).toBe(cursor)
    expect(new URL(window.location.href).searchParams.get('filter')).toBe('include_removed')
  })

  it('does not strand an unrelated phase when a selected-phase refresh supersedes its own load', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    let resolveJobs: ((page: TestPage) => void) | undefined
    lists.jobs.mockImplementationOnce(() => new Promise<TestPage>((resolve) => { resolveJobs = resolve }))
    render(<LifecycleWorkbench client={client} />)

    expect(await screen.findByText('No captures')).toBeInTheDocument()
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(lists.captures).toHaveBeenCalledTimes(2))
    await act(async () => resolveJobs?.(emptyPage()))

    await user.click(screen.getByRole('button', { name: /Jobs/ }))
    expect(await screen.findByText('No jobs')).toBeInTheDocument()
  })
})

function captureIntent(
  captureId: string,
  kind: 'resolve_duplicate_job' | 'resolve_company_assignment',
): CaptureListPresentation {
  return {
    captureId,
    captureRevision: 1,
    observedAt: '2026-07-23T00:00:00Z',
    lead: { roleTitle: 'Platform Engineer', companyName: 'Acme', fallbackLabel: 'Acme lead' },
    source: { displayName: 'Job board', provider: 'board' },
    destination: { state: 'resolved', displayHost: 'jobs.example.com' },
    readiness: 'ready',
    processingSummary: 'blocked',
    activeProcessing: false,
    linkedJob: null,
    primaryIntent: kind === 'resolve_duplicate_job'
      ? { kind, conflictingJobIds: ['job-conflict'], supportedActions: ['attach'] }
      : { kind, jobId: 'job-conflict', currentCompanyId: '01900000-0000-7000-8000-000000000099' },
  }
}

function completionCapture(captureId: string): CaptureListPresentation {
  return {
    captureId,
    captureRevision: 1,
    observedAt: '2026-07-23T00:00:00Z',
    lead: { roleTitle: 'Platform Engineer', companyName: 'Acme', fallbackLabel: 'Acme lead' },
    source: { displayName: 'Job board', provider: 'board' },
    destination: { state: 'resolved', displayHost: 'jobs.example.com' },
    readiness: 'ready',
    processingSummary: 'awaiting_information',
    activeProcessing: false,
    linkedJob: null,
    primaryIntent: { kind: 'complete_job_information' },
  }
}

function securityOutcomeCapture(captureId: string): CaptureListPresentation {
  return {
    ...completionCapture(captureId),
    destination: { state: 'blocked', displayHost: null },
    processingSummary: 'blocked',
    primaryIntent: null,
  }
}

function securityOutcomeDetail(captureId: string) {
  return {
    ...completionDetail(captureId),
    destination: { status: 'blocked', url: null },
    lastIssue: {
      stage: 'destination',
      code: 'destination_security_rejected',
      action: null,
      causedBy: null,
      message: 'The resolved destination was rejected by URL safety.',
      details: {
        safetyReason: 'rejected_scheme',
        rejectedUrl: 'javascript:alert(document.cookie)',
      },
    },
  }
}

function completionDetail(captureId: string) {
  return {
    captureId, captureRevision: 1, expectedGenerationId: 'gen-1',
    sourceSummary: { displayName: 'Job board', provider: 'board', observedAt: '2026-07-23T00:00:00.000Z' },
    provenance: [], destination: { status: 'resolved', url: 'https://jobs.example.com/role' },
    rawEvidence: [{ captureRevision: 1, evidenceIndex: 0, label: 'Title', displayValue: 'Engineer' }],
    exactEvidenceReferences: [{ captureId, captureRevision: 1, evidenceIndexes: [0] }],
    jobDefaults: { companyName: 'Acme', roleTitle: 'Platform Engineer' }, lastIssue: null,
  }
}

function JobsHistoryHarness({ client }: { client: ValedictorianWorkspaceClient }) {
  const navigation = useWorkspaceLocation()
  return (
    <LifecycleWorkbench
      client={client}
      selectedPhase="jobs"
      selectedResourceId={navigation.entry.location.resourceId}
      workspaceEntry={navigation.entry}
      onWorkspaceNavigate={navigation.navigate}
      onOpenResource={(resourceId, focusAnchor) => navigation.navigate({
        ...navigation.entry.location,
        resourceId,
      }, {
        cursorChain: navigation.entry.cursorChain,
        focusAnchor,
      })}
      onBackFromResource={navigation.back}
    />
  )
}
