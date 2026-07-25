import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaptureCompletionDetail, Job, ValedictorianWorkspaceClient } from '@sparxie/sdk'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/components/ui/use-toast', () => ({ toast }))

import { CaptureCompletionModal } from './CaptureCompletionModal'

const detail = {
  captureId: 'cap-1', captureRevision: 1, expectedGenerationId: 'gen-1',
  sourceSummary: { displayName: 'Job board', provider: 'board', observedAt: '2026-07-23T00:00:00.000Z' },
  provenance: [], destination: { status: 'resolved', url: 'https://jobs.example.com/role' },
  rawEvidence: [{ captureRevision: 1, evidenceIndex: 0, label: 'Title', displayValue: 'Engineer' }],
  exactEvidenceReferences: [{ captureId: 'cap-1', captureRevision: 1, evidenceIndexes: [0] }],
  jobDefaults: { companyName: 'Example', roleTitle: 'Engineer' }, lastIssue: null,
} as CaptureCompletionDetail

const activeCompany = {
  companyId: 'company-active', revision: 3, displayName: 'Example Incorporated',
  websiteUrl: null, status: 'active', assignedJobCount: 2,
}
const archivedCompany = {
  companyId: 'company-archived', revision: 5, displayName: 'Example Archive',
  websiteUrl: null, status: 'archived', assignedJobCount: 0,
}

function recoveryJob(id: string, factsRevision = 8): Job {
  return {
    id: id as Job['id'],
    factsRevision,
    removedAt: null,
  } as Job
}

function recoveryAssignment(
  jobId: string,
  companyId = 'company-current',
  companyRevision = 7,
  assignmentRevision = 9,
) {
  return {
    jobId,
    assignmentRevision,
    workspaceCompany: {
      companyId,
      revision: companyRevision,
      displayName: companyId === 'company-destination' ? 'Destination Company' : 'Current Company',
      status: 'active' as const,
    },
    jobFactsCompanyName: 'Current Company',
    roleTitle: 'Engineer',
    namesDiffer: false,
  }
}

afterEach(() => {
  cleanup()
  toast.mockReset()
  vi.restoreAllMocks()
})

function makeClient(options: {
  readonly complete?: ReturnType<typeof vi.fn>
  readonly get?: ReturnType<typeof vi.fn>
  readonly lookup?: ReturnType<typeof vi.fn>
  readonly search?: ReturnType<typeof vi.fn>
  readonly jobsGet?: ReturnType<typeof vi.fn>
  readonly assignmentGet?: ReturnType<typeof vi.fn>
  readonly reassign?: ReturnType<typeof vi.fn>
} = {}) {
  const complete = options.complete ?? vi.fn().mockResolvedValue({
    status: 'created', jobId: 'job-1', companyId: 'company-1', createdJob: true,
    existingJobComparison: 'not_compared',
  })
  const search = options.search ?? vi.fn().mockResolvedValue({
    items: [activeCompany, archivedCompany], truncated: false,
  })
  const jobsGet = options.jobsGet ?? vi.fn(async (jobId: string) => recoveryJob(jobId))
  const assignmentGet = options.assignmentGet ?? vi.fn(async (jobId: string) => recoveryAssignment(jobId))
  const reassign = options.reassign ?? vi.fn().mockResolvedValue({ status: 'reassigned' })
  const lookup = options.lookup ?? vi.fn(async (companyId: string) => ({
    requested: {
      id: companyId,
      revision: companyId === 'company-destination' ? 8 : 7,
      displayName: companyId === 'company-destination' ? 'Destination Company' : 'Current Company',
      status: 'active',
    },
  }))
  const client = {
    captureResolution: {
      get: options.get ?? vi.fn().mockResolvedValue(detail),
      complete,
    },
    companies: {
      previewMatches: vi.fn().mockResolvedValue({ items: [], truncated: false }),
      search,
      lookup,
    },
    jobs: { get: jobsGet },
    companyAssignments: { get: assignmentGet, reassign },
  } as unknown as Pick<
    ValedictorianWorkspaceClient,
    'captureResolution' | 'companies' | 'jobs' | 'companyAssignments'
  >
  return { client, complete, search, jobsGet, assignmentGet, reassign, lookup }
}

