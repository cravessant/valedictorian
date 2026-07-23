import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompanyAssignedJobPage, CompanyDetail } from '@sparxie/sdk'
import { CompanyDetailView } from './CompanyDetailView'

afterEach(cleanup)

describe('CompanyDetailView', () => {
  it('keeps merged identity read-only, notes editable, and canonical navigation explicit', async () => {
    const user = userEvent.setup()
    const openCompany = vi.fn()
    const editNotes = vi.fn()
    render(
      <CompanyDetailView
        detail={{
          lookup: {
            requested: {
              id: 'merged-company',
              workspaceId: 'workspace',
              displayName: 'Merged Company',
              aliases: [{ id: 'alias-1', value: 'Old name' }],
              websiteUrl: null,
              notes: 'Preserved notes',
              revision: 4,
              status: 'merged',
              mergedIntoCompanyId: 'canonical-company',
              createdAt: '2026-07-23T00:00:00.000Z',
              updatedAt: '2026-07-23T00:01:00.000Z',
            },
            canonical: {
              id: 'canonical-company',
              workspaceId: 'workspace',
              displayName: 'Canonical Company',
              aliases: [],
              websiteUrl: null,
              notes: null,
              revision: 2,
              status: 'active',
              mergedIntoCompanyId: null,
              createdAt: '2026-07-23T00:00:00.000Z',
              updatedAt: '2026-07-23T00:01:00.000Z',
            },
            redirectPath: ['canonical-company'],
          },
          assignedJobCount: 0,
          openDuplicateCandidateCount: 0,
          history: { lastEventAt: null, eventCount: 0, recentEvents: [] },
        } as unknown as CompanyDetail}
        assignedJobs={emptyAssignedJobs()}
        onAddAlias={vi.fn()}
        onArchive={vi.fn()}
        onEditAlias={vi.fn()}
        onEditIdentity={vi.fn()}
        onEditNotes={editNotes}
        onOpenCompany={openCompany}
        onOpenJob={vi.fn()}
        onRemoveAlias={vi.fn()}
        onRestore={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Edit identity' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add alias' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit notes' }))
    expect(editNotes).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Canonical Company' }))
    expect(openCompany).toHaveBeenCalledWith('canonical-company')
  })

  it('links assigned Jobs without turning asserted names into Company identity', async () => {
    const user = userEvent.setup()
    const openJob = vi.fn()
    render(
      <CompanyDetailView
        detail={{
          lookup: {
            requested: {
              id: 'company',
              displayName: 'Workspace Company',
              status: 'active',
              aliases: [],
              websiteUrl: null,
              notes: null,
            },
            canonical: { id: 'company', displayName: 'Workspace Company' },
          },
          assignedJobCount: 1,
        } as unknown as CompanyDetail}
        assignedJobs={{
          ...emptyAssignedJobs(),
          items: [{
            jobId: '018f0000-0000-7000-8000-000000000001',
            assignmentRevision: 1,
            workspaceCompany: {
              companyId: 'company',
              revision: 1,
              displayName: 'Workspace Company',
              status: 'active',
            },
            jobFactsCompanyName: 'Posting Company',
            roleTitle: 'Platform Engineer',
            namesDiffer: true,
          }],
          totalCount: 1,
        } as unknown as CompanyAssignedJobPage}
        onAddAlias={vi.fn()}
        onArchive={vi.fn()}
        onEditAlias={vi.fn()}
        onEditIdentity={vi.fn()}
        onEditNotes={vi.fn()}
        onOpenCompany={vi.fn()}
        onOpenJob={openJob}
        onRemoveAlias={vi.fn()}
        onRestore={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Platform Engineer' }))
    expect(openJob).toHaveBeenCalledWith('018f0000-0000-7000-8000-000000000001')
    expect(screen.getByText('Posting: Posting Company')).toBeInTheDocument()
  })
})

function emptyAssignedJobs(): CompanyAssignedJobPage {
  return {
    items: [],
    pageInfo: {
      startCursor: null,
      endCursor: null,
      hasPreviousPage: false,
      hasNextPage: false,
    },
    totalCount: 0,
  }
}
