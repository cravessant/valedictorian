// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CompanySearchResult,
  Job,
  JobCompanyAssignmentPresentation,
} from '@sparxie/sdk'
import type { LocalWorkspaceClientV2 } from '@/runtime/local-connector-client.contract'

import { renderWithQueryClient } from '@/test/query-client'
import { useJobEditController } from './job-edit-controller'

afterEach(cleanup)

const CURRENT_COMPANY_ID = '01900000-0000-7000-8000-000000000002'
const DESTINATION_COMPANY_ID = '01900000-0000-7000-8000-000000000003'

const job = {
  id: '01900000-0000-7000-8000-000000000001',
  factsRevision: 4,
  facts: {
    companyName: 'Posting Company',
    roleTitle: 'Engineer',
    sourceName: 'LinkedIn',
    roleKind: 'new_grad',
    term: null,
    terms: [],
    timingMode: 'unknown',
    startDate: null,
    endDate: null,
    location: { display: 'Denver', city: 'Denver', region: 'CO', country: 'US' },
    workMode: 'unknown',
    employmentType: 'full_time',
    seniority: 'entry',
    compensation: null,
    postedAt: null,
    destination: { class: 'employer_or_ats', url: 'https://example.com/jobs/1' },
  },
  captureEvidenceReferences: [{ captureId: 'cap-1', captureRevision: 2, evidenceIndexes: [0] }],
  availability: { state: 'unknown', observedAt: '2025-01-01T00:00:00Z' },
  availabilityRevision: 1,
  removedAt: null,
} as unknown as Job

const assignment = {
  jobId: job.id,
  assignmentRevision: 6,
  workspaceCompany: {
    companyId: CURRENT_COMPANY_ID,
    revision: 3,
    displayName: 'Current Company',
    status: 'active',
  },
  jobFactsCompanyName: 'Posting Company',
  roleTitle: 'Engineer',
  namesDiffer: true,
} as JobCompanyAssignmentPresentation

const destination = {
  companyId: DESTINATION_COMPANY_ID,
  revision: 11,
  displayName: 'Destination Company',
  websiteUrl: null,
  status: 'active',
  assignedJobCount: 1,
} as unknown as CompanySearchResult

/** The assignment another actor left behind while the editor held the old guard. */
const rebasedAssignment = {
  ...assignment,
  assignmentRevision: 9,
  workspaceCompany: {
    companyId: '01900000-0000-7000-8000-000000000004',
    revision: 2,
    displayName: 'Rebased Company',
    status: 'active',
  },
} as JobCompanyAssignmentPresentation

const staleReassignment = {
  status: 'blocked',
  failure: {
    kind: 'stale_guard',
    blocker: {
      code: 'impossible_state',
      message: 'The Company assignment changed. Refresh and choose again.',
    },
    recovery: { action: 'refresh_and_resubmit', guards: [] },
  },
}

function correctedJob(companyName: string): Job {
  return {
    ...job,
    factsRevision: 5,
    facts: { ...job.facts, companyName },
  } as Job
}

function makeClient(overrides: {
  readonly reassign?: ReturnType<typeof vi.fn>
  readonly correctFacts?: ReturnType<typeof vi.fn>
  readonly assignmentGet?: ReturnType<typeof vi.fn>
} = {}) {
  const correctFacts = overrides.correctFacts ?? vi.fn(async (_input: unknown) => ({
    status: 'succeeded',
    resource: job,
    duplicateResolution: null,
  }))
  const reassign = overrides.reassign ?? vi.fn(async () => ({
    status: 'reassigned',
    assignment,
    jobFactsChanged: false,
  }))
  const assignmentGet = overrides.assignmentGet ?? vi.fn(async () => rebasedAssignment)
  const search = vi.fn(async () => ({ items: [destination], truncated: false }))
  const client = {
    jobs: { correctFacts },
    companies: { search, previewMatches: vi.fn(async () => ({ items: [], truncated: false })) },
    companyAssignments: { reassign, get: assignmentGet },
  } as unknown as LocalWorkspaceClientV2
  return { client, correctFacts, reassign, assignmentGet, search }
}

function Harness({
  client,
  refresh,
  withAssignment = true,
}: {
  readonly client: LocalWorkspaceClientV2
  readonly refresh: () => void
  readonly withAssignment?: boolean
}) {
  const controller = useJobEditController({
    assignments: withAssignment ? new Map([[job.id, assignment]]) : new Map(),
    client,
    refresh,
    workspaceId: 'workspace-1',
  })
  return (
    <div>
      <button type="button" onClick={() => void controller.action.onActivate(job)}>
        {controller.action.label}
      </button>
      {controller.modalLayer}
    </div>
  )
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Edit job' }))
  return await screen.findByRole('dialog', { name: 'Edit job' })
}

