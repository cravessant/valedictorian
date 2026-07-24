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
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'

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
  client: ValedictorianWorkspaceClient
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
    list: vi.fn(async () => ({ items: seed.captures ?? [], limit: 100, nextCursor: null })),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeCapture('cap-new'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    correct: vi.fn(async () => ({ status: 'succeeded' as const, resource: makeCapture('cap-1'), duplicateResolution: null, audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    remove: vi.fn(async () => ({ status: 'removed' as const, id: 'cap-1', choice: 'preserve_historical_lineage' as const, removedAt: '2025-01-01T00:00:00Z', affectedDependentIds: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    restore: vi.fn(async () => ({ status: 'restored' as const, id: 'cap-1', restoredAt: '2025-01-01T00:00:00Z', dependentLinks: [], audit: { actor: DESKTOP_USER_ACTOR, timestamp: '2025-01-01T00:00:00Z' } })),
    history: vi.fn(async () => ({ items: [], limit: 50, nextCursor: null })),
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
    captureResolution,
    jobs,
    companyAssignments,
    opportunities,
    applications,
  } as unknown as ValedictorianWorkspaceClient
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
  const trigger = screen.getByRole('button', { name: new RegExp(`Actions for row ${label}`) })
  await user.click(trigger)
  return await screen.findByRole('menu', { name: new RegExp(`Row actions for ${label}`) })
}

describe('LifecycleWorkbench action matrices and modal flows', () => {
  beforeEach(() => { __resetLifecycleActorCounterForTests() })

  it('does not expose the superseded Capture row-action menu', async () => {
    const { client } = makeClient({ captures: [makeCapture('cap-1')] })
    render(<LifecycleWorkbench client={client} />)
    const table = await screen.findByRole('table', { name: 'Captures' })
    expect(within(table).queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument()
    expect(screen.queryByText('Promote to job')).not.toBeInTheDocument()
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
