// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Application,
  Capture,
  Job,
  Opportunity,
  ValedictorianWorkspaceClient,
} from 'sparxie'

import { LifecycleWorkbench } from './lifecycle-workbench'
import {
  DESKTOP_USER_ACTOR,
  __resetLifecycleActorCounterForTests,
} from './lifecycle-actor'
import type { LifecycleOutcome } from './lifecycle-outcome-types'
import { LifecycleOutcomeView } from './lifecycle-outcome-view'

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
  client: ValedictorianWorkspaceClient
  captures: Record<string, ReturnType<typeof vi.fn>>
  jobs: Record<string, ReturnType<typeof vi.fn>>
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
    list: vi.fn(async () => ({ items: seed.captures ?? [], limit: 100, nextCursor: null })),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeCapture('cap-new'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    correct: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeCapture('cap-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    remove: vi.fn(async () => ({ status: 'removed' as const, id: 'cap-1', choice: 'preserve_historical_lineage' as const, removedAt: '2025-01-01T00:00:00Z', affectedDependentIds: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    restore: vi.fn(async () => ({ status: 'restored' as const, id: 'cap-1', restoredAt: '2025-01-01T00:00:00Z', dependentLinks: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    history: vi.fn(async () => ({ items: [], limit: 50, nextCursor: null })),
    promoteToJob: vi.fn(async () => ({ status: 'promoted' as const, resource: makeJob('job-new'), created: true, warnings: [], override: null, duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
  }
  const jobs = {
    list: vi.fn(async () => ({ items: seed.jobs ?? [], limit: 100, nextCursor: null })),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeJob('job-new'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    correctFacts: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeJob('job-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateAvailability: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeJob('job-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    externalIdentities: { add: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) },
    remove: vi.fn(async () => ({ status: 'removed' as const, id: 'job-1', choice: 'preserve_historical_lineage' as const, removedAt: '2025-01-01T00:00:00Z', affectedDependentIds: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    restore: vi.fn(async () => ({ status: 'restored' as const, id: 'job-1', restoredAt: '2025-01-01T00:00:00Z', dependentLinks: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    history: vi.fn(async () => ({ items: [], limit: 50, nextCursor: null })),
    promoteToOpportunity: vi.fn(async () => ({ status: 'promoted' as const, resource: makeOpportunity('opp-new'), created: true, warnings: [], override: null, duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
  }
  const opportunities = {
    list: vi.fn(async () => ({ items: seed.opportunities ?? [], limit: 100, nextCursor: null })),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeOpportunity('opp-new'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateEvaluation: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeOpportunity('opp-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateDisposition: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeOpportunity('opp-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    remove: vi.fn(async () => ({ status: 'removed' as const, id: 'opp-1', choice: 'preserve_historical_lineage' as const, removedAt: '2025-01-01T00:00:00Z', affectedDependentIds: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    restore: vi.fn(async () => ({ status: 'restored' as const, id: 'opp-1', restoredAt: '2025-01-01T00:00:00Z', dependentLinks: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    history: vi.fn(async () => ({ items: [], limit: 50, nextCursor: null })),
    promoteToApplication: vi.fn(async () => ({ status: 'promoted' as const, resource: makeApplication('app-new'), created: true, warnings: [], override: null, duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
  }
  const applications = {
    list: vi.fn(async () => ({ items: seed.applications ?? [], limit: 100, nextCursor: null })),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeApplication('app-new'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateStatus: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeApplication('app-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateCompany: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeApplication('app-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    updateSource: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeApplication('app-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    links: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) },
    refreshSnapshot: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({ status: 'removed' as const, id: 'app-1', choice: 'preserve_historical_lineage' as const, removedAt: '2025-01-01T00:00:00Z', affectedDependentIds: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    restore: vi.fn(async () => ({ status: 'restored' as const, id: 'app-1', restoredAt: '2025-01-01T00:00:00Z', dependentLinks: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    history: vi.fn(async () => ({ items: [], limit: 50, nextCursor: null })),
    attempts: { list: vi.fn(async () => ({ items: [], limit: 50, nextCursor: null })) },
    events: { list: vi.fn(async () => ({ items: [], limit: 50, nextCursor: null })) },
  }
  const client = { captures, jobs, opportunities, applications } as unknown as ValedictorianWorkspaceClient
  return { client, captures, jobs, opportunities, applications }
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, rowLabel: string | RegExp) {
  const label = rowLabel instanceof RegExp ? rowLabel.source : rowLabel
  const trigger = screen.getByRole('button', { name: new RegExp(`Actions for row ${label}`) })
  await user.click(trigger)
  return await screen.findByRole('menu', { name: new RegExp(`Row actions for ${label}`) })
}

describe('LifecycleWorkbench action matrices and modal flows', () => {
  beforeEach(() => { __resetLifecycleActorCounterForTests() })

  it('reports live lineage without inventing technical processing revisions', async () => {
    const user = userEvent.setup()
    const capture = makeCapture('cap-1')
    const job = makeJob('job-1', {
      factsRevision: 3,
      captureEvidenceReferences: [{
        captureId: capture.id,
        captureRevision: capture.revision,
        evidenceIndexes: [],
      }],
    })
    const opportunity = makeOpportunity('opp-1', { jobId: job.id, revision: 2 })
    const { client } = makeClient({ captures: [capture], jobs: [job], opportunities: [opportunity] })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })

    await user.click(screen.getByRole('radio', { name: 'Processing' }))
    const row = within(screen.getByRole('table', { name: 'Capture processing' }))
      .getByRole('row', { name: /jobright/ })
    expect(row).toHaveTextContent('Linked to job-1; processing status unavailable')
    expect(row).toHaveTextContent('Technical status unavailable')
    expect(row).toHaveTextContent('Admitted as opp-1')
    expect(row).toHaveTextContent('Technical status unavailable')
    expect(row).not.toHaveTextContent('Normalized facts revision 3')
    expect(row).not.toHaveTextContent('Projection revision 2')
  })

  it('keeps unavailable technical stages distinct from aggregate admission', async () => {
    const user = userEvent.setup()
    const capture = makeCapture('cap-pending')
    const { client } = makeClient({ captures: [capture] })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })

    await user.click(screen.getByRole('radio', { name: 'Processing' }))
    const row = within(screen.getByRole('table', { name: 'Capture processing' }))
      .getByRole('row', { name: /jobright/ })
    expect(row).toHaveTextContent('No linked Job; processing status unavailable')
    expect(row).toHaveTextContent('Technical status unavailable')
    expect(row).toHaveTextContent('No linked Job')
    expect(row).toHaveTextContent('Technical status unavailable')
  })

  it('exposes Add/Correct/Remove/Restore/History/Promote actions for Capture and routes each to the typed client method', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient({ captures: [makeCapture('cap-1')] })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })

    const menu = await openRowMenu(user, 'jobright')
    const labels = within(menu).getAllByRole('menuitem').map((item) => item.textContent)
    expect(labels).toEqual(expect.arrayContaining([
      'Add capture', 'Correct capture', 'Remove capture', 'View history', 'Promote to job',
    ]))

    // Restore should be disabled for a non-removed row
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove capture' }))
    const removeDialog = await screen.findByRole('dialog', { name: 'Remove capture' })
    await user.type(screen.getByRole('textbox', { name: 'Rationale' }), 'Stale.')
    await user.click(within(removeDialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(captures.remove).toHaveBeenCalledTimes(1))
    expect(captures.remove).toHaveBeenCalledWith(expect.objectContaining({
      id: 'cap-1',
      actor: DESKTOP_USER_ACTOR,
      choice: 'preserve_historical_lineage',
      rationale: 'Stale.',
    }))
  })

  it('Add Capture opens a modal, submits with the typed CreateCaptureInput, and awaits refresh before success', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await screen.findByText('No captures')

    await user.click(screen.getByRole('button', { name: 'Add capture' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add capture' })
    await user.type(screen.getByRole('textbox', { name: 'Adapter id' }), 'jobright')
    await user.type(screen.getByRole('textbox', { name: 'Adapter version' }), '0.1.0')
    await user.type(screen.getByRole('textbox', { name: 'Observed at' }), '2025-01-01T00:00')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(captures.create).toHaveBeenCalledTimes(1))
    expect(captures.create).toHaveBeenCalledWith(expect.objectContaining({
      evidenceMode: 'reported',
      adapter: { id: 'jobright', kind: 'manual', version: '0.1.0' },
      observedAt: '2025-01-01T00:00',
    }))
  })

  it('does not announce a fake mutation success when a modal-opening action is activated', async () => {
    const user = userEvent.setup()
    const { client } = makeClient({ captures: [makeCapture('cap-1')] })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })

    const menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'View history' }))
    await screen.findByRole('dialog', { name: /History · cap-1/ })
    expect(screen.queryByTestId('lifecycle-mutation-status')).not.toBeInTheDocument()
  })

  it('Capture promotion refreshes both the source and destination phases', async () => {
    const user = userEvent.setup()
    const { client, captures, jobs } = makeClient({ captures: [makeCapture('cap-1')] })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })
    const menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'Promote to job' }))
    await user.type(screen.getByRole('textbox', { name: 'Company name' }), 'Acme')
    await user.type(screen.getByRole('textbox', { name: 'Role title' }), 'Engineer')
    await user.type(screen.getByRole('textbox', { name: 'Source name' }), 'Direct')
    await user.click(screen.getByRole('button', { name: 'Promote' }))

    await waitFor(() => expect(captures.promoteToJob).toHaveBeenCalledTimes(1))
    expect(captures.promoteToJob).toHaveBeenCalledWith(expect.objectContaining({
      captureId: 'cap-1',
      captureRevision: 1,
      selectedFacts: expect.objectContaining({ location: null }),
    }))
    await waitFor(() => {
      expect(captures.list).toHaveBeenCalledTimes(2)
      expect(jobs.list).toHaveBeenCalledTimes(4)
    })
  })

  it('Restore is enabled only for removed rows (Show removed surfaces the target)', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient({
      captures: [makeCapture('cap-1', { removedAt: '2025-01-02T00:00:00Z' })],
    })
    render(<LifecycleWorkbench client={client} />)
    await waitFor(() => expect(screen.getByRole('table', { name: 'Captures' })).toBeInTheDocument())

    await user.click(screen.getByRole('checkbox', { name: 'Show removed' }))
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(captures.list).toHaveBeenCalled())
    const menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'Restore capture' }))
    const dialog = await screen.findByRole('dialog', { name: 'Restore capture' })
    await user.type(screen.getByRole('textbox', { name: 'Rationale' }), 'Reopen.')
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(captures.restore).toHaveBeenCalledTimes(1))
    expect(captures.restore).toHaveBeenCalledWith(expect.objectContaining({
      id: 'cap-1',
      actor: DESKTOP_USER_ACTOR,
      rationale: 'Reopen.',
    }))
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

  it('shows a successful removal outcome summary and refreshes after a removal', async () => {
    const user = userEvent.setup()
    const { client, captures, jobs, opportunities, applications } = makeClient({ captures: [makeCapture('cap-1')] })
    captures.remove.mockResolvedValueOnce({
      status: 'removed', id: 'cap-1', choice: 'preserve_historical_lineage',
      removedAt: '2025-01-03T00:00:00Z', affectedDependentIds: ['dep-1', 'dep-2'],
      audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-03T00:00:00Z' },
    })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })
    const menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove capture' }))
    await user.type(screen.getByRole('textbox', { name: 'Rationale' }), 'Gone.')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(captures.remove).toHaveBeenCalledTimes(1))
    // Refresh should fire after the removal succeeds
    await waitFor(() => expect(captures.list).toHaveBeenCalledTimes(2))
    expect(jobs.list).toHaveBeenCalledTimes(4)
    expect(opportunities.list).toHaveBeenCalledTimes(2)
    expect(applications.list).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('lifecycle-outcome-removed')).toHaveTextContent('dep-1')
  })

  it('shows a blocked-removal outcome with dependent ids and supported choices, requiring rationale to resolve', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient({ captures: [makeCapture('cap-1')] })
    captures.remove
      .mockResolvedValueOnce({
        status: 'blocked', id: 'cap-1',
        blocker: { code: 'bounded_data_violation', message: 'Dependents exist.' },
        supportedChoices: ['preserve_historical_lineage', 'unlink_dependents'],
        dependentIds: ['job-1'],
      })
      .mockResolvedValueOnce({
        status: 'removed', id: 'cap-1', choice: 'unlink_dependents',
        removedAt: '2025-01-03T00:00:00Z', affectedDependentIds: [],
        audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-03T00:00:00Z' },
      })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })
    const menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove capture' }))
    await user.type(screen.getByRole('textbox', { name: 'Rationale' }), 'Initial.')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const blocked = await screen.findByTestId('lifecycle-outcome-removal-blocked')
    expect(blocked).toHaveTextContent('bounded_data_violation')
    expect(screen.getByText('job-1')).toBeInTheDocument()
    await user.selectOptions(within(blocked).getByRole('combobox', { name: 'Removal choice' }), 'unlink_dependents')
    await user.type(within(blocked).getByRole('textbox', { name: 'Rationale' }), 'Detach it.')
    await user.click(within(blocked).getByRole('button', { name: 'Confirm removal' }))
    await waitFor(() => expect(captures.remove).toHaveBeenCalledTimes(2))
    expect(captures.remove).toHaveBeenLastCalledWith(expect.objectContaining({
      choice: 'unlink_dependents',
      rationale: 'Detach it.',
    }))
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
        term: 'Fall 2026',
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
        startDate: '2026-09-01',
        location: job.facts.location,
        destination: job.facts.destination,
      }),
      evidenceReferences: job.captureEvidenceReferences,
    }))
  })

  it('keeps the modal open and reports refresh failure instead of stale success', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await screen.findByText('No captures')
    captures.list.mockRejectedValueOnce(new Error('refresh unavailable'))
    await user.click(screen.getByRole('button', { name: 'Add capture' }))
    await user.type(screen.getByRole('textbox', { name: 'Adapter id' }), 'manual')
    await user.type(screen.getByRole('textbox', { name: 'Adapter version' }), '1.0.0')
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
    expect(await screen.findByText('Adapter id is required.')).toBeInTheDocument()
    expect(captures.create).not.toHaveBeenCalled()
  })

  it('refreshes on window focus via the invalidation hook', async () => {
    const { client, captures } = makeClient({ captures: [makeCapture('cap-1')] })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })
    expect(captures.list).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(captures.list).toHaveBeenCalledTimes(2))
  })

  it('refreshes Capture, Job, and Opportunity data while Processing is active', async () => {
    const user = userEvent.setup()
    const { client, captures, jobs, opportunities } = makeClient({ captures: [makeCapture('cap-1')] })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })
    await user.click(screen.getByRole('radio', { name: 'Processing' }))
    const callsBefore = {
      captures: captures.list.mock.calls.length,
      jobs: jobs.list.mock.calls.length,
      opportunities: opportunities.list.mock.calls.length,
    }

    window.dispatchEvent(new Event('focus'))
    await waitFor(() => {
      expect(captures.list).toHaveBeenCalledTimes(callsBefore.captures + 1)
      expect(jobs.list).toHaveBeenCalledTimes(callsBefore.jobs + 2)
      expect(opportunities.list).toHaveBeenCalledTimes(callsBefore.opportunities + 1)
    })

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(captures.list).toHaveBeenCalledTimes(callsBefore.captures + 2)
      expect(jobs.list).toHaveBeenCalledTimes(callsBefore.jobs + 4)
      expect(opportunities.list).toHaveBeenCalledTimes(callsBefore.opportunities + 2)
    })
  })

  it('coalesces overlapping focus events into a single refresh', async () => {
    const { client, captures } = makeClient({ captures: [makeCapture('cap-1')] })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })
    const callsBefore = captures.list.mock.calls.length
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(captures.list.mock.calls.length).toBe(callsBefore + 1))
  })

  it('History modal loads real history entries read-only', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient({ captures: [makeCapture('cap-1')] })
    captures.history.mockResolvedValueOnce({
      items: [{
        captureId: 'cap-1', revision: 1, kind: 'created',
        snapshot: makeCapture('cap-1'),
        audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' },
        connectorProvenance: {
          connectorInstanceId: 'jobright-one',
          connectorRunId: 'run-one',
          executionScopeId: 'scope.run-one',
          reportedOrigin: { kind: 'job_board', name: 'Jobright' },
        },
      }],
      limit: 50, nextCursor: null,
    })
    const openProvenance = vi.fn()
    render(<LifecycleWorkbench client={client} onOpenConnectorProvenance={openProvenance} />)
    await screen.findByRole('table', { name: 'Captures' })
    const menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'View history' }))
    await screen.findByRole('dialog', { name: /History · cap-1/ })
    await waitFor(() => expect(captures.history).toHaveBeenCalledWith(expect.objectContaining({ id: 'cap-1', limit: 50 })))
    await user.click(screen.getByRole('button', { name: 'Open connector run run-one' }))
    await user.click(screen.getByRole('button', { name: 'Open connector instance jobright-one' }))
    await user.click(screen.getByRole('button', { name: 'Open connector scope scope.run-one' }))
    expect(openProvenance).toHaveBeenCalledTimes(3)
    expect(openProvenance).toHaveBeenNthCalledWith(1, {
      connectorRunId: 'run-one', id: 'run-one', kind: 'run',
    })
    expect(openProvenance).toHaveBeenNthCalledWith(2, {
      connectorRunId: 'run-one', id: 'jobright-one', kind: 'instance',
    })
    expect(openProvenance).toHaveBeenNthCalledWith(3, {
      connectorRunId: 'run-one', id: 'scope.run-one', kind: 'scope',
    })
    expect(screen.getByText(/reported by Jobright/)).toBeInTheDocument()
  })

  it('ignores a stale history completion after closing one row and opening another', async () => {
    const user = userEvent.setup()
    const second = makeCapture('cap-2', { adapter: { id: 'manual-b', kind: 'manual', version: '1' } })
    const { client, captures } = makeClient({ captures: [makeCapture('cap-1'), second] })
    let resolveFirst: ((value: Awaited<ReturnType<typeof captures.history>>) => void) | undefined
    captures.history
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({
        items: [{
          captureId: 'cap-2', revision: 2, kind: 'corrected', snapshot: second,
          audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-02T00:00:00Z' },
        }],
        limit: 50, nextCursor: null,
      })
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })

    let menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'View history' }))
    await user.click(within(await screen.findByRole('dialog', { name: /History · cap-1/ })).getByText('Close'))
    menu = await openRowMenu(user, 'manual-b')
    await user.click(within(menu).getByRole('menuitem', { name: 'View history' }))
    expect(await screen.findByText('r2 · corrected')).toBeInTheDocument()

    await act(async () => resolveFirst?.({ items: [], limit: 50, nextCursor: null }))
    expect(screen.getByRole('dialog', { name: /History · cap-2/ })).toBeInTheDocument()
    expect(screen.getByText('r2 · corrected')).toBeInTheDocument()
  })

  it('reloads when Show removed toggles (includeRemoved changes)', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await screen.findByText('No captures')
    expect(captures.list).toHaveBeenLastCalledWith(expect.objectContaining({ includeRemoved: false }))
    await user.click(screen.getByRole('checkbox', { name: 'Show removed' }))
    await waitFor(() => {
      expect(captures.list).toHaveBeenLastCalledWith(expect.objectContaining({ includeRemoved: true }))
    })
  })

  it('renders the desktop user actor attribution as stable and unchanged across modals', () => {
    expect(DESKTOP_USER_ACTOR.id).toBe('valedictorian-desktop-user')
    expect(DESKTOP_USER_ACTOR.type).toBe('user')
  })
})

describe('LifecycleWorkbench mutation-refresh fencing', () => {
  it('does not announce success when a mutation rejects; shows an error outcome and refreshes', async () => {
    const user = userEvent.setup()
    const { client, captures } = makeClient({ captures: [makeCapture('cap-1')] })
    captures.remove.mockRejectedValueOnce(new Error('network down'))
    render(<LifecycleWorkbench client={client} />)
    await screen.findByRole('table', { name: 'Captures' })
    const menu = await openRowMenu(user, 'jobright')
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove capture' }))
    await user.type(screen.getByRole('textbox', { name: 'Rationale' }), 'Try.')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByTestId('lifecycle-outcome-error')).toHaveTextContent('network down')
    expect(captures.remove).toHaveBeenCalledTimes(1)
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
