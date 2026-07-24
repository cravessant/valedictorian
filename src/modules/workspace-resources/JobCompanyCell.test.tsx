// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobCompanyAssignmentPresentation } from '@sparxie/sdk'

import { JobCompanyCell } from './JobCompanyCell'

afterEach(cleanup)

function assignment(
  overrides: Partial<JobCompanyAssignmentPresentation> = {},
): JobCompanyAssignmentPresentation {
  return {
    jobId: '01900000-0000-7000-8000-000000000001',
    assignmentRevision: 4,
    workspaceCompany: {
      companyId: '01900000-0000-7000-8000-000000000002',
      revision: 3,
      displayName: 'Canonical Company',
      status: 'active',
    },
    jobFactsCompanyName: 'Posting Company',
    roleTitle: 'Engineer',
    namesDiffer: true,
    ...overrides,
  } as JobCompanyAssignmentPresentation
}

describe('JobCompanyCell', () => {
  it('presents the assigned Company as the primary link and differing Job facts secondarily', async () => {
    const user = userEvent.setup()
    const onOpenCompany = vi.fn()
    render(<JobCompanyCell assignment={assignment()} onOpenCompany={onOpenCompany} />)

    await user.click(screen.getByRole('button', { name: 'Canonical Company' }))

    expect(onOpenCompany).toHaveBeenCalledWith(
      '01900000-0000-7000-8000-000000000002',
    )
    expect(screen.getByText('Posting says: Posting Company')).toBeInTheDocument()
  })

  it('does not repeat matching asserted Company facts', () => {
    render(<JobCompanyCell assignment={assignment({
      jobFactsCompanyName: 'Canonical Company',
      namesDiffer: false,
    })} />)

    expect(screen.getByText('Canonical Company')).toBeInTheDocument()
    expect(screen.queryByText(/Posting says:/)).not.toBeInTheDocument()
  })
})
