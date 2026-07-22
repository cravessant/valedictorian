import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ValedictorianWorkspaceClient } from 'sparxie'

import { LifecycleWorkbench } from './lifecycle-workbench'
import { openCapturesForRun } from '@/app/capture-navigation'

afterEach(() => {
  cleanup()
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
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
    captures: vi.fn(async () => emptyPage()),
    jobs: vi.fn(async () => emptyPage()),
    opportunities: vi.fn(async () => emptyPage()),
    applications: vi.fn(async () => emptyPage()),
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
      expect(lists.jobs).toHaveBeenCalledTimes(1)
      expect(lists.opportunities).toHaveBeenCalledTimes(1)
      expect(lists.applications).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: /Jobs/ }))
    expect(await screen.findByRole('table', { name: 'Jobs' })).toBeInTheDocument()
    expect(screen.getByText('No jobs')).toBeInTheDocument()
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
    expect(request).toHaveBeenCalledTimes(4)
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

  it('follows pagination cursors for every aggregate', async () => {
    const { client, lists } = makeClient()
    for (const [phase, list] of Object.entries(lists)) {
      list
        .mockResolvedValueOnce({ items: [], limit: 100, nextCursor: `${phase}-page-2` })
        .mockResolvedValueOnce(emptyPage())
    }
    render(<LifecycleWorkbench client={client} />)

    await waitFor(() => {
      for (const list of Object.values(lists)) expect(list).toHaveBeenCalledTimes(2)
    })
    for (const [phase, list] of Object.entries(lists)) {
      expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({
        cursor: `${phase}-page-2`,
        limit: 100,
      }))
    }
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