function renderModal(
  client: Pick<
    ValedictorianWorkspaceClient,
    'captureResolution' | 'companies' | 'jobs' | 'companyAssignments'
  >,
  overrides: Partial<React.ComponentProps<typeof CaptureCompletionModal>> = {},
) {
  const onClose = overrides.onClose ?? vi.fn()
  const onCreated = overrides.onCreated ?? vi.fn()
  const onViewJob = overrides.onViewJob ?? vi.fn()
  render(
    <CaptureCompletionModal
      captureId="cap-1"
      client={client}
      intent={overrides.intent ?? { kind: 'complete_job_information' }}
      workspaceId={overrides.workspaceId ?? null}
      onClose={onClose}
      onCreated={onCreated}
      onAssignmentChanged={overrides.onAssignmentChanged}
      onViewJob={onViewJob}
      onRemoveCapture={overrides.onRemoveCapture}
      removalPending={overrides.removalPending}
    />,
  )
  return { onClose, onCreated, onViewJob }
}

function captureDialog() {
  return screen.getByRole('dialog', { name: 'Complete Capture into a Job' })
}

function captureCloseControl() {
  const close = captureDialog().querySelector<HTMLElement>('[data-slot="dialog-close"]')
  if (!close) throw new Error('Capture completion needs a top-right close control.')
  return close
}

function dialogOverlay() {
  const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
  if (!overlay) throw new Error('Capture completion needs a dialog overlay.')
  return overlay
}

const captureDismissalActions: ReadonlyArray<
  (user: ReturnType<typeof userEvent.setup>, footerLabel: 'Cancel' | 'Discard changes') => Promise<void>
> = [
  async (user) => user.click(captureCloseControl()),
  async (user) => user.click(dialogOverlay()),
  async (user) => user.keyboard('{Escape}'),
  async (user, footerLabel) => user.click(screen.getByRole('button', { name: footerLabel })),
]

async function closeCleanCompletionDraft(
  user: ReturnType<typeof userEvent.setup>,
  onClose: ReturnType<typeof vi.fn>,
) {
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(onClose).toHaveBeenCalledOnce()
}

async function searchExistingCompanies(
  user: ReturnType<typeof userEvent.setup>,
  search: ReturnType<typeof vi.fn>,
) {
  await user.click(screen.getByLabelText('Use an existing local Company'))
  await user.type(screen.getByLabelText('Search active local Companies'), 'Example')
  await waitFor(() => expect(search).toHaveBeenLastCalledWith({
    query: 'Example',
    scope: 'active',
    limit: 8,
  }))
}