/** Re-read the live editor; a stale-guard rebase replaces the mounted form. */
function editor() {
  return screen.getByRole('dialog', { name: 'Edit job' })
}

async function chooseDestination(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(within(editor()).getByRole('combobox', { name: 'Assigned Company' }))
  await user.type(within(editor()).getByRole('combobox', { name: 'Assigned Company' }), 'Dest')
  await user.click(await within(editor()).findByRole('option', { name: 'Destination Company' }))
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(editor()).getByRole('button', { name: 'Save job' }))
}

describe('useJobEditController', () => {
  it('reassigns the chosen Company under the assignment and destination revisions', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn()
    const { client, correctFacts, reassign } = makeClient()
    renderWithQueryClient(<Harness client={client} refresh={refresh} />)

    const dialog = await openEditor(user)
    await chooseDestination(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Rationale' }), 'Wrong employer.')
    await user.click(within(dialog).getByRole('button', { name: 'Save job' }))

    await waitFor(() => expect(reassign).toHaveBeenCalledTimes(1))
    expect(reassign).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      jobId: job.id,
      expectedAssignmentRevision: 6,
      destinationCompanyId: DESTINATION_COMPANY_ID,
      expectedDestinationCompanyRevision: 11,
      rationale: 'Wrong employer.',
    }))
    expect(correctFacts).not.toHaveBeenCalled()
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('never assigns typed Company text that was not chosen from the suggestions', async () => {
    const user = userEvent.setup()
    const { client, correctFacts, reassign } = makeClient()
    renderWithQueryClient(<Harness client={client} refresh={vi.fn()} />)

    const dialog = await openEditor(user)
    const company = within(dialog).getByRole('combobox', { name: 'Assigned Company' })
    await user.clear(company)
    await user.type(company, 'Totally New Company')
    const posting = within(dialog).getByRole('textbox', { name: 'Posting company text' })
    await user.clear(posting)
    await user.type(posting, 'Renamed Posting')
    await user.type(within(dialog).getByRole('textbox', { name: 'Rationale' }), 'Posting typo.')
    expect(within(dialog).getByText('Selected Company: Current Company')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save job' }))

    await waitFor(() => expect(correctFacts).toHaveBeenCalledTimes(1))
    expect(reassign).not.toHaveBeenCalled()
  })

  it('never replays a committed facts correction while recovering a stale assignment', async () => {
    const user = userEvent.setup()
    const corrected = correctedJob('Corrected Posting Name')
    const correctFacts = vi.fn(async (_input: unknown) => ({
      status: 'succeeded',
      resource: corrected,
      duplicateResolution: null,
    }))
    const reassign = vi.fn()
      .mockResolvedValueOnce(staleReassignment)
      .mockResolvedValueOnce({ status: 'reassigned', assignment, jobFactsChanged: false })
    const { client, assignmentGet } = makeClient({ correctFacts, reassign })
    renderWithQueryClient(<Harness client={client} refresh={vi.fn()} />)

    await openEditor(user)
    const posting = within(editor()).getByRole('textbox', { name: 'Posting company text' })
    await user.clear(posting)
    await user.type(posting, 'Corrected Posting Name')
    await chooseDestination(user)
    await user.type(within(editor()).getByRole('textbox', { name: 'Rationale' }), 'Wrong employer.')
    await save(user)

    await waitFor(() => expect(correctFacts).toHaveBeenCalledTimes(1))
    expect(correctFacts.mock.calls[0]?.[0]).toMatchObject({ expectedFactsRevision: 4 })
    await waitFor(() => expect(assignmentGet).toHaveBeenCalledWith(job.id))
    await waitFor(() => expect(
      within(editor()).getByText('Selected Company: Rebased Company'),
    ).toBeInTheDocument())
    expect(within(editor()).getByRole('textbox', { name: 'Posting company text' }))
      .toHaveValue('Corrected Posting Name')

    await chooseDestination(user)
    await save(user)

    await waitFor(() => expect(reassign).toHaveBeenCalledTimes(2))
    expect(correctFacts).toHaveBeenCalledTimes(1)
    expect(reassign.mock.calls[1]?.[0]).toMatchObject({
      expectedAssignmentRevision: 9,
      destinationCompanyId: DESTINATION_COMPANY_ID,
      expectedDestinationCompanyRevision: 11,
    })
    expect(reassign.mock.calls[1]?.[0].idempotencyKey)
      .not.toBe(reassign.mock.calls[0]?.[0].idempotencyKey)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit job' })).not.toBeInTheDocument())
  })
})
