import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CompanyDetail,
  CompanyDirectoryPage,
  WorkspaceCompaniesClient,
} from 'sparxie'
import { CompaniesWorkspace } from './CompaniesWorkspace'

afterEach(cleanup)

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

function makeClient() {
  const list = vi.fn(async () => page)
  const get = vi.fn(async (_companyId: string) => detail)
  const capability = vi.fn(async () => ({ status: 'ready' as const }))
  return {
    client: {
      capability: { get: capability },
      directory: { list },
      get,
    } as unknown as WorkspaceCompaniesClient,
    capability,
    get,
    list,
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
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
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
})