describe('CaptureCompletionModal', () => {
  it('keeps source and resolved destination visible while raw evidence remains collapsed', async () => {
    const { client } = makeClient()
    renderModal(client)

    expect(await screen.findByRole('heading', { name: 'Complete Capture into a Job' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Provenance path' })).toHaveTextContent('Job board')
    expect(screen.getByRole('region', { name: 'Provenance path' })).toHaveTextContent('https://jobs.example.com/role')
    expect(screen.getByRole('region', { name: 'Capture source' })).toHaveTextContent('Job board')
    expect(screen.getByRole('region', { name: 'Job destination' })).toHaveTextContent('Employer or ATS URL')
    expect(screen.getByText('Raw evidence (1)')).toBeInTheDocument()
    expect(document.querySelector('details')?.open).toBe(false)
    const shell = screen.getByRole('dialog')
    expect(shell).toHaveAttribute('data-probe', 'capture-completion-shell')
    expect(shell).toHaveClass('flex', 'flex-col', 'h-[100dvh]', 'w-full', 'min-w-0', 'overflow-hidden', 'sm:max-w-[72rem]')
    expect(document.querySelector('[data-probe="capture-completion-body"]')).toHaveClass('min-h-0', 'min-w-0', 'flex-1', 'overflow-y-auto')
    expect(document.querySelector('[data-probe="capture-completion-header"]')).toHaveClass('shrink-0')
    expect(document.querySelector('[data-probe="capture-completion-footer"]')).toHaveClass('shrink-0')
    expect(screen.getByRole('region', { name: 'Provenance path' })).toHaveClass('min-w-0')
    expect(screen.getByRole('region', { name: 'Capture source' })).toHaveClass('min-w-0')
    expect(screen.getByRole('region', { name: 'Job destination' })).toHaveClass('min-w-0')
    expect(document.querySelector('[data-probe="capture-completion-raw-evidence"]')).toHaveClass('max-w-full', 'overflow-x-auto')
  })

  it('uses Cancel and closes a clean dialog from every dismissal affordance', async () => {
    for (const exit of captureDismissalActions) {
      cleanup()
      const user = userEvent.setup()
      const { client } = makeClient()
      const { onClose } = renderModal(client)

      expect(await screen.findByLabelText('Job facts company')).toHaveFocus()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      await exit(user, 'Cancel')
      expect(onClose).toHaveBeenCalledOnce()
    }
  })

  it('submits explicit create-local, active local, and archived local Company choices', async () => {
    const user = userEvent.setup()
    const create = vi.fn().mockResolvedValue({
      status: 'blocked', failure: { kind: 'lifecycle_failure', blocker: { message: 'Try again.', code: 'invalid_input' } },
    })
    const { client, search } = makeClient({ complete: create })
    renderModal(client)

    await screen.findByLabelText('Job facts company')
    const jobCompany = screen.getByLabelText('Job facts company')
    const displayName = screen.getByLabelText('Local Company display name')
    await user.clear(jobCompany)
    await user.type(jobCompany, 'Example Labs')
    expect(displayName).toHaveValue('Example Labs')
    await user.clear(displayName)
    await user.type(displayName, 'Edited Example')
    await user.clear(jobCompany)
    await user.type(jobCompany, 'Different job facts Company')
    expect(displayName).toHaveValue('Edited Example')
    await user.click(screen.getByRole('button', { name: 'Create Job' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0].companyResolution).toEqual({ action: 'create_local', displayName: 'Edited Example' })

    create.mockResolvedValueOnce({
      status: 'blocked', failure: { kind: 'lifecycle_failure', blocker: { message: 'Try again.', code: 'invalid_input' } },
    })
    await user.click(screen.getByLabelText('Use an existing local Company'))
    await user.type(screen.getByLabelText('Search active local Companies'), 'Example')
    await waitFor(() => expect(search).toHaveBeenCalledWith({ query: 'Example', scope: 'active', limit: 8 }))
    await user.click(screen.getAllByRole('button', { name: 'Use' })[0]!)
    await user.click(screen.getByRole('button', { name: 'Create Job' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create.mock.calls[1]?.[0].companyResolution).toEqual({
      action: 'use_local', companyId: 'company-active', expectedCompanyRevision: 3, restoreIfArchived: false,
    })
    expect(create.mock.calls[1]?.[0].idempotencyKey).not.toBe(create.mock.calls[0]?.[0].idempotencyKey)

    create.mockResolvedValueOnce({
      status: 'blocked', failure: { kind: 'lifecycle_failure', blocker: { message: 'Try again.', code: 'invalid_input' } },
    })
    await user.click(screen.getByLabelText('Include archived Companies for explicit recovery'))
    await waitFor(() => expect(search).toHaveBeenLastCalledWith({ query: 'Example', scope: 'active_and_archived', limit: 8 }))
    await user.click(screen.getAllByRole('button', { name: 'Use' })[1]!)
    await user.click(screen.getByRole('button', { name: 'Create Job' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3))
    expect(create.mock.calls[2]?.[0].companyResolution).toEqual({
      action: 'use_local', companyId: 'company-archived', expectedCompanyRevision: 5, restoreIfArchived: true,
    })
  })

  it('rejects unsafe destination URLs without silently rewriting them', async () => {
    const user = userEvent.setup()
    const { client, complete } = makeClient()
    renderModal(client)

    const destination = await screen.findByLabelText('Employer or ATS URL')
    await user.clear(destination)
    await user.type(destination, 'https://jobs.example.com/role?utm_source=board')
    await user.click(screen.getByRole('button', { name: 'Create Job' }))

    expect(complete).not.toHaveBeenCalled()
    expect(screen.getByText(/without credentials, query parameters, or a fragment/)).toBeInTheDocument()
    expect(destination).toHaveValue('https://jobs.example.com/role?utm_source=board')
  })

  it('offers only allowed duplicate decisions and uses a fresh key for the exact target revision', async () => {
    const user = userEvent.setup()
    const complete = vi.fn()
      .mockResolvedValueOnce({
        status: 'duplicate_blocked', blockerCode: 'deterministic_duplicate', allowedDecisions: ['attach'],
        conflictingJobs: [{ jobId: 'job-existing', jobFactsRevision: 8, companyId: 'company-existing', companyRevision: 4, assignmentRevision: 6 }],
      })
      .mockResolvedValueOnce({ status: 'created', jobId: 'job-existing', companyId: 'company-existing', createdJob: false, existingJobComparison: 'equivalent' })
    const { client } = makeClient({ complete })
    renderModal(client)

    await user.click(await screen.findByRole('button', { name: 'Create Job' }))
    expect(await screen.findByRole('alert', { name: 'Duplicate Job recovery' })).toHaveTextContent('Job facts rev 8')
    expect(screen.getByRole('button', { name: 'Attach to this Job' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Merge with this Job' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Attach to this Job' }))

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2))
    expect(complete.mock.calls[1]?.[0]).toMatchObject({
      duplicateResolution: {
        action: 'attach', targetJobId: 'job-existing', expectedJobFactsRevision: 8, expectedAssignmentRevision: 6,
      },
    })
    expect(complete.mock.calls[1]?.[0].idempotencyKey).not.toBe(complete.mock.calls[0]?.[0].idempotencyKey)
  })

  it('hydrates a persisted duplicate intent before offering a resubmission', async () => {
    const user = userEvent.setup()
    const complete = vi.fn().mockResolvedValue({
      status: 'created', jobId: 'job-existing', companyId: 'company-existing', createdJob: false,
      existingJobComparison: 'equivalent',
    })
    const jobsGet = vi.fn(async (jobId: string) => recoveryJob(jobId, 14))
    const assignmentGet = vi.fn(async (jobId: string) => recoveryAssignment(
      jobId,
      'company-existing',
      12,
      16,
    ))
    const lookup = vi.fn(async () => ({
      requested: { id: 'company-existing', revision: 12, displayName: 'Existing Company', status: 'active' },
    }))
    const { client } = makeClient({ complete, jobsGet, assignmentGet, lookup })
    renderModal(client, {
      intent: {
        kind: 'resolve_duplicate_job',
        conflictingJobIds: ['job-existing'],
        supportedActions: ['attach'],
      },
    })

    expect(await screen.findByRole('alert', { name: 'Duplicate Job recovery' })).toHaveTextContent(
      'Job facts rev 14',
    )
    expect(complete).not.toHaveBeenCalled()
    expect(jobsGet).toHaveBeenCalledWith('job-existing')
    expect(assignmentGet).toHaveBeenCalledWith('job-existing')
    await user.click(screen.getByRole('button', { name: 'Attach to this Job' }))

    await waitFor(() => expect(complete).toHaveBeenCalledOnce())
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      duplicateResolution: {
        action: 'attach',
        targetJobId: 'job-existing',
        expectedJobFactsRevision: 14,
        expectedAssignmentRevision: 16,
      },
    }))
  })

  it('recovers an assignment conflict by looking up and selecting the current Company', async () => {
    const user = userEvent.setup()
    const complete = vi.fn()
      .mockResolvedValueOnce({
        status: 'company_assignment_blocked', blockerCode: 'invalid_input', existingJobId: 'job-existing',
        currentCompanyId: 'company-current', currentCompanyRevision: 7, assignmentRevision: 9,
        allowedRecovery: ['use_existing_company'],
      })
      .mockResolvedValueOnce({ status: 'created', jobId: 'job-existing', companyId: 'company-current', createdJob: false, existingJobComparison: 'different' })
    const lookup = vi.fn().mockResolvedValue({
      requested: { id: 'company-current', revision: 7, displayName: 'Current Company', status: 'active' },
    })
    const { client } = makeClient({ complete, lookup })
    renderModal(client)

    await user.click(await screen.findByRole('button', { name: 'Create Job' }))
    expect(await screen.findByRole('alert', { name: 'Company assignment recovery' })).toHaveTextContent('Assignment rev 9')
    await user.click(screen.getByRole('button', { name: 'Use this existing Company' }))

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2))
    expect(lookup).toHaveBeenCalledWith('company-current')
    expect(complete.mock.calls[1]?.[0].companyResolution).toEqual({
      action: 'use_local', companyId: 'company-current', expectedCompanyRevision: 7, restoreIfArchived: false,
    })
    expect(complete.mock.calls[1]?.[0].idempotencyKey).not.toBe(complete.mock.calls[0]?.[0].idempotencyKey)
  })

  it('hydrates a persisted assignment intent before selecting its current Company', async () => {
    const user = userEvent.setup()
    const complete = vi.fn().mockResolvedValue({
      status: 'created', jobId: 'job-existing', companyId: 'company-current', createdJob: false,
      existingJobComparison: 'different',
    })
    const jobsGet = vi.fn(async (jobId: string) => recoveryJob(jobId, 10))
    const assignmentGet = vi.fn(async (jobId: string) => recoveryAssignment(jobId, 'company-current', 11, 17))
    const lookup = vi.fn(async () => ({
      requested: { id: 'company-current', revision: 11, displayName: 'Current Company', status: 'active' },
    }))
    const { client } = makeClient({ complete, jobsGet, assignmentGet, lookup })
    renderModal(client, {
      intent: {
        kind: 'resolve_company_assignment',
        jobId: 'job-existing',
        currentCompanyId: 'company-current',
      },
    })

    expect(await screen.findByRole('alert', { name: 'Company assignment recovery' })).toHaveTextContent(
      'Assignment rev 17',
    )
    expect(complete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Use this existing Company' }))

    await waitFor(() => expect(complete).toHaveBeenCalledOnce())
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      companyResolution: {
        action: 'use_local', companyId: 'company-current', expectedCompanyRevision: 11, restoreIfArchived: false,
      },
    }))
  })

  it('stacks reassignment over a retained draft, refreshes guards, and resubmits with a fresh key', async () => {
    const user = userEvent.setup()
    const complete = vi.fn()
      .mockResolvedValueOnce({
        status: 'company_assignment_blocked', blockerCode: 'invalid_input', existingJobId: 'job-existing',
        currentCompanyId: 'company-current', currentCompanyRevision: 7, assignmentRevision: 9,
        allowedRecovery: ['reassign_company'],
      })
      .mockResolvedValueOnce({
        status: 'created', jobId: 'job-existing', companyId: 'company-destination', createdJob: false,
        existingJobComparison: 'different',
      })
    const before = recoveryAssignment('job-existing', 'company-current', 7, 9)
    const after = recoveryAssignment('job-existing', 'company-destination', 8, 10)
    const assignmentGet = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after)
    const lookup = vi.fn(async (companyId: string) => ({
      requested: {
        id: companyId,
        revision: companyId === 'company-destination' ? 8 : 7,
        displayName: companyId === 'company-destination' ? 'Destination Company' : 'Current Company',
        status: 'active',
      },
    }))
    const search = vi.fn().mockResolvedValue({
      items: [{ ...activeCompany, companyId: 'company-destination', revision: 8, displayName: 'Destination Company' }],
      truncated: false,
    })
    const reassign = vi.fn().mockResolvedValue({ status: 'reassigned' })
    const onAssignmentChanged = vi.fn()
    const { client } = makeClient({ complete, assignmentGet, lookup, search, reassign })
    renderModal(client, { workspaceId: 'workspace-1', onAssignmentChanged })

    const role = await screen.findByLabelText('Role title')
    await user.clear(role)
    await user.type(role, 'Principal Engineer')
    await user.click(screen.getByRole('button', { name: 'Create Job' }))
    await screen.findByRole('alert', { name: 'Company assignment recovery' })
    await user.click(screen.getByRole('button', { name: 'Reassign Job Company' }))

    const reassignment = await screen.findByRole('dialog', { name: 'Reassign Job Company' })
    expect(screen.getByRole('dialog', { name: 'Complete Capture into a Job' })).toBeInTheDocument()
    expect(screen.getByLabelText('Role title')).toHaveValue('Principal Engineer')
    await user.type(within(reassignment).getByLabelText('Find Company'), 'Destination')
    await waitFor(() => expect(within(reassignment).getByRole('option', {
      name: 'Destination Company',
    })).toBeInTheDocument())
    await user.selectOptions(
      within(reassignment).getByLabelText('Destination Company'),
      'company-destination',
    )
    await user.type(within(reassignment).getByLabelText('Rationale'), 'Correct assignment')
    await user.click(within(reassignment).getByRole('button', { name: 'Reassign Company' }))

    await waitFor(() => expect(assignmentGet).toHaveBeenCalledTimes(2))
    expect(onAssignmentChanged).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog', {
      name: 'Reassign Job Company',
    })).not.toBeInTheDocument())
    expect(screen.getByLabelText('Role title')).toHaveValue('Principal Engineer')
    expect(screen.getByRole('status')).toHaveTextContent('Job Company guards refreshed')
    await user.click(screen.getByRole('button', { name: 'Create Job' }))

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2))
    expect(complete.mock.calls[1]?.[0]).toMatchObject({
      companyResolution: {
        action: 'use_local', companyId: 'company-destination', expectedCompanyRevision: 8, restoreIfArchived: false,
      },
      jobFacts: { roleTitle: 'Principal Engineer' },
    })
    expect(complete.mock.calls[1]?.[0].idempotencyKey).not.toBe(complete.mock.calls[0]?.[0].idempotencyKey)
  })

  it('keeps the draft on stale guards until the user refreshes and resubmits', async () => {
    const user = userEvent.setup()
    const refreshedDetail = { ...detail, captureRevision: 2, expectedGenerationId: 'gen-2' }
    const get = vi.fn().mockResolvedValueOnce(detail).mockResolvedValueOnce(refreshedDetail)
    const complete = vi.fn()
      .mockResolvedValueOnce({
        status: 'blocked',
        failure: {
          kind: 'stale_guard', blocker: { code: 'impossible_state', message: 'Capture changed.' },
          recovery: { action: 'refresh_and_resubmit', guards: [{ kind: 'capture_revision', expectedRevision: 1, currentRevision: 2 }] },
        },
      })
      .mockResolvedValueOnce({ status: 'created', jobId: 'job-2', companyId: 'company-2', createdJob: true, existingJobComparison: 'not_compared' })
    const { client } = makeClient({ complete, get })
    renderModal(client)

    const role = await screen.findByLabelText('Role title')
    await user.clear(role)
    await user.type(role, 'Principal Engineer')
    await user.click(screen.getByRole('button', { name: 'Create Job' }))
    expect(await screen.findByRole('alert', { name: 'Stale completion guards' })).toHaveTextContent('Capture revision changed from 1 to 2.')
    await user.click(screen.getByRole('button', { name: 'Refresh guards and data' }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Role title')).toHaveValue('Principal Engineer')
    expect(complete).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Create Job' }))
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2))
    expect(complete.mock.calls[1]?.[0]).toMatchObject({ expectedCaptureRevision: 2, expectedGenerationId: 'gen-2' })
    expect(complete.mock.calls[1]?.[0].idempotencyKey).not.toBe(complete.mock.calls[0]?.[0].idempotencyKey)
  })

  it('uses the same in-app confirmation for every dirty dismissal affordance', async () => {
    for (const exit of captureDismissalActions) {
      cleanup()
      const user = userEvent.setup()
      const { client } = makeClient()
      const { onClose } = renderModal(client)

      await user.type(await screen.findByLabelText('Role title'), ' updated')
      expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument()
      await exit(user, 'Discard changes')

      const confirmation = await screen.findByRole('alertdialog', {
        name: 'Discard unsaved changes?',
      })
      expect(within(confirmation).getByRole('button', { name: 'Keep editing' })).toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
      await user.click(within(confirmation).getByRole('button', { name: 'Keep editing' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(onClose).not.toHaveBeenCalled()
    }
  })

  it('discards a confirmed dirty completion draft without using window confirmation', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm')
    const { client } = makeClient()
    const { onClose } = renderModal(client)

    await user.type(await screen.findByLabelText('Role title'), ' updated')
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Discard unsaved changes?',
    })
    await user.click(within(confirmation).getByRole('button', { name: 'Discard changes' }))

    expect(confirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('returns to Cancel after a direct display-name edit is visibly reverted', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    const { onClose } = renderModal(client)

    const displayName = await screen.findByLabelText('Local Company display name')
    await user.clear(displayName)
    await user.type(displayName, 'Example Updated')
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument()
    await user.clear(displayName)
    await user.type(displayName, 'Example')

    await closeCleanCompletionDraft(user, onClose)
  })

  it('treats whitespace-equivalent completion text as clean after payload normalization', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    const { onClose } = renderModal(client)

    const companyName = await screen.findByLabelText('Job facts company')
    await user.clear(companyName)
    await user.type(companyName, ' Example ')
    const roleTitle = screen.getByLabelText('Role title')
    await user.clear(roleTitle)
    await user.type(roleTitle, ' Engineer ')

    expect(screen.getByLabelText('Local Company display name')).toHaveValue(' Example ')
    await closeCleanCompletionDraft(user, onClose)
  })

  it('treats Company search query and include-archived as transient UI state', async () => {
    const user = userEvent.setup()
    const { client, search } = makeClient()
    const { onClose } = renderModal(client)

    await screen.findByLabelText('Job facts company')
    await searchExistingCompanies(user, search)
    await user.click(screen.getByLabelText('Include archived Companies for explicit recovery'))
    await waitFor(() => expect(search).toHaveBeenLastCalledWith({
      query: 'Example',
      scope: 'active_and_archived',
      limit: 8,
    }))
    await user.click(screen.getByLabelText('Create a local Company inside this Job completion'))

    await closeCleanCompletionDraft(user, onClose)
  })

  it('treats an explicit local Company selection as persisted completion state', async () => {
    const user = userEvent.setup()
    const { client, search } = makeClient()
    renderModal(client)

    await screen.findByLabelText('Job facts company')
    await searchExistingCompanies(user, search)
    const matches = await screen.findByRole('list', { name: 'Company search results' })
    await user.click(within(matches).getAllByRole('button', { name: 'Use' })[0]!)

    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument()
  })

  it('blocks every dismissal path while completion is pending', async () => {
    const user = userEvent.setup()
    const onRemoveCapture = vi.fn()
    let resolveCompletion: ((result: unknown) => void) | undefined
    const complete = vi.fn(() => new Promise((resolve) => {
      resolveCompletion = resolve
    }))
    const { client } = makeClient({ complete })
    const { onClose } = renderModal(client, { onRemoveCapture })

    await user.click(await screen.findByRole('button', { name: 'Create Job' }))
    expect(await screen.findByRole('button', { name: 'Completing…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Capture' })).toBeDisabled()
    expect(captureDialog().querySelector('[data-slot="dialog-close"]')).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    await user.click(dialogOverlay())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onRemoveCapture).not.toHaveBeenCalled()

    resolveCompletion?.({
      status: 'blocked',
      failure: { kind: 'lifecycle_failure', blocker: { code: 'invalid_input', message: 'Try again.' } },
    })
    expect(await screen.findByText('Try again.')).toBeInTheDocument()
  })

  it('blocks completion interaction while the shared Capture removal flow is pending', async () => {
    const { client } = makeClient()
    const onRemoveCapture = vi.fn()
    renderModal(client, { onRemoveCapture, removalPending: true })

    expect((await screen.findByLabelText('Job facts company'))).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Capture' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create Job' })).toBeDisabled()
    expect(captureDialog().querySelector('[data-slot="dialog-close"]')).not.toBeInTheDocument()
  })

  it('waits for parent refresh before closing and exposes the View Job toast action', async () => {
    const user = userEvent.setup()
    let finishRefresh: (() => void) | undefined
    const onCreated = vi.fn(() => new Promise<void>((resolve) => { finishRefresh = resolve }))
    const { client } = makeClient()
    const { onClose, onViewJob } = renderModal(client, { onCreated })

    await user.click(await screen.findByRole('button', { name: 'Create Job' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('job-1'))
    expect(onClose).not.toHaveBeenCalled()
    finishRefresh?.()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Job created', variant: 'success' }))
    const toastInput = toast.mock.calls[0]?.[0] as { action: { onClick: () => void } }
    toastInput.action.onClick()
    expect(onViewJob).toHaveBeenCalledWith('job-1')
  })
})
