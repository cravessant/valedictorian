// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Application,
  Capture,
  CaptureListPresentation,
  Job,
  Opportunity,
  ValedictorianWorkspaceClientV2,
} from '@sparxie/sdk'

import { LifecycleWorkbench } from './lifecycle-workbench'
import {
  DESKTOP_USER_ACTOR,
  __resetLifecycleActorCounterForTests,
} from './lifecycle-actor'
import type { LifecycleOutcome } from './lifecycle-outcome-types'
import { LifecycleOutcomeView } from './lifecycle-outcome-view'

/** The canonical page boundaries a single-page lifecycle list reports. */
const emptyPageInfo = {
  startCursor: null,
  endCursor: null,
  hasPreviousPage: false,
  hasNextPage: false,
} as const


class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
Element.prototype.scrollIntoView = vi.fn()

afterEach(() => {
  cleanup()
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
})

function makeCapture(id: string, overrides: Partial<Capture> = {}): Capture {
  return {
    id,
    workspaceId: 'ws',
    revision: 1,
    evidenceMode: 'reported',
    adapter: { id: 'jobright', kind: 'connector', version: '0.1' },
    observedAt: '2025-01-01T00:00:00Z',
    receivedAt: '2025-01-01T00:00:00Z',
    providerRecordId: null,
    providerSchema: null,
    payload: null,
    evidence: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    removedAt: null,
    ...overrides,
  }
}

function makeCapturePresentation(
  capture: Capture,
  overrides: Partial<CaptureListPresentation> = {},
): CaptureListPresentation {
  return {
    captureId: capture.id,
    captureRevision: capture.revision,
    observedAt: capture.observedAt,
    lead: {
      roleTitle: null,
      companyName: null,
      fallbackLabel: capture.adapter.id,
    },
    source: {
      displayName: capture.adapter.id === 'jobright' ? 'Jobright' : capture.adapter.id,
      provider: capture.adapter.id,
    },
    destination: { state: 'not_required', displayHost: null },
    readiness: capture.removedAt ? 'removed' : 'ready',
    processingSummary: capture.removedAt ? null : 'awaiting_information',
    activeProcessing: false,
    linkedJob: null,
    primaryIntent: capture.removedAt ? null : { kind: 'complete_job_information' },
    ...overrides,
  }
}

function makeJob(id: string, overrides: Partial<Job> = {}): Job {
  return {
    id: id as Job['id'],
    workspaceId: 'ws',
    factsRevision: 1,
    facts: {
      companyName: 'Acme',
      roleTitle: 'Engineer',
      sourceName: 'LinkedIn',
      roleKind: 'new_grad',
      term: null,
      terms: [],
      timingMode: 'unknown',
      startDate: null,
      endDate: null,
      location: null,
      workMode: 'unknown',
      employmentType: 'full_time',
      seniority: 'entry',
      compensation: null,
      postedAt: null,
      destination: null,
    },
    availabilityRevision: 1,
    availability: { state: 'unknown', observedAt: '2025-01-01T00:00:00Z' },
    externalIdentities: [],
    captureEvidenceReferences: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    removedAt: null,
    ...overrides,
  }
}

function makeOpportunity(id: string, overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: id as Opportunity['id'],
    workspaceId: 'ws',
    jobId: 'job-1' as Opportunity['jobId'],
    revision: 1,
    fit: 'unknown',
    rank: null,
    cutoff: 'not_evaluated',
    disposition: 'reviewing',
    override: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    removedAt: null,
    ...overrides,
  }
}

function makeApplication(id: string, overrides: Partial<Application> = {}): Application {
  return {
    id: id as Application['id'],
    workspaceId: 'ws',
    opportunityId: 'opp-1' as Application['opportunityId'],
    jobId: 'job-1' as Application['jobId'],
    revision: 1,
    status: 'active',
    snapshot: {
      jobFactsRevision: 1,
      capturedAt: '2025-01-01T00:00:00Z',
      companyName: 'Acme',
      roleTitle: 'Engineer',
      sourceName: 'LinkedIn',
      roleKind: 'new_grad',
      term: null,
      terms: [],
      timingMode: 'unknown',
      startDate: null,
      endDate: null,
      location: null,
      workMode: 'unknown',
      initialDestination: null,
      initialLinks: [],
    },
    companyName: 'Acme',
    sourceName: 'LinkedIn',
    links: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    removedAt: null,
    ...overrides,
  }
}

interface MockClient {
  client: ValedictorianWorkspaceClientV2
  captures: Record<string, ReturnType<typeof vi.fn>>
  captureResolution: Record<string, ReturnType<typeof vi.fn>>
  jobs: Record<string, ReturnType<typeof vi.fn>>
  companyAssignments: Record<string, ReturnType<typeof vi.fn>>
  opportunities: Record<string, ReturnType<typeof vi.fn>>
  applications: Record<string, ReturnType<typeof vi.fn>>
}

