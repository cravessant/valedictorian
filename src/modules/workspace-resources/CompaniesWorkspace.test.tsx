import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CompanyDetail,
  CompanyDirectoryPage,
  CompanyDuplicateCandidateRow,
  CompanyDuplicatePage,
  WorkspaceCompaniesClient,
} from '@sparxie/sdk'
import { CompaniesWorkspace } from './CompaniesWorkspace'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const page = {
  items: [{
    companyId: 'company-on-page',
    displayName: 'On Page Inc.',
    websiteHost: 'on-page.test',
    assignedJobCount: 3,
    status: 'active',
    openDuplicateCandidateCount: 1,
  }],
  pageInfo: {
    startCursor: 'raw-start/+==:%2F',
    endCursor: 'raw-end/+==:%2F',
    hasPreviousPage: true,
    hasNextPage: true,
  },
  totalCount: 61,
} as unknown as CompanyDirectoryPage

const detail = {
  lookup: {
    requested: {
      id: 'company-not-on-page',
      displayName: 'Direct Company',
      websiteUrl: null,
      status: 'active',
      aliases: [],
      notes: null,
    },
    canonical: {
      id: 'company-not-on-page',
      displayName: 'Direct Company',
    },
  },
  assignedJobCount: 4,
} as unknown as CompanyDetail

const candidate = {
  candidateId: 'candidate-one',
  candidateRevision: 4,
  left: {
    companyId: 'company-left',
    revision: 7,
    displayName: 'Northstar Robotics',
    websiteUrl: 'https://northstar.example',
    status: 'active',
    assignedJobCount: 3,
  },
  right: {
    companyId: 'company-right',
    revision: 5,
    displayName: 'Northstar Robotix',
    websiteUrl: null,
    status: 'active',
    assignedJobCount: 2,
  },
  score: 0.91,
  reasons: [
    { code: 'normalized_name_similarity', label: 'Company names are similar.' },
  ],
  status: 'open',
  updatedAt: '2026-07-23T18:00:00.000Z',
} as unknown as CompanyDuplicateCandidateRow

const duplicatePage = {
  items: [candidate],
  pageInfo: {
    startCursor: 'duplicate-start',
    endCursor: 'duplicate-end',
    hasPreviousPage: false,
    hasNextPage: true,
  },
  totalCount: 1,
} as unknown as CompanyDuplicatePage

