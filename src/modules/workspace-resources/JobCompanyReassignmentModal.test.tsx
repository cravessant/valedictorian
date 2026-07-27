// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  JobCompanyAssignmentPresentation,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'

import { JobCompanyReassignmentModal } from './JobCompanyReassignmentModal'

afterEach(cleanup)

const currentAssignment = {
  jobId: '01900000-0000-7000-8000-000000000001',
  assignmentRevision: 4,
  workspaceCompany: {
    companyId: '01900000-0000-7000-8000-000000000002',
    revision: 3,
    displayName: 'Current Company',
    status: 'active',
  },
  jobFactsCompanyName: 'Posting Company',
  roleTitle: 'Engineer',
  namesDiffer: true,
} as JobCompanyAssignmentPresentation

const destination = {
  companyId: '01900000-0000-7000-8000-000000000003',
  revision: 7,
  displayName: 'Destination Company',
  websiteUrl: null,
  status: 'active' as const,
  assignedJobCount: 2,
}

function makeClient(result: unknown) {
  const search = vi.fn(async () => ({ items: [destination], truncated: false }))
  const reassign = vi.fn(async () => result)
  return {
    client: {
      companies: { search },
      companyAssignments: { reassign },
    } as unknown as Pick<
      ValedictorianWorkspaceClient,
      'companies' | 'companyAssignments'
    >,
    reassign,
    search,
  }
}

async function completeForm(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.getByRole('dialog', { name: 'Reassign Job Company' })
  await user.type(
    within(dialog).getByRole('combobox', { name: 'Destination Company' }),
    'Destination',
  )
  await waitFor(() => {
    expect(within(dialog).getByRole('option', {
      name: 'Destination Company',
    })).toBeInTheDocument()
  })
  await user.click(within(dialog).getByRole('option', { name: 'Destination Company' }))
  await user.type(within(dialog).getByLabelText('Rationale'), 'Correct assignment')
  await user.click(within(dialog).getByRole('button', { name: 'Reassign Company' }))
}

describe('JobCompanyReassignmentModal', () => {
  it('submits the current assignment and selected destination revisions', async () => {
    const user = userEvent.setup()
    const result = {
      status: 'reassigned',
      workspaceId: 'workspace-1',
      jobId: currentAssignment.jobId,
      requestAssignmentRevision: 4,
      requestDestinationCompanyRevision: 7,
      idempotencyKey: 'receipt',
      assignment: currentAssignment,
      jobFactsChanged: false,
    }
    const { client, reassign, search } = makeClient(result)
    const onChanged = vi.fn()
    const onClose = vi.fn()
    render(
      <JobCompanyReassignmentModal
        assignment={currentAssignment}
        client={client}
        workspaceId="workspace-1"
        onChanged={onChanged}
        onClose={onClose}
      />,
    )

    await completeForm(user)

    expect(search).toHaveBeenCalledWith({
      query: 'Destination',
      scope: 'active',
      limit: 20,
    })
    expect(reassign).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actor: {
        id: 'valedictorian-desktop-user',
        type: 'user',
        displayName: 'Desktop user',
      },
      rationale: 'Correct assignment',
      idempotencyKey: expect.any(String),
      jobId: currentAssignment.jobId,
      expectedAssignmentRevision: 4,
      destinationCompanyId: destination.companyId,
      expectedDestinationCompanyRevision: 7,
    })
    expect(onChanged).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps stale recovery blocked in the modal without changing the destination', async () => {
    const user = userEvent.setup()
    const { client, reassign } = makeClient({
      status: 'blocked',
      workspaceId: 'workspace-1',
      idempotencyKey: 'receipt',
      jobId: currentAssignment.jobId,
      requestAssignmentRevision: 4,
      destinationCompanyId: destination.companyId,
      requestDestinationCompanyRevision: 7,
      failure: {
        kind: 'stale_guard',
        blocker: {
          code: 'impossible_state',
          message: 'The Company assignment changed. Refresh and choose again.',
        },
        recovery: {
          action: 'refresh_and_resubmit',
          guards: [],
        },
      },
    })
    const onChanged = vi.fn()
    const onClose = vi.fn()
    render(
      <JobCompanyReassignmentModal
        assignment={currentAssignment}
        client={client}
        workspaceId="workspace-1"
        onChanged={onChanged}
        onClose={onClose}
      />,
    )

    await completeForm(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Company assignment changed. Refresh and choose again.',
    )
    expect(screen.getByRole('dialog', {
      name: 'Reassign Job Company',
    })).toBeInTheDocument()
    expect(reassign).toHaveBeenCalledWith(expect.objectContaining({
      destinationCompanyId: destination.companyId,
    }))
    expect(onChanged).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