function makeClient(seed: {
  captures?: Capture[]
  jobs?: Job[]
  opportunities?: Opportunity[]
  applications?: Application[]
} = {}): MockClient {
  const captures = {
    list: vi.fn(async () => ({ items: seed.captures ?? [], pageInfo: emptyPageInfo })),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeCapture('cap-new'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    correct: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeCapture('cap-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    remove: vi.fn(async () => ({ status: 'removed' as const, id: 'cap-1', choice: 'preserve_historical_lineage' as const, removedAt: '2025-01-01T00:00:00Z', affectedDependentIds: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    restore: vi.fn(async () => ({ status: 'restored' as const, id: 'cap-1', restoredAt: '2025-01-01T00:00:00Z', dependentLinks: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    history: vi.fn(async () => ({ items: [], pageInfo: emptyPageInfo })),
    promoteToJob: vi.fn(async () => ({ status: 'promoted' as const, resource: makeJob('job-new'), created: true, warnings: [], override: null, duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
  }
  const captureResolution = {
    list: vi.fn(async () => {
      const items = (seed.captures ?? []).map((capture) => makeCapturePresentation(capture))
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
    }),
  }
  const jobs = {
    list: vi.fn(async () => ({ items: seed.jobs ?? [], pageInfo: emptyPageInfo })),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeJob('job-new'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    correctFacts: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeJob('job-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateAvailability: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeJob('job-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    externalIdentities: { add: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) },
    remove: vi.fn(async () => ({ status: 'removed' as const, id: 'job-1', choice: 'preserve_historical_lineage' as const, removedAt: '2025-01-01T00:00:00Z', affectedDependentIds: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    restore: vi.fn(async () => ({ status: 'restored' as const, id: 'job-1', restoredAt: '2025-01-01T00:00:00Z', dependentLinks: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    history: vi.fn(async () => ({ items: [], pageInfo: emptyPageInfo })),
    promoteToOpportunity: vi.fn(async () => ({ status: 'promoted' as const, resource: makeOpportunity('opp-new'), created: true, warnings: [], override: null, duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
  }
  const opportunities = {
    list: vi.fn(async () => ({ items: seed.opportunities ?? [], pageInfo: emptyPageInfo })),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeOpportunity('opp-new'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateEvaluation: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeOpportunity('opp-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateDisposition: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeOpportunity('opp-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    remove: vi.fn(async () => ({ status: 'removed' as const, id: 'opp-1', choice: 'preserve_historical_lineage' as const, removedAt: '2025-01-01T00:00:00Z', affectedDependentIds: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    restore: vi.fn(async () => ({ status: 'restored' as const, id: 'opp-1', restoredAt: '2025-01-01T00:00:00Z', dependentLinks: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    history: vi.fn(async () => ({ items: [], pageInfo: emptyPageInfo })),
    promoteToApplication: vi.fn(async () => ({ status: 'promoted' as const, resource: makeApplication('app-new'), created: true, warnings: [], override: null, duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
  }
  const applications = {
    list: vi.fn(async () => ({ items: seed.applications ?? [], pageInfo: emptyPageInfo })),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeApplication('app-new'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateStatus: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeApplication('app-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateCompany: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeApplication('app-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateSource: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeApplication('app-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    links: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) },
    refreshSnapshot: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({ status: 'removed' as const, id: 'app-1', choice: 'preserve_historical_lineage' as const, removedAt: '2025-01-01T00:00:00Z', affectedDependentIds: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    restore: vi.fn(async () => ({ status: 'restored' as const, id: 'app-1', restoredAt: '2025-01-01T00:00:00Z', dependentLinks: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    history: vi.fn(async () => ({ items: [], pageInfo: emptyPageInfo })),
    attempts: { list: vi.fn(async () => ({ items: [], pageInfo: emptyPageInfo })) },
    events: { list: vi.fn(async () => ({ items: [], pageInfo: emptyPageInfo })) },
  }
  const companyAssignments = {
    get: vi.fn(async (jobId: string) => {
      const job = seed.jobs?.find((candidate) => candidate.id === jobId)
      return {
        jobId,
        assignmentRevision: 1,
        workspaceCompany: {
          companyId: '01900000-0000-7000-8000-000000000099',
          revision: 1,
          displayName: 'Assigned Company',
          status: 'active' as const,
        },
        jobFactsCompanyName: job?.facts.companyName ?? 'Posting Company',
        roleTitle: job?.facts.roleTitle ?? 'Role',
        namesDiffer: true,
      }
    }),
    reassign: vi.fn(),
  }
  const client = {
    captures,
    captureResolutionV2: captureResolution,
    jobs,
    companyAssignments,
    opportunities,
    applications,
  } as unknown as ValedictorianWorkspaceClientV2
  return {
    client,
    captures,
    captureResolution,
    jobs,
    companyAssignments,
    opportunities,
    applications,
  }
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, rowLabel: string | RegExp) {
  const label = rowLabel instanceof RegExp ? rowLabel.source : rowLabel
  const trigger = await screen.findByRole('button', { name: new RegExp(`Actions for row ${label}`) })
  await user.click(trigger)
  return await screen.findByRole('menu', { name: new RegExp(`Row actions for ${label}`) })
}

describe('LifecycleWorkbench action matrices and modal flows', () => {
  beforeEach(() => { __resetLifecycleActorCounterForTests() })

  it('exposes Remove Capture for active rows and Restore Capture only in Removed', async () => {
    const user = userEvent.setup()
    const active = makeCapture('cap-1')
    const removed = makeCapture('cap-1', { removedAt: '2025-02-01T00:00:00Z' })
    const { client, captureResolution } = makeClient({ captures: [active] })
    captureResolution.list.mockImplementation(async (input?: { filter?: string }) => {
      const items = [makeCapturePresentation(input?.filter === 'removed' ? removed : active)]
      return {
        items,
        pageInfo: { startCursor: 'start', endCursor: 'end', hasPreviousPage: false, hasNextPage: false },
        totalCount: items.length,
      }
    })
    render(<LifecycleWorkbench client={client} />)

    const activeMenu = await openRowMenu(user, 'jobright')
    expect(within(activeMenu).getByRole('menuitem', { name: 'Remove Capture' })).toBeInTheDocument()
    expect(within(activeMenu).queryByRole('menuitem', { name: 'Restore Capture' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('radio', { name: 'Removed' }))
    await waitFor(() => expect(captureResolution.list).toHaveBeenLastCalledWith({
      filter: 'removed', sort: 'observed_desc', limit: 50,
    }))
    const removedMenu = await openRowMenu(user, 'jobright')
    expect(within(removedMenu).getByRole('menuitem', { name: 'Restore Capture' })).toBeInTheDocument()
    expect(within(removedMenu).queryByRole('menuitem', { name: 'Remove Capture' })).not.toBeInTheDocument()
  })

  it('cancels Capture removal, then makes one safest-first typed removal call', async () => {
    const user = userEvent.setup()
    const capture = makeCapture('cap-1')
    let captureIsActive = true
    const { client, captures, captureResolution } = makeClient({ captures: [capture] })
    captureResolution.list.mockImplementation(async () => {
      const items = captureIsActive ? [makeCapturePresentation(capture)] : []
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
    })
    captures.remove.mockImplementation(async () => {
      captureIsActive = false
      return {
        status: 'removed' as const,
        id: 'cap-1',
        choice: 'reject_if_dependents' as const,
        removedAt: '2025-02-01T00:00:00Z',
        affectedDependentIds: [],
        audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-02-01T00:00:00Z' },
      }
    })
    render(<LifecycleWorkbench client={client} />)

    let menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove Capture' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove Capture' })
    expect(dialog).toHaveTextContent('First, check whether active Jobs depend on this Capture.')
    expect(within(dialog).queryByRole('combobox', { name: 'Removal option' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(captures.remove).not.toHaveBeenCalled()

    menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove Capture' }))
    const reopened = await screen.findByRole('dialog', { name: 'Remove Capture' })
    await user.click(within(reopened).getByRole('button', { name: 'Check and remove' }))
    expect(await screen.findByText('Rationale is required.')).toBeInTheDocument()
    expect(captures.remove).not.toHaveBeenCalled()

    await user.type(within(reopened).getByRole('textbox', { name: 'Rationale' }), 'Duplicate intake.')
    await user.dblClick(within(reopened).getByRole('button', { name: 'Check and remove' }))
    await waitFor(() => expect(captures.remove).toHaveBeenCalledTimes(1))
    expect(captures.remove).toHaveBeenCalledWith({
      id: 'cap-1',
      choice: 'reject_if_dependents',
      actor: DESKTOP_USER_ACTOR,
      rationale: 'Duplicate intake.',
    })
    await waitFor(() => expect(captureResolution.list).toHaveBeenLastCalledWith({
      filter: 'all', sort: 'observed_desc', limit: 50,
    }))
    expect(await screen.findByText('No captures')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Remove Capture' })).not.toBeInTheDocument()
    expect(await screen.findByTestId('lifecycle-outcome-removed')).toHaveTextContent('Removed.')
  })

  it('keeps Capture removal context on a dependency blocker and retries only supported choices', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient({ captures: [makeCapture('cap-1')] })
    captures.remove.mockResolvedValue({
      status: 'blocked',
      id: 'cap-1',
      blocker: { code: 'impossible_state', message: 'Linked Jobs require a choice.' },
      dependentIds: ['job-1', 'job-2'],
      supportedChoices: [
        'preserve_historical_lineage',
        'unlink_dependents',
        'cascade_tombstone',
      ],
    })
    render(<LifecycleWorkbench client={client} />)

    const menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove Capture' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove Capture' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Rationale' }), 'Remove duplicate lead.')
    await user.click(within(dialog).getByRole('button', { name: 'Check and remove' }))

    const blocker = await within(dialog).findByRole('alert')
    expect(blocker).toHaveTextContent('job-1')
    expect(blocker).toHaveTextContent('job-2')
    expect(blocker).toHaveTextContent('active Jobs remain linked to this Capture')
    expect(blocker).toHaveTextContent('permanently remove Capture→Job evidence references')
    expect(blocker).toHaveTextContent('tombstone this Capture and every linked downstream Job, Opportunity, and Application resource')
    const options = Array.from(within(dialog).getByRole<HTMLSelectElement>('combobox', {
      name: 'Removal option',
    }).options).map((option) => option.value)
    expect(options).toEqual(['', 'preserve_historical_lineage', 'unlink_dependents', 'cascade_tombstone'])

    for (const choice of options.slice(1)) {
      await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Removal option' }), choice)
      await user.click(within(dialog).getByRole('button', { name: 'Confirm removal' }))
    }

    await waitFor(() => expect(captures.remove).toHaveBeenCalledTimes(4))
    expect(captures.remove.mock.calls.map(([input]) => input.choice)).toEqual([
      'reject_if_dependents',
      'preserve_historical_lineage',
      'unlink_dependents',
      'cascade_tombstone',
    ])
    expect(screen.getByRole('dialog', { name: 'Remove Capture' })).toBeInTheDocument()
    expect(screen.queryByTestId('lifecycle-outcome-removed')).not.toBeInTheDocument()
  })

  it('retains Capture removal context and reports failures without a success claim', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient({ captures: [makeCapture('cap-1')] })
    captures.remove.mockRejectedValue(new Error('Capture removal is unavailable.'))
    render(<LifecycleWorkbench client={client} />)

    const menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove Capture' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove Capture' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Rationale' }), 'No longer relevant.')
    await user.click(within(dialog).getByRole('button', { name: 'Check and remove' }))

    expect(await screen.findByTestId('lifecycle-outcome-error')).toHaveTextContent('Capture removal is unavailable.')
    expect(screen.getByRole('dialog', { name: 'Remove Capture' })).toBeInTheDocument()
    expect(screen.queryByTestId('lifecycle-outcome-removed')).not.toBeInTheDocument()
  })

  it('closes a committed Capture removal and reports partial success when its refresh fails', async () => {
    const user = userEvent.setup()
    const { client, captures, captureResolution } = makeClient({ captures: [makeCapture('cap-1')] })
    render(<LifecycleWorkbench client={client} />)

    const menu = await openRowMenu(user, 'jobright')
    captureResolution.list.mockRejectedValueOnce(new Error('remove refresh unavailable'))
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove Capture' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove Capture' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Rationale' }), 'Remove duplicate lead.')
    await user.dblClick(within(dialog).getByRole('button', { name: 'Check and remove' }))

    await waitFor(() => expect(captures.remove).toHaveBeenCalledTimes(1))
    const outcome = await screen.findByTestId('lifecycle-outcome-partial-success')
    expect(outcome).toHaveTextContent('Capture was removed, but the workbench could not refresh: remove refresh unavailable')
    expect(outcome).toHaveTextContent('Refresh or reconcile the workbench before taking another action.')
    expect(screen.queryByRole('dialog', { name: 'Remove Capture' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('lifecycle-outcome-removed')).not.toBeInTheDocument()
    expect(captures.remove).toHaveBeenCalledTimes(1)
  })

  it('restores only the target from Removed, refreshes that projection, and explains where it went', async () => {
    const user = userEvent.setup()
    const removed = makeCapture('cap-removed', { removedAt: '2025-02-01T00:00:00Z' })
    const { client, captures, captureResolution } = makeClient({ captures: [removed] })
    let restored = false
    captureResolution.list.mockImplementation(async (input?: { filter?: string }) => {
      const items = input?.filter === 'removed' && !restored ? [makeCapturePresentation(removed)] : []
      return {
        items,
        pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false },
        totalCount: items.length,
      }
    })
    captures.restore.mockImplementation(async () => {
      restored = true
      return {
        status: 'restored' as const,
        id: 'cap-removed',
        restoredAt: '2025-02-02T00:00:00Z',
        dependentLinks: [{ dependentId: 'job-removed', state: 'remained_tombstoned' as const }],
        audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-02-02T00:00:00Z' },
      }
    })
    render(<LifecycleWorkbench client={client} />)

    await user.click(await screen.findByRole('radio', { name: 'Removed' }))
    const menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'Restore Capture' }))
    const dialog = await screen.findByRole('dialog', { name: 'Restore Capture' })
    expect(dialog).toHaveTextContent('This restores only the Capture, not any downstream resources.')
    await user.click(within(dialog).getByRole('button', { name: 'Restore Capture' }))
    expect(await screen.findByText('Rationale is required.')).toBeInTheDocument()
    expect(captures.restore).not.toHaveBeenCalled()

    await user.type(within(dialog).getByRole('textbox', { name: 'Rationale' }), 'Review again.')
    await user.dblClick(within(dialog).getByRole('button', { name: 'Restore Capture' }))
    await waitFor(() => expect(captures.restore).toHaveBeenCalledTimes(1))
    expect(captures.restore).toHaveBeenCalledWith({
      id: 'cap-removed', actor: DESKTOP_USER_ACTOR, rationale: 'Review again.',
    })
    await waitFor(() => expect(captureResolution.list).toHaveBeenLastCalledWith({
      filter: 'removed', sort: 'observed_desc', limit: 50,
    }))
    expect(await screen.findByText('No captures')).toBeInTheDocument()
    const status = await screen.findByTestId('lifecycle-outcome-restored')
    expect(status).toHaveTextContent('Only this Capture was restored.')
    expect(status).toHaveTextContent('Downstream resources are not restored automatically.')
    expect(status).toHaveTextContent('available in All and no longer appears in Removed')
    expect(status).toHaveTextContent('job-removed')
  })

  it('closes a committed Capture restore and reports partial success when its refresh fails', async () => {
    const user = userEvent.setup()
    const removed = makeCapture('cap-removed', { removedAt: '2025-02-01T00:00:00Z' })
    const { client, captures, captureResolution } = makeClient({ captures: [removed] })
    captures.restore.mockResolvedValue({
      status: 'restored',
      id: 'cap-removed',
      restoredAt: '2025-02-02T00:00:00Z',
      dependentLinks: [],
      audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-02-02T00:00:00Z' },
    })
    render(<LifecycleWorkbench client={client} />)

    await user.click(await screen.findByRole('radio', { name: 'Removed' }))
    const menu = await openRowMenu(user, 'jobright')
    captureResolution.list.mockRejectedValueOnce(new Error('restore refresh unavailable'))
    await user.click(within(menu).getByRole('menuitem', { name: 'Restore Capture' }))
    const dialog = await screen.findByRole('dialog', { name: 'Restore Capture' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Rationale' }), 'Review again.')
    await user.dblClick(within(dialog).getByRole('button', { name: 'Restore Capture' }))

    await waitFor(() => expect(captures.restore).toHaveBeenCalledTimes(1))
    const outcome = await screen.findByTestId('lifecycle-outcome-partial-success')
    expect(outcome).toHaveTextContent('Capture was restored, but the workbench could not refresh: restore refresh unavailable')
    expect(outcome).toHaveTextContent('Refresh or reconcile the workbench before taking another action.')
    expect(screen.queryByRole('dialog', { name: 'Restore Capture' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('lifecycle-outcome-restored')).not.toBeInTheDocument()
    expect(captures.restore).toHaveBeenCalledTimes(1)
  })

  it('keeps removed and restored revisions visible in Capture history without claiming rationale storage', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient({ captures: [makeCapture('cap-1')] })
    captures.history.mockResolvedValue({
      items: [
        { revision: 2, kind: 'removed', audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-02-01T00:00:00Z' } },
        { revision: 3, kind: 'restored', audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-02-02T00:00:00Z' } },
      ],
      pageInfo: emptyPageInfo,
    })
    render(<LifecycleWorkbench client={client} />)

    const menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'View history' }))
    const dialog = await screen.findByRole('dialog', { name: 'History · cap-1' })
    expect(await within(dialog).findByText(/r2 · removed/)).toBeInTheDocument()
    expect(within(dialog).getByText(/r3 · restored/)).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(/rationale/i)
  })

  it('Add Capture opens a modal, submits with the typed CreateCaptureInput, and awaits refresh before success', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await screen.findByText('No captures')

    await user.click(screen.getByRole('button', { name: 'Add capture' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add capture' })
    await user.type(screen.getByRole('textbox', { name: 'Source id' }), 'jobright')
    await user.type(screen.getByRole('textbox', { name: 'Source version' }), '0.1.0')
    await user.type(screen.getByRole('textbox', { name: 'Observed at' }), '2025-01-01T00:00')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(captures.create).toHaveBeenCalledTimes(1))
    expect(captures.create).toHaveBeenCalledWith(expect.objectContaining({
      evidenceMode: 'reported',
      adapter: { id: 'jobright', kind: 'manual', version: '0.1.0' },
      observedAt: '2025-01-01T00:00',
    }))
  })

  it('uses immediate clean Cancel exits for Capture, Job, Opportunity, and Application create forms', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    const forms = [
      { trigger: 'Add capture', title: 'Add capture', tab: null },
      { trigger: 'Add job', title: 'Add job', tab: /^Jobs/ },
      { trigger: 'Add opportunity', title: 'Add opportunity', tab: /^Opportunities/ },
      { trigger: 'Add application', title: 'Add application', tab: /^Applications/ },
    ]

    for (const form of forms) {
      if (form.tab) await user.click(screen.getByRole('button', { name: form.tab }))
      await user.click(await screen.findByRole('button', { name: form.trigger }))
      const dialog = await screen.findByRole('dialog', { name: form.title })
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: form.title })).not.toBeInTheDocument())
    }
  })

  it('Job promote routes to jobs.promoteToOpportunity with the typed evaluation', async () => {
    const user = userEvent.setup()
    const { client, jobs, opportunities } = makeClient({ jobs: [makeJob('job-1')] })
    render(<LifecycleWorkbench client={client} />)
    await user.click(screen.getByRole('button', { name: /^Jobs/ }))
    await screen.findByRole('table', { name: 'Jobs' })
    const menu = await openRowMenu(user, /Acme.*Engineer/)
    await user.click(within(menu).getByRole('menuitem', { name: 'Promote to opportunity' }))
    const dialog = await screen.findByRole('dialog', { name: 'Promote job to opportunity' })
    await user.click(within(dialog).getByRole('button', { name: 'Promote' }))
    await waitFor(() => expect(jobs.promoteToOpportunity).toHaveBeenCalledTimes(1))
    expect(jobs.promoteToOpportunity).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-1',
      expectedFactsRevision: 1,
      evaluation: expect.objectContaining({
        fit: 'unknown',
        rank: null,
        cutoff: 'not_evaluated',
        disposition: 'reviewing',
      }),
    }))
    await waitFor(() => {
      expect(jobs.list).toHaveBeenCalledTimes(4)
      expect(opportunities.list).toHaveBeenCalledTimes(2)
    })
  })

  it('offers Company reassignment from the Job row only after its assignment loads', async () => {
    const user = userEvent.setup()
    const { client } = makeClient({ jobs: [makeJob('job-1')] })
    render(<LifecycleWorkbench client={client} workspaceId="ws" />)
    await user.click(await screen.findByRole('button', { name: /^Jobs/ }))

    const menu = await openRowMenu(user, /Acme.*Engineer/)
    await user.click(within(menu).getByRole('menuitem', { name: 'Reassign Company' }))

    expect(await screen.findByRole('dialog', {
      name: 'Reassign Job Company',
    })).toHaveTextContent(
      'Currently assigned to Assigned Company. Job facts will not change.',
    )
  })

  it('Opportunity promote routes to opportunities.promoteToApplication', async () => {
    const user = userEvent.setup()
    const { client, opportunities, applications } = makeClient({ opportunities: [makeOpportunity('opp-1')] })
    render(<LifecycleWorkbench client={client} />)
    await user.click(screen.getByRole('button', { name: /^Opportunities/ }))
    await screen.findByRole('table', { name: 'Opportunities' })
    const menu = await openRowMenu(user, 'opp-1')
    await user.click(within(menu).getByRole('menuitem', { name: 'Promote to application' }))
    const dialog = await screen.findByRole('dialog', { name: 'Promote opportunity to application' })
    await user.click(within(dialog).getByRole('button', { name: 'Promote' }))
    await waitFor(() => expect(opportunities.promoteToApplication).toHaveBeenCalledTimes(1))
    expect(opportunities.promoteToApplication).toHaveBeenCalledWith(expect.objectContaining({
      opportunityId: 'opp-1',
      expectedJobId: 'job-1',
      initialLinks: [],
    }))
    await waitFor(() => {
      expect(opportunities.list).toHaveBeenCalledTimes(2)
      expect(applications.list).toHaveBeenCalledTimes(2)
    })
  })

  it('Application has no promote action', async () => {
    const user = userEvent.setup()
    const { client } = makeClient({ applications: [makeApplication('app-1')] })
    render(<LifecycleWorkbench client={client} />)
    await user.click(screen.getByRole('button', { name: /^Applications/ }))
    await screen.findByRole('table', { name: 'Applications' })
    const menu = await openRowMenu(user, /Acme.*Engineer/)
    expect(within(menu).queryByRole('menuitem', { name: /promote/i })).not.toBeInTheDocument()
  })

  it('resubmits a deterministic Job duplicate with only the selected server-supported resolution', async () => {
    const user = userEvent.setup()
    const { client, jobs } = makeClient()
    jobs.create
      .mockResolvedValueOnce({
        status: 'blocked',
        blocker: {
          code: 'deterministic_duplicate',
          message: 'Existing job.',
          conflictingResourceId: 'job-existing',
          allowedDuplicateResolutions: ['attach'],
        },
      })
      .mockResolvedValueOnce({
        status: 'succeeded', resource: makeJob('job-existing'), duplicateResolution: { action: 'attach', targetResourceId: 'job-existing' },
        audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' },
      })
    render(<LifecycleWorkbench client={client} />)
    await user.click(await screen.findByRole('button', { name: /^Jobs/ }))
    await user.click(screen.getByRole('button', { name: 'Add job' }))
    await user.type(screen.getByRole('textbox', { name: 'Company name' }), 'Acme')
    await user.type(screen.getByRole('textbox', { name: 'Role title' }), 'Engineer')
    await user.type(screen.getByRole('textbox', { name: 'Source name' }), 'Direct')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    const duplicate = await screen.findByTestId('lifecycle-outcome-duplicate')
    expect(within(duplicate).queryByRole('button', { name: /merge/ })).not.toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Company name' }))
    await user.type(screen.getByRole('textbox', { name: 'Company name' }), 'Acme Revised')
    await user.click(within(duplicate).getByRole('button', { name: /attach → job-existing/ }))
    await waitFor(() => expect(jobs.create).toHaveBeenCalledTimes(2))
    expect(jobs.create.mock.calls[1]?.[0].idempotencyKey).toBe(jobs.create.mock.calls[0]?.[0].idempotencyKey)
    expect(jobs.create).toHaveBeenLastCalledWith(expect.objectContaining({
      duplicateResolution: { action: 'attach', targetResourceId: 'job-existing' },
      facts: expect.objectContaining({ companyName: 'Acme Revised' }),
    }))
  })

  it('keeps the promotion draft open for warnings and resubmits an attributable override', async () => {
    const user = userEvent.setup()
    const { client, jobs, opportunities } = makeClient({ jobs: [makeJob('job-1')] })
    jobs.promoteToOpportunity
      .mockResolvedValueOnce({
        status: 'promoted', resource: makeOpportunity('opp-new'), created: true,
        warnings: [{ code: 'fit', message: 'Fit needs review.' }], override: null, duplicateResolution: null,
        audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' },
      })
      .mockResolvedValueOnce({
        status: 'promoted', resource: makeOpportunity('opp-new'), created: false,
        warnings: [{ code: 'fit', message: 'Fit needs review.' }],
        override: { actor: DESKTOP_USER_ACTOR, rationale: 'Reviewed manually.', warningCodes: ['fit'] }, duplicateResolution: null,
        audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' },
      })
    render(<LifecycleWorkbench client={client} />)
    await user.click(await screen.findByRole('button', { name: /^Jobs/ }))
    const menu = await openRowMenu(user, /Acme.*Engineer/)
    await user.click(within(menu).getByRole('menuitem', { name: 'Promote to opportunity' }))
    await user.click(screen.getByRole('button', { name: 'Promote' }))

    const warnings = await screen.findByTestId('lifecycle-outcome-warnings')
    const promotionDialog = screen.getByRole('dialog', { name: 'Promote job to opportunity' })
    await user.selectOptions(within(promotionDialog).getByRole('combobox', { name: 'Fit' }), 'fit')
    await user.type(within(promotionDialog).getByRole('textbox', { name: /Rank/ }), '7')
    await user.click(within(warnings).getByRole('checkbox', { name: /fit/i }))
    await user.type(within(warnings).getByRole('textbox', { name: 'Override rationale' }), 'Reviewed manually.')
    await user.click(within(warnings).getByRole('button', { name: 'Override warnings' }))

    await waitFor(() => expect(jobs.promoteToOpportunity).toHaveBeenCalledTimes(2))
    expect(jobs.promoteToOpportunity.mock.calls[1]?.[0].idempotencyKey)
      .toBe(jobs.promoteToOpportunity.mock.calls[0]?.[0].idempotencyKey)
    expect(jobs.promoteToOpportunity).toHaveBeenLastCalledWith(expect.objectContaining({
      override: { actor: DESKTOP_USER_ACTOR, rationale: 'Reviewed manually.', warningCodes: ['fit'] },
      evaluation: expect.objectContaining({ fit: 'fit', rank: 7 }),
    }))
    await waitFor(() => expect(jobs.list).toHaveBeenCalledTimes(6))
    await waitFor(() => expect(opportunities.list).toHaveBeenCalledTimes(3))
  })

  it('seeds Job corrections from the row and preserves non-edited facts and evidence references', async () => {
    const user = userEvent.setup()
    const job = makeJob('job-1', {
      facts: {
        ...makeJob('seed').facts,
        // A stale stored `term` is never carried into a correction; it is reprojected from `terms`.
        term: 'Fall 2026 internship',
        terms: [{ season: 'fall', year: 2026 }],
        startDate: '2026-09-01',
        location: { display: 'Denver', city: 'Denver', region: 'CO', country: 'US' },
        destination: { class: 'employer_or_ats', url: 'https://example.com/jobs/1' },
      },
      captureEvidenceReferences: [{ captureId: 'cap-1', captureRevision: 3, evidenceIndexes: [0] }],
    })
    const { client, jobs } = makeClient({ jobs: [job] })
    render(<LifecycleWorkbench client={client} />)
    await user.click(await screen.findByRole('button', { name: /^Jobs/ }))
    const menu = await openRowMenu(user, /Acme.*Engineer/)
    await user.click(within(menu).getByRole('menuitem', { name: 'Correct facts' }))
    expect(screen.getByRole('textbox', { name: 'Company name' })).toHaveValue('Acme')
    await user.type(screen.getByRole('textbox', { name: 'Rationale' }), 'Title verified.')
    await user.click(screen.getByRole('button', { name: 'Correct' }))

    await waitFor(() => expect(jobs.correctFacts).toHaveBeenCalledTimes(1))
    expect(jobs.correctFacts).toHaveBeenCalledWith(expect.objectContaining({
      rationale: 'Title verified.',
      facts: expect.objectContaining({
        term: 'Fall 2026',
        terms: [{ season: 'fall', year: 2026 }],
        startDate: '2026-09-01',
        location: job.facts.location,
        destination: job.facts.destination,
      }),
      evidenceReferences: job.captureEvidenceReferences,
    }))
  })

  it('keeps the modal open and reports refresh failure instead of stale success', async () => {
    const user = userEvent.setup()
    const { client, captureResolution } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await screen.findByText('No captures')
    captureResolution.list.mockRejectedValueOnce(new Error('refresh unavailable'))
    await user.click(screen.getByRole('button', { name: 'Add capture' }))
    await user.type(screen.getByRole('textbox', { name: 'Source id' }), 'manual')
    await user.type(screen.getByRole('textbox', { name: 'Source version' }), '1.0.0')
    await user.type(screen.getByRole('textbox', { name: 'Observed at' }), '2025-01-01T00:00')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByTestId('lifecycle-outcome-error')).toHaveTextContent('refresh unavailable')
    expect(screen.getByRole('dialog', { name: 'Add capture' })).toBeInTheDocument()
    expect(screen.queryByTestId('lifecycle-outcome-succeeded')).not.toBeInTheDocument()
  })

  it('preserves the form draft when validation fails', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await screen.findByText('No captures')
    await user.click(screen.getByRole('button', { name: 'Add capture' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Source id is required.')).toBeInTheDocument()
    expect(captures.create).not.toHaveBeenCalled()
  })

  it('refreshes on window focus via the invalidation hook', async () => {
    const { client, captureResolution } = makeClient({ captures: [makeCapture('cap-1')] })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })
    expect(captureResolution.list).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(captureResolution.list).toHaveBeenCalledTimes(2))
  })

  it('coalesces overlapping focus events into a single refresh', async () => {
    const { client, captureResolution } = makeClient({ captures: [makeCapture('cap-1')] })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })
    const callsBefore = captureResolution.list.mock.calls.length
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(captureResolution.list.mock.calls.length).toBe(callsBefore + 1))
  })

  it('renders the desktop user actor attribution as stable and unchanged across modals', () => {
    expect(DESKTOP_USER_ACTOR.id).toBe('valedictorian-desktop-user')
    expect(DESKTOP_USER_ACTOR.type).toBe('user')
  })
})

describe('LifecycleOutcomeView warning/error separation (contract)', () => {
  it('warnings render outside the alert role and errors inside it', () => {
    const errorOutcome: LifecycleOutcome = {
      kind: 'error',
      blocker: { code: 'invalid_input', message: 'bad' },
      message: 'bad',
    }
    const warningOutcome: LifecycleOutcome = {
      kind: 'warnings',
      warnings: [{ code: 'fit', message: 'maybe' }],
      override: null,
    }
    const { rerender } = render(<LifecycleOutcomeView outcome={errorOutcome} />)
    expect(screen.getByRole('alert')).toHaveTextContent('bad')
    rerender(<LifecycleOutcomeView outcome={warningOutcome} onOverrideWarnings={() => {}} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('lifecycle-outcome-warnings')).toBeInTheDocument()
  })
})