function makeClient() {
  const list = vi.fn(async () => page)
  const get = vi.fn(async (_companyId: string) => detail)
  const duplicateList = vi.fn(async () => duplicatePage)
  const duplicateGet = vi.fn(async (_candidateId: string) => candidate)
  const markDistinct = vi.fn(async () => ({
    status: 'marked_distinct',
  }) as never)
  const capability = vi.fn(async () => ({ status: 'ready' as const }))
  return {
    client: {
      capability: { get: capability },
      directory: { list },
      duplicates: {
        list: duplicateList,
        get: duplicateGet,
        markDistinct,
      },
      get,
      assignedJobs: {
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
    } as unknown as WorkspaceCompaniesClient,
    capability,
    duplicateGet,
    duplicateList,
    get,
    list,
    markDistinct,
  }
}

describe('CompaniesWorkspace', () => {
  it('keeps Company data and writes unavailable while migration is incomplete', async () => {
    const { client, capability, get, list } = makeClient()
    capability.mockResolvedValueOnce({
      status: 'migrating',
      completed: 4,
      total: 9,
      issueCount: 0,
    })
    render(
      <CompaniesWorkspace
        client={client}
        entry={{
          location: { view: 'companies', resourceId: 'company-not-on-page' },
          cursorChain: [],
        }}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )

    expect(await screen.findByText('Preparing Workspace Companies')).toBeInTheDocument()
    expect(screen.getByText(/4 of 9 Jobs/)).toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('renders bounded blocked capability information without repair controls', async () => {
    const { client, capability, get, list } = makeClient()
    capability.mockResolvedValueOnce({
      status: 'blocked',
      issueCount: 2,
      reason: 'integrity_check_failed',
      message: 'Workspace Company coverage verification failed.',
      remediation: null,
    })
    render(
      <CompaniesWorkspace
        client={client}
        entry={{ location: { view: 'companies' }, cursorChain: [] }}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace Company coverage verification failed.',
    )
    expect(screen.getByRole('button', { name: 'New Company' })).toBeDisabled()
    expect(list).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('refreshes a migrating capability until the mounted workspace becomes ready', async () => {
    vi.useFakeTimers()
    const { client, capability, list } = makeClient()
    capability
      .mockResolvedValueOnce({
        status: 'migrating',
        completed: 4,
        total: 9,
        issueCount: 0,
      })
      .mockResolvedValueOnce({ status: 'ready' })
    render(
      <CompaniesWorkspace
        client={client}
        workspaceId="workspace-company"
        entry={{ location: { view: 'companies' }, cursorChain: [] }}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )

    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Preparing Workspace Companies')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(capability).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByText('On Page Inc.')).toBeInTheDocument()
  })

  it('returns focus to New Company when its modal unmounts on cancel', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    render(
      <CompaniesWorkspace
        client={client}
        workspaceId="workspace-company"
        entry={{ location: { view: 'companies' }, cursorChain: [] }}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )
    const trigger = await screen.findByRole('button', { name: 'New Company' })
    trigger.focus()
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('loads a directly addressed Company independent of the current page', async () => {
    const { client, get } = makeClient()
    render(
      <CompaniesWorkspace
        client={client}
        entry={{
          location: { view: 'companies', resourceId: 'company-not-on-page' },
          cursorChain: [],
        }}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Direct Company' })).toHaveFocus()
    expect(get).toHaveBeenCalledWith('company-not-on-page')
    expect(screen.getByText('On Page Inc.')).toBeInTheDocument()
  })

  it('renders direct detail when its independent directory page fails', async () => {
    const { client, list } = makeClient()
    list.mockRejectedValueOnce(new Error('directory unavailable'))
    render(
      <CompaniesWorkspace
        client={client}
        entry={{
          location: { view: 'companies', resourceId: 'company-not-on-page' },
          cursorChain: [],
        }}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Direct Company' })).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('directory unavailable')
  })

  it('never leaves Company A content under a failing Company B address', async () => {
    const { client, get } = makeClient()
    get.mockImplementation(async (companyId) => {
      if (companyId === 'company-b') throw new Error('Company B unavailable')
      return detail
    })
    const { rerender } = render(
      <CompaniesWorkspace
        client={client}
        entry={{
          location: { view: 'companies', resourceId: 'company-a' },
          cursorChain: [],
        }}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )
    await screen.findByRole('heading', { name: 'Direct Company' })

    rerender(
      <CompaniesWorkspace
        client={client}
        entry={{
          location: { view: 'companies', resourceId: 'company-b' },
          cursorChain: [],
        }}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )
    expect(screen.queryByText('Direct Company')).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Company B unavailable')
  })

  it('drives paging from PageInfo and preserves its raw cursor', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    const navigate = vi.fn()
    render(
      <CompaniesWorkspace
        client={client}
        entry={{ location: { view: 'companies', filter: 'all' }, cursorChain: [] }}
        onBack={vi.fn()}
        onNavigate={navigate}
      />,
    )
    await screen.findByText('On Page Inc.')

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(navigate).toHaveBeenLastCalledWith({
      view: 'companies',
      filter: 'all',
      cursor: page.pageInfo.endCursor,
      cursorDirection: 'after',
    }, {
      cursorChain: [{ view: 'companies', filter: 'all' }],
    })

    await user.click(screen.getByRole('button', { name: 'Go to previous page' }))
    expect(navigate).toHaveBeenLastCalledWith({
      view: 'companies',
      filter: 'all',
      cursor: page.pageInfo.startCursor,
      cursorDirection: 'before',
    }, { cursorChain: [] })
  })

  it('resets paging and selection when the filter changes', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    const navigate = vi.fn()
    render(
      <CompaniesWorkspace
        client={client}
        entry={{
          location: {
            view: 'companies',
            resourceId: 'company-not-on-page',
            filter: 'all',
            cursor: 'page-two',
            cursorDirection: 'after',
          },
          cursorChain: [{ view: 'companies' }],
        }}
        onBack={vi.fn()}
        onNavigate={navigate}
      />,
    )
    await screen.findByText('On Page Inc.')

    await user.selectOptions(screen.getByLabelText('Company status'), 'archived')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({
      view: 'companies',
      filter: 'archived',
      sort: 'display_name_asc',
    }))
  })

  it('uses a labeled Back action instead of the list on narrow screens', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    const user = userEvent.setup()
    const { client } = makeClient()
    const back = vi.fn()
    render(
      <CompaniesWorkspace
        client={client}
        entry={{
          location: { view: 'companies', resourceId: 'company-not-on-page' },
          cursorChain: [],
        }}
        onBack={back}
        onNavigate={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Back to Companies' }))
    expect(back).toHaveBeenCalledOnce()
    expect(screen.queryByRole('table', { name: 'Companies' })).not.toBeInTheDocument()
  })

  it('keeps possible duplicates in a separate paged workspace mode', async () => {
    const user = userEvent.setup()
    const { client, duplicateList, list } = makeClient()
    const navigate = vi.fn()
    render(
      <CompaniesWorkspace
        client={client}
        workspaceId="workspace-company"
        entry={{
          location: {
            view: 'companies',
            mode: 'duplicates',
            filter: 'open',
            sort: 'score_desc',
          },
          cursorChain: [],
        }}
        onBack={vi.fn()}
        onNavigate={navigate}
      />,
    )

    expect(await screen.findByRole('table', {
      name: 'Possible duplicate Companies',
    })).toBeInTheDocument()
    expect(screen.getByText('Northstar Robotics')).toBeInTheDocument()
    expect(screen.getByText('and Northstar Robotix')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New Company' })).not.toBeInTheDocument()
    expect(duplicateList).toHaveBeenCalledWith({
      filter: 'open',
      sort: 'score_desc',
      limit: 50,
    })
    expect(list).not.toHaveBeenCalled()

    await user.selectOptions(screen.getByLabelText('Duplicate review status'), 'all')
    expect(navigate).toHaveBeenLastCalledWith({
      view: 'companies',
      mode: 'duplicates',
      filter: 'all',
      sort: 'score_desc',
    })
    await user.click(screen.getByRole('button', { name: /Northstar Robotics/ }))
    expect(navigate).toHaveBeenLastCalledWith({
      view: 'companies',
      mode: 'duplicates',
      filter: 'open',
      sort: 'score_desc',
      resourceId: candidate.candidateId,
    }, {
      cursorChain: [],
      focusAnchor: `company-duplicate-link-${candidate.candidateId}`,
    })
    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(navigate).toHaveBeenLastCalledWith({
      view: 'companies',
      mode: 'duplicates',
      filter: 'open',
      sort: 'score_desc',
      cursor: duplicatePage.pageInfo.endCursor,
      cursorDirection: 'after',
    }, {
      cursorChain: [{
        view: 'companies',
        mode: 'duplicates',
        filter: 'open',
        sort: 'score_desc',
      }],
    })
  })

  it('submits exact candidate and Company revisions without offering merge', async () => {
    const user = userEvent.setup()
    const { client, duplicateGet, markDistinct } = makeClient()
    const back = vi.fn()
    render(
      <CompaniesWorkspace
        client={client}
        workspaceId="workspace-company"
        entry={{
          location: {
            view: 'companies',
            mode: 'duplicates',
            filter: 'open',
            sort: 'score_desc',
            resourceId: candidate.candidateId,
          },
          cursorChain: [],
        }}
        onBack={back}
        onNavigate={vi.fn()}
      />,
    )

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(duplicateGet).toHaveBeenCalledWith(candidate.candidateId)
    expect(screen.getAllByText('Northstar Robotics')).toHaveLength(2)
    expect(screen.getAllByText('Northstar Robotix')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /merge/i })).not.toBeInTheDocument()
    const rationale = screen.getByLabelText('Rationale')
    expect(rationale).toHaveFocus()
    await user.type(rationale, 'Separate legal entities.')
    await user.click(screen.getByRole('button', { name: 'Mark distinct' }))
    await waitFor(() => expect(markDistinct).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-company',
      candidateId: candidate.candidateId,
      expectedCandidateRevision: 4,
      leftCompanyId: candidate.left.companyId,
      expectedLeftCompanyRevision: 7,
      rightCompanyId: candidate.right.companyId,
      expectedRightCompanyRevision: 5,
      rationale: 'Separate legal entities.',
    })))
    expect(back).toHaveBeenCalledOnce()
  })

  it('keeps the review modal open when stale guards block the decision', async () => {
    const user = userEvent.setup()
    const { client, markDistinct } = makeClient()
    markDistinct.mockResolvedValueOnce({
      status: 'blocked',
      failure: {
        kind: 'stale_guard',
        blocker: {
          code: 'impossible_state',
          message: 'The candidate or a Company changed. Refresh and review the pair again.',
        },
        recovery: { action: 'refresh_and_resubmit', guards: [] },
      },
    } as never)
    const back = vi.fn()
    render(
      <CompaniesWorkspace
        client={client}
        workspaceId="workspace-company"
        entry={{
          location: {
            view: 'companies',
            mode: 'duplicates',
            resourceId: candidate.candidateId,
          },
          cursorChain: [],
        }}
        onBack={back}
        onNavigate={vi.fn()}
      />,
    )
    await user.type(await screen.findByLabelText('Rationale'), 'Separate entities.')
    await user.click(screen.getByRole('button', { name: 'Mark distinct' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The candidate or a Company changed. Refresh and review the pair again.',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(back).not.toHaveBeenCalled()
  })
})
