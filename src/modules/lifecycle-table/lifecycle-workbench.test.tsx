import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Capture, Job, ValedictorianWorkspaceClient } from '@sparxie/sdk'

import { LifecycleWorkbench } from './lifecycle-workbench'
import { openCapturesForRun } from '@/app/capture-navigation'
import { useWorkspaceLocation } from '@/app/use-workspace-location'

const originalMatchMedia = window.matchMedia
afterEach(() => {
  cleanup()
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
  window.matchMedia = originalMatchMedia
  window.history.replaceState(null, '', '/')
})

interface TestPage {
  items: unknown[]
  limit: number
  nextCursor: string | null
}

function emptyPage(): TestPage {
  return { items: [], limit: 50, nextCursor: null }
}

function makeClient() {
  const lists = {
    captures: vi.fn(async (_input?: unknown) => emptyPage()),
    jobs: vi.fn(async (_input?: unknown) => emptyPage()),
    opportunities: vi.fn(async (_input?: unknown) => emptyPage()),
    applications: vi.fn(async (_input?: unknown) => emptyPage()),
  }
  const client = {
    captures: { list: lists.captures },
    jobs: { list: lists.jobs },
    opportunities: { list: lists.opportunities },
    applications: { list: lists.applications },
  } as unknown as ValedictorianWorkspaceClient
  return { client, lists }
}

describe('LifecycleWorkbench', () => {
  it('loads every aggregate through the workspace client and switches the shared table wiring', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    render(<LifecycleWorkbench client={client} />)

    expect(await screen.findByText('No captures')).toBeInTheDocument()
    await waitFor(() => {
      expect(lists.captures).toHaveBeenCalledTimes(1)
      expect(lists.jobs).toHaveBeenCalledTimes(2)
      expect(lists.opportunities).toHaveBeenCalledTimes(1)
      expect(lists.applications).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: /Jobs/ }))
    expect(await screen.findByRole('table', { name: 'Jobs' })).toBeInTheDocument()
    expect(screen.getByText('No jobs')).toBeInTheDocument()
  })

  it('loads an addressed Job by ID even when it is absent from the list page', async () => {
    const addressedJobId = '01900000-0000-7000-8000-000000000001'
    const { client, lists } = makeClient()
    lists.jobs.mockRejectedValueOnce(new Error('Jobs page unavailable'))
    const get = vi.fn(async () => ({
      id: addressedJobId,
      facts: {
        roleTitle: 'Directly Addressed Role',
        companyName: 'Direct Company',
        sourceName: 'Test source',
      },
      availability: { state: 'active' },
    }))
    Object.assign(client.jobs, { get })

    render(
      <LifecycleWorkbench
        client={client}
        selectedPhase="jobs"
        selectedResourceId={addressedJobId}
      />,
    )

    expect(await screen.findByRole('heading', {
      name: 'Directly Addressed Role',
    })).toHaveFocus()
    expect(get).toHaveBeenCalledWith(addressedJobId)
    expect(screen.getByRole('alert')).toHaveTextContent('Jobs page unavailable')
  })

  it('keeps All and Processing as accessible modes on the same Capture surface', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    render(<LifecycleWorkbench client={client} />)

    const modes = await screen.findByRole('radiogroup', { name: 'Captures view mode' })
    await user.click(screen.getByRole('radio', { name: 'Processing' }))
    expect(screen.getByRole('heading', { name: 'Capture processing' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Capture processing' })
    expect(table).toHaveTextContent('Capture → Job')
    expect(table).toHaveTextContent('Job fact normalization')
    expect(table).toHaveTextContent('Opportunity admission')
    expect(table).toHaveTextContent('Opportunity projection')
    expect(screen.getByRole('radio', { name: 'Processing' })).toHaveAttribute('aria-checked', 'true')
    expect(modes).toBeInTheDocument()
  })

  it('uses the complete Jobs projection for Capture links and the lifecycle count', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    const capture = {
      id: 'capture-linked-off-page',
      adapter: { id: 'adapter-capture-one', kind: 'test' },
      evidence: [],
      observedAt: '2026-07-23T00:00:00Z',
      revision: 1,
      removedAt: null,
    } as unknown as Capture
    const visibleJobs = Array.from({ length: 50 }, (_, index) => ({
      id: `visible-job-${index}`,
      removedAt: null,
      captureEvidenceReferences: [],
    })) as unknown as Job[]
    const offPageJob = {
      id: 'off-page-linked-job',
      removedAt: null,
      captureEvidenceReferences: [{ captureId: capture.id }],
    } as unknown as Job
    lists.captures.mockResolvedValue({
      items: [capture],
      limit: 100,
      nextCursor: null,
    })
    lists.jobs.mockImplementation(async (input?: unknown) => {
      const query = input as { cursor?: string; limit?: number }
      if (query.limit === 50) {
        return { items: visibleJobs, limit: 50, nextCursor: 'visible-next' }
      }
      if (query.cursor === 'complete-next') {
        return { items: [offPageJob], limit: 100, nextCursor: null }
      }
      return { items: visibleJobs, limit: 100, nextCursor: 'complete-next' }
    })

    render(<LifecycleWorkbench client={client} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Jobs/ })).toHaveTextContent('51')
    })
    await user.click(screen.getByRole('radio', { name: 'Processing' }))
    const processing = await screen.findByRole('table', { name: 'Capture processing' })
    expect(processing).toHaveTextContent(`Linked to ${offPageJob.id}`)
    expect(processing).not.toHaveTextContent('No linked Job; processing status unavailable')
    expect(lists.jobs).toHaveBeenCalledWith({
      includeRemoved: false,
      limit: 50,
    })
    expect(lists.jobs).toHaveBeenCalledWith({
      cursor: 'complete-next',
      includeRemoved: false,
      limit: 100,
    })
  })

  it('opens Captures from a connector run and applies the run filter before listing', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await waitFor(() => expect(lists.captures).toHaveBeenCalledTimes(1))

    await act(async () => openCapturesForRun({
      connectorInstanceId: 'connector-one',
      connectorRunId: 'run/one',
    }))
    expect(await screen.findByText('Filtered to connector run run/one')).toBeInTheDocument()
    await waitFor(() => expect(lists.captures).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectorRunId: 'run/one' }),
    ))

    await user.click(screen.getByRole('button', { name: 'Clear run filter' }))
    await waitFor(() => expect(lists.captures).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ connectorRunId: expect.anything() }),
    ))
  })

  it('shows a terminal client-unavailable failure instead of loading forever', async () => {
    render(<LifecycleWorkbench client={null} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace HTTP client is unavailable.',
    )
  })

  it('recovers when the renderer backend becomes available after initial startup', async () => {
    let available = false
    let backendListener: ((state: { status: string }) => void) | undefined
    const request = vi.fn(async () => new Response(JSON.stringify(emptyPage()), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }))
    Object.defineProperty(window, 'valedictorianHttp', {
      configurable: true,
      value: {
        apiBaseUrl: 'http://127.0.0.1:4317',
        workspaceId: 'workspace-1',
        request,
        getBackendState: () => available
          ? { status: 'available', origin: 'http://127.0.0.1:4317' }
          : { status: 'starting' },
        onBackendStateChanged: (listener: (state: { status: string }) => void) => {
          backendListener = listener
          return vi.fn()
        },
      },
    })
    render(<LifecycleWorkbench />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace HTTP client is unavailable.',
    )
    available = true
    await act(async () => backendListener?.({ status: 'available' }))

    expect(await screen.findByText('No captures')).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(5)
  })

  it('retries a failed aggregate load from the rendered failure action', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    lists.captures.mockRejectedValueOnce(new Error('captures unavailable'))
    render(<LifecycleWorkbench client={client} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('captures unavailable')
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('No captures')).toBeInTheDocument()
    expect(lists.captures).toHaveBeenCalledTimes(2)
  })

  it('keeps the visible Jobs page bounded while draining its complete projection', async () => {
    const { client, lists } = makeClient()
    for (const [phase, list] of Object.entries(lists).filter(([phase]) => phase !== 'jobs')) {
      list
        .mockResolvedValueOnce({ items: [], limit: 100, nextCursor: `${phase}-page-2` })
        .mockResolvedValueOnce(emptyPage())
    }
    lists.jobs.mockImplementation(async (input?: unknown) => {
      const query = input as { cursor?: string; limit?: number }
      if (query.limit === 50) return emptyPage()
      return query.cursor === 'jobs-page-2'
        ? emptyPage()
        : { items: [], limit: 100, nextCursor: 'jobs-page-2' }
    })
    render(<LifecycleWorkbench client={client} />)

    await waitFor(() => {
      expect(lists.captures).toHaveBeenCalledTimes(2)
      expect(lists.opportunities).toHaveBeenCalledTimes(2)
      expect(lists.applications).toHaveBeenCalledTimes(2)
      expect(lists.jobs).toHaveBeenCalledTimes(3)
    })
    for (const [phase, list] of Object.entries(lists).filter(([phase]) => phase !== 'jobs')) {
      expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({
        cursor: `${phase}-page-2`,
        limit: 100,
      }))
    }
    expect(lists.jobs).toHaveBeenCalledWith({
      includeRemoved: false,
      limit: 50,
    })
    expect(lists.jobs).toHaveBeenCalledWith({
      cursor: 'jobs-page-2',
      includeRemoved: false,
      limit: 100,
    })
  })

  it('uses the exact legacy Jobs next cursor and exact prior list location', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    const nextCursor = 'opaque/+==:\u0000\n +'
    lists.jobs.mockResolvedValueOnce({
      items: [],
      limit: 50,
      nextCursor,
    })
    const navigate = vi.fn()
    const { rerender } = render(
      <LifecycleWorkbench
        client={client}
        selectedPhase="jobs"
        workspaceEntry={{
          location: { view: 'jobs', filter: 'include_removed' },
          cursorChain: [],
        }}
        onWorkspaceNavigate={navigate}
      />,
    )
    await waitFor(() => expect(lists.jobs).toHaveBeenCalledWith({
      includeRemoved: true,
      limit: 50,
    }))

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(navigate).toHaveBeenCalledWith({
      view: 'jobs',
      filter: 'include_removed',
      cursor: nextCursor,
      cursorDirection: 'after',
    }, {
      cursorChain: [{ view: 'jobs', filter: 'include_removed' }],
    })

    rerender(
      <LifecycleWorkbench
        client={client}
        selectedPhase="jobs"
        workspaceEntry={{
          location: {
            view: 'jobs',
            filter: 'include_removed',
            cursor: nextCursor,
            cursorDirection: 'after',
          },
          cursorChain: [{ view: 'jobs', filter: 'include_removed' }],
        }}
        onWorkspaceNavigate={navigate}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Go to previous page' }))
    expect(navigate).toHaveBeenLastCalledWith(
      { view: 'jobs', filter: 'include_removed' },
      { cursorChain: [] },
    )
  })

  it('routes the Jobs Show removed filter through a selection-clearing location reset', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    Object.assign(client.jobs, { get: vi.fn(async () => null) })
    const navigate = vi.fn()
    render(
      <LifecycleWorkbench
        client={client}
        selectedPhase="jobs"
        selectedResourceId="01900000-0000-7000-8000-000000000001"
        workspaceEntry={{
          location: {
            view: 'jobs',
            filter: 'include_removed',
            resourceId: '01900000-0000-7000-8000-000000000001',
            cursor: 'page-two',
            cursorDirection: 'after',
          },
          cursorChain: [{ view: 'jobs', filter: 'include_removed' }],
        }}
        onWorkspaceNavigate={navigate}
      />,
    )
    const showRemoved = await screen.findByRole('checkbox', { name: 'Show removed' })
    expect(showRemoved).toBeChecked()
    await user.click(showRemoved)
    expect(navigate).toHaveBeenCalledWith({
      view: 'jobs',
      filter: 'all',
    }, { cursorChain: [] })
  })

  it('restores the exact origin Job row and page when narrow Back uses browser history', async () => {
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
    const jobId = '01900000-0000-7000-8000-000000000001'
    const cursor = 'opaque/+ page'
    window.history.replaceState(
      null,
      '',
      `/?view=jobs&filter=include_removed&cursor=${encodeURIComponent(cursor)}&direction=after`,
    )
    const { client, lists } = makeClient()
    const job = {
      id: jobId,
      facts: {
        roleTitle: 'Narrow Job',
        companyName: 'Origin Company',
        sourceName: 'Test',
      },
      availability: { state: 'active' },
      externalIdentities: [],
    } as unknown as Job
    lists.jobs.mockResolvedValue({ items: [job], limit: 50, nextCursor: null })
    Object.assign(client.jobs, { get: vi.fn(async () => job) })
    render(<JobsHistoryHarness client={client} />)

    const origin = await screen.findByRole('button', { name: 'Narrow Job' })
    await userEvent.click(origin)
    await screen.findByRole('button', { name: 'Back to Jobs' })
    await userEvent.click(screen.getByRole('button', { name: 'Back to Jobs' }))

    await waitFor(() => expect(origin).toHaveFocus())
    expect(new URL(window.location.href).searchParams.get('cursor')).toBe(cursor)
    expect(new URL(window.location.href).searchParams.get('filter')).toBe('include_removed')
  })

  it('does not strand an unrelated phase when a selected-phase refresh supersedes its own load', async () => {
    const user = userEvent.setup()
    const { client, lists } = makeClient()
    let resolveJobs: ((page: TestPage) => void) | undefined
    lists.jobs.mockImplementationOnce(() => new Promise<TestPage>((resolve) => { resolveJobs = resolve }))
    render(<LifecycleWorkbench client={client} />)

    expect(await screen.findByText('No captures')).toBeInTheDocument()
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(lists.captures).toHaveBeenCalledTimes(2))
    await act(async () => resolveJobs?.(emptyPage()))

    await user.click(screen.getByRole('button', { name: /Jobs/ }))
    expect(await screen.findByText('No jobs')).toBeInTheDocument()
  })
})

function JobsHistoryHarness({ client }: { client: ValedictorianWorkspaceClient }) {
  const navigation = useWorkspaceLocation()
  return (
    <LifecycleWorkbench
      client={client}
      selectedPhase="jobs"
      selectedResourceId={navigation.entry.location.resourceId}
      workspaceEntry={navigation.entry}
      onWorkspaceNavigate={navigation.navigate}
      onOpenResource={(resourceId, focusAnchor) => navigation.navigate({
        ...navigation.entry.location,
        resourceId,
      }, {
        cursorChain: navigation.entry.cursorChain,
        focusAnchor,
      })}
      onBackFromResource={navigation.back}
    />
  )
}
