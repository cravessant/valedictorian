// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Application,
  ValedictorianWorkspaceClient,
} from 'sparxie'

import { LifecycleWorkbench } from './lifecycle-workbench'
import {
  DESKTOP_USER_ACTOR,
  __resetLifecycleActorCounterForTests,
} from './lifecycle-actor'
import {
  createActionQueueItem,
  createActionQueueResult,
} from '../../App.test-helpers'

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
Element.prototype.scrollIntoView = vi.fn()

afterEach(() => {
  cleanup()
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
})

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

function emptyPage() {
  return { items: [], limit: 100, nextCursor: null }
}

function makeClient(seed: {
  applications?: Application[]
  actionQueueItems?: ReturnType<typeof createActionQueueItem>[]
} = {}) {
  const applications = {
    list: vi.fn(async () => ({ items: seed.applications ?? [], limit: 100, nextCursor: null })),
    get: vi.fn(async (id: string) => seed.applications?.find((a) => a.id === id) ?? null),
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
  const actionQueue = {
    list: vi.fn(async () => createActionQueueResult(seed.actionQueueItems ?? [])),
  }
  const client = {
    captures: { list: vi.fn(async () => emptyPage()) },
    jobs: { list: vi.fn(async () => emptyPage()) },
    opportunities: { list: vi.fn(async () => emptyPage()) },
    applications,
    actionQueue,
  } as unknown as ValedictorianWorkspaceClient
  return { client, applications, actionQueue }
}

async function switchToApplications(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Applications/ }))
}

async function switchToActionQueueMode(user: ReturnType<typeof userEvent.setup>) {
  const modeGroup = screen.getByRole('radiogroup', { name: 'Applications view mode' })
  await user.click(within(modeGroup).getByRole('radio', { name: 'Action Queue' }))
}

describe('A308-1: navigation hierarchy and mode placement', () => {
  it('keeps Captures, Jobs, Opportunities, Applications as top-level lifecycle peers', async () => {
    const { client } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    const nav = screen.getByRole('navigation', { name: 'Lifecycle phase' })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.map((b) => b.textContent?.replace(/\d+$/, '').trim())).toEqual([
      'Captures', 'Jobs', 'Opportunities', 'Applications',
    ])
  })

  it('does not expose Action Queue as a top-level lifecycle destination', async () => {
    const { client } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    const nav = screen.getByRole('navigation', { name: 'Lifecycle phase' })
    expect(within(nav).queryByRole('button', { name: /Action Queue/ })).not.toBeInTheDocument()
  })

  it('Applications presents an internal All / Action Queue single-select mode toggle', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    const modeGroup = screen.getByRole('radiogroup', { name: 'Applications view mode' })
    expect(modeGroup).toHaveAttribute('data-slot', 'toggle-group')
    const all = within(modeGroup).getByRole('radio', { name: 'All' })
    const queue = within(modeGroup).getByRole('radio', { name: 'Action Queue' })
    expect(all).toHaveAttribute('aria-checked', 'true')
    expect(queue).toHaveAttribute('aria-checked', 'false')
  })

  it('derives Applications mode from location and routes mode changes back to it', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    const navigate = vi.fn()
    const { rerender } = render(
      <LifecycleWorkbench
        client={client}
        selectedPhase="applications"
        workspaceEntry={{
          location: { view: 'applications', mode: 'action-queue' },
          cursorChain: [],
        }}
        onWorkspaceNavigate={navigate}
      />,
    )
    const modeGroup = screen.getByRole('radiogroup', { name: 'Applications view mode' })
    expect(within(modeGroup).getByRole('radio', { name: 'Action Queue' }))
      .toHaveAttribute('aria-checked', 'true')

    await user.click(within(modeGroup).getByRole('radio', { name: 'All' }))
    expect(navigate).toHaveBeenCalledWith(
      { view: 'applications', mode: 'all' },
      { cursorChain: [] },
    )

    rerender(
      <LifecycleWorkbench
        client={client}
        selectedPhase="applications"
        workspaceEntry={{
          location: { view: 'applications', mode: 'all' },
          cursorChain: [],
        }}
        onWorkspaceNavigate={navigate}
      />,
    )
    expect(screen.getByRole('table', { name: 'Applications' })).toBeInTheDocument()
  })
})

describe('A308-2: All mode preserves the lifecycle table', () => {
  it('All mode renders the Applications lifecycle table with existing columns', async () => {
    const user = userEvent.setup()
    const app = makeApplication('app-1')
    const { client } = makeClient({ applications: [app] })
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })
})

describe('A308-3: Action Queue mode calls client.actionQueue.list', () => {
  it('calls client.actionQueue.list when switching to Action Queue mode', async () => {
    const user = userEvent.setup()
    const { client, actionQueue } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    expect(actionQueue.list).not.toHaveBeenCalled()
    await switchToActionQueueMode(user)
    await waitFor(() => expect(actionQueue.list).toHaveBeenCalledTimes(1))
  })

  it('preserves bucket counts from the server result', async () => {
    const user = userEvent.setup()
    const item = createActionQueueItem({ actionBucket: 'apply_now' })
    const { client } = makeClient({ actionQueueItems: [item] })
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    const buckets = await screen.findByRole('radiogroup', { name: 'Action queue buckets' })
    expect(within(buckets).getByRole('radio', { name: 'Apply now 1' })).toBeInTheDocument()
    expect(within(buckets).getByRole('radio', { name: /^All 1$/ })).toBeInTheDocument()
  })

  it('filters by bucket selection and resets offset', async () => {
    const user = userEvent.setup()
    const item = createActionQueueItem({ actionBucket: 'apply_now' })
    const { client, actionQueue } = makeClient({ actionQueueItems: [item] })
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByRole('radiogroup', { name: 'Action queue buckets' })
    const buckets = screen.getByRole('radiogroup', { name: 'Action queue buckets' })
    await user.click(within(buckets).getByRole('radio', { name: 'Apply now 1' }))
    await waitFor(() => {
      expect(actionQueue.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ actionBucket: 'apply_now', offset: 0 }),
      )
    })
  })

  it('supports offset pagination with Previous/Next', async () => {
    const user = userEvent.setup()
    const items = Array.from({ length: 3 }, (_, i) =>
      createActionQueueItem({ id: `app-${i}`, actionBucket: 'apply_now' }))
    const result = {
      ...createActionQueueResult(items),
      total: 80,
      offset: 0,
      hasMore: true,
    }
    const { client, actionQueue } = makeClient()
    actionQueue.list.mockResolvedValue(result)
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    const pagination = await screen.findByRole('navigation', { name: 'Action Queue pagination' })
    expect(within(pagination).getByRole('button', { name: 'Previous action queue page' })).toBeDisabled()
    expect(within(pagination).getByRole('button', { name: 'Next action queue page' })).toBeEnabled()
    await user.click(within(pagination).getByRole('button', { name: 'Next action queue page' }))
    await waitFor(() => {
      expect(actionQueue.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 50 }),
      )
    })
  })

  it('shows reasons and next actions in queue rows', async () => {
    const user = userEvent.setup()
    const item = createActionQueueItem({
      reason: 'Queued score 8 meets policy cutoff 6.',
      nextAction: 'apply_now',
    })
    const { client } = makeClient({ actionQueueItems: [item] })
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    expect(await screen.findByText('Queued score 8 meets policy cutoff 6.')).toBeInTheDocument()
    expect(screen.getByText('Apply now')).toBeInTheDocument()
  })
})

describe('A308-4: shared Application modal actions and reconciliation', () => {
  beforeEach(() => { __resetLifecycleActorCounterForTests() })

  it('queue row actions open the same Application controller modals', async () => {
    const user = userEvent.setup()
    const app = makeApplication('app-1')
    const item = createActionQueueItem({ id: 'app-1', actionBucket: 'apply_now' })
    const { client } = makeClient({ applications: [app], actionQueueItems: [item] })
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByRole('table', { name: 'Action Queue' })
    const trigger = screen.getByRole('button', { name: /Actions for row/ })
    await user.click(trigger)
    const menu = await screen.findByRole('menu', { name: /Row actions for/ })
    const labels = within(menu).getAllByRole('menuitem').map((el) => el.textContent)
    expect(labels).toEqual(expect.arrayContaining([
      'Update status', 'Update company', 'Update source', 'Remove application', 'View history',
    ]))
  })

  it('reconciles queue item to canonical Application for modal actions', async () => {
    const user = userEvent.setup()
    const app = makeApplication('app-1', { companyName: 'Acme Corp' })
    const item = createActionQueueItem({ id: 'app-1', companyName: 'Acme Corp', actionBucket: 'apply_now' })
    const { client, applications } = makeClient({ applications: [app], actionQueueItems: [item] })
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByRole('table', { name: 'Action Queue' })
    const trigger = screen.getByRole('button', { name: /Actions for row/ })
    await user.click(trigger)
    const menu = await screen.findByRole('menu', { name: /Row actions for/ })
    await user.click(within(menu).getByRole('menuitem', { name: 'Update status' }))
    const dialog = await screen.findByRole('dialog', { name: 'Update status' })
    expect(dialog).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Rationale' }), 'Status change.')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(applications.updateStatus).toHaveBeenCalledTimes(1))
    expect(applications.updateStatus).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 'app-1',
      rationale: 'Status change.',
    }))
  })

  it('fetches Application through client when not in loaded data', async () => {
    const user = userEvent.setup()
    const app = makeApplication('app-missing', { companyName: 'Fetched Co' })
    const item = createActionQueueItem({ id: 'app-missing', companyName: 'Fetched Co', actionBucket: 'apply_now' })
    const { client, applications } = makeClient({ applications: [], actionQueueItems: [item] })
    applications.get.mockResolvedValue(app)
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByRole('table', { name: 'Action Queue' })
    const trigger = screen.getByRole('button', { name: /Actions for row/ })
    await user.click(trigger)
    const menu = await screen.findByRole('menu', { name: /Row actions for/ })
    await user.click(within(menu).getByRole('menuitem', { name: 'Update status' }))
    await waitFor(() => expect(applications.get).toHaveBeenCalledWith('app-missing'))
    expect(await screen.findByRole('dialog', { name: 'Update status' })).toBeInTheDocument()
  })

  it('a successful Application mutation refreshes both All and Action Queue', async () => {
    const user = userEvent.setup()
    const app = makeApplication('app-1')
    const item = createActionQueueItem({ id: 'app-1', actionBucket: 'apply_now' })
    const { client, applications, actionQueue } = makeClient({ applications: [app], actionQueueItems: [item] })
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByRole('table', { name: 'Action Queue' })
    const callsBefore = applications.list.mock.calls.length
    const queueCallsBefore = actionQueue.list.mock.calls.length
    const trigger = screen.getByRole('button', { name: /Actions for row/ })
    await user.click(trigger)
    const menu = await screen.findByRole('menu', { name: /Row actions for/ })
    await user.click(within(menu).getByRole('menuitem', { name: 'Update status' }))
    const dialog = await screen.findByRole('dialog', { name: 'Update status' })
    await user.type(screen.getByRole('textbox', { name: 'Rationale' }), 'Done.')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(applications.updateStatus).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(applications.list.mock.calls.length).toBeGreaterThan(callsBefore)
      expect(actionQueue.list.mock.calls.length).toBeGreaterThan(queueCallsBefore)
    })
  })
})

describe('A308-5: separate loading/error/empty state per mode', () => {
  it('shows loading state independently for Action Queue mode', async () => {
    const user = userEvent.setup()
    let resolveQueue: ((value: unknown) => void) | undefined
    const { client, actionQueue } = makeClient()
    actionQueue.list.mockImplementationOnce(() => new Promise((resolve) => { resolveQueue = resolve }))
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    expect(await screen.findByTestId('action-queue-loading')).toBeInTheDocument()
    await act(async () => resolveQueue?.(createActionQueueResult([])))
    expect(await screen.findByLabelText('Empty action queue')).toBeInTheDocument()
  })

  it('shows safe error state with retry for Action Queue mode (no raw Error.message)', async () => {
    const user = userEvent.setup()
    const { client, actionQueue } = makeClient()
    actionQueue.list.mockRejectedValueOnce(new Error('queue unavailable'))
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Action Queue could not be loaded.')
    expect(alert).not.toHaveTextContent('queue unavailable')
    actionQueue.list.mockResolvedValueOnce(createActionQueueResult([]))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('Empty action queue')).toBeInTheDocument()
  })

  it('All mode retains its own loaded state when Action Queue fails', async () => {
    const user = userEvent.setup()
    const app = makeApplication('app-1')
    const { client, actionQueue } = makeClient({ applications: [app] })
    actionQueue.list.mockRejectedValueOnce(new Error('queue down'))
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    await switchToActionQueueMode(user)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Action Queue could not be loaded.')
    expect(alert).not.toHaveTextContent('queue down')
    const modeGroup = screen.getByRole('radiogroup', { name: 'Applications view mode' })
    await user.click(within(modeGroup).getByRole('radio', { name: 'All' }))
    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('switching modes never presents stale Action Queue data as success', async () => {
    const user = userEvent.setup()
    const { client, actionQueue } = makeClient()
    let resolveSecond: ((value: unknown) => void) | undefined
    actionQueue.list
      .mockResolvedValueOnce(createActionQueueResult([]))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByLabelText('Empty action queue')
    const modeGroup = screen.getByRole('radiogroup', { name: 'Applications view mode' })
    await user.click(within(modeGroup).getByRole('radio', { name: 'All' }))
    await user.click(within(modeGroup).getByRole('radio', { name: 'Action Queue' }))
    expect(await screen.findByTestId('action-queue-loading')).toBeInTheDocument()
    await act(async () => resolveSecond?.(createActionQueueResult([])))
    expect(await screen.findByLabelText('Empty action queue')).toBeInTheDocument()
  })
})

describe('A308-6: keyboard and accessibility', () => {
  it('mode toggle is keyboard-operable via arrow keys and space', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    const modeGroup = screen.getByRole('radiogroup', { name: 'Applications view mode' })
    const all = within(modeGroup).getByRole('radio', { name: 'All' })
    all.focus()
    await user.keyboard('{ArrowRight}')
    const queue = within(modeGroup).getByRole('radio', { name: 'Action Queue' })
    expect(queue).toHaveFocus()
    await user.keyboard(' ')
    expect(queue).toHaveAttribute('aria-checked', 'true')
  })

  it('bucket toggle is keyboard-operable', async () => {
    const user = userEvent.setup()
    const item = createActionQueueItem({ actionBucket: 'apply_now' })
    const { client } = makeClient({ actionQueueItems: [item] })
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    const buckets = await screen.findByRole('radiogroup', { name: 'Action queue buckets' })
    const all = within(buckets).getByRole('radio', { name: /^All / })
    all.focus()
    await user.keyboard('{ArrowRight}')
    const applyNow = within(buckets).getByRole('radio', { name: /Apply now/ })
    expect(applyNow).toHaveFocus()
    await user.keyboard(' ')
    expect(applyNow).toHaveAttribute('aria-checked', 'true')
  })

  it('mode and bucket controls wrap at narrow widths', async () => {
    const user = userEvent.setup()
    const { client } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    const modeGroup = screen.getByRole('radiogroup', { name: 'Applications view mode' })
    expect(modeGroup.className).toContain('flex-wrap')
    await switchToActionQueueMode(user)
    const buckets = await screen.findByRole('radiogroup', { name: 'Action queue buckets' })
    expect(buckets.className).toContain('flex-wrap')
  })
})

describe('validator fix 1: generation fencing on client change', () => {
  it('a pending queue request from client A cannot overwrite state after the client is replaced', async () => {
    const user = userEvent.setup()
    let resolveFirst: ((value: unknown) => void) | undefined
    const { client, actionQueue } = makeClient()
    actionQueue.list.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    const { rerender } = render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    expect(await screen.findByTestId('action-queue-loading')).toBeInTheDocument()

    const secondClient = makeClient()
    secondClient.actionQueue.list.mockResolvedValue(createActionQueueResult([]))
    rerender(<LifecycleWorkbench client={secondClient.client} />)

    await act(async () =>
      resolveFirst?.(createActionQueueResult([createActionQueueItem({ id: 'stale-item' })])))
    await waitFor(() => expect(secondClient.actionQueue.list).toHaveBeenCalled())
    expect(screen.queryByText('stale-item')).not.toBeInTheDocument()
  })
})

describe('validator fix 2: manual Refresh control for Action Queue mode', () => {
  it('shows a visible Refresh button that triggers a queue reload with truthful loading state', async () => {
    const user = userEvent.setup()
    let resolveRefresh: ((value: unknown) => void) | undefined
    const { client, actionQueue } = makeClient()
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByLabelText('Empty action queue')

    actionQueue.list.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    const refreshButton = screen.getByRole('button', { name: 'Refresh' })
    expect(refreshButton).toBeEnabled()
    await user.click(refreshButton)
    expect(await screen.findByTestId('action-queue-loading')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    await act(async () => resolveRefresh?.(createActionQueueResult([])))
    expect(await screen.findByLabelText('Empty action queue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })
})

describe('validator fix 3: shared Application action enablement contract', () => {
  beforeEach(() => { __resetLifecycleActorCounterForTests() })

  it('Restore is disabled for an active (non-removed) Application resolved from a queue row', async () => {
    const user = userEvent.setup()
    const app = makeApplication('app-1', { removedAt: null })
    const item = createActionQueueItem({ id: 'app-1', actionBucket: 'apply_now' })
    const { client } = makeClient({ applications: [app], actionQueueItems: [item] })
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByRole('table', { name: 'Action Queue' })
    await user.click(screen.getByRole('button', { name: /Actions for row/ }))
    const menu = await screen.findByRole('menu', { name: /Row actions for/ })
    const restoreItem = within(menu).getByRole('menuitem', { name: 'Restore application' })
    expect(restoreItem).toHaveAttribute('aria-disabled', 'true')
    expect(within(menu).getByRole('menuitem', { name: 'Update status' })).not.toHaveAttribute('aria-disabled')
  })

  it('a valid action still works after disabled evaluation', async () => {
    const user = userEvent.setup()
    const app = makeApplication('app-1', { removedAt: null })
    const item = createActionQueueItem({ id: 'app-1', actionBucket: 'apply_now' })
    const { client, applications } = makeClient({ applications: [app], actionQueueItems: [item] })
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByRole('table', { name: 'Action Queue' })
    await user.click(screen.getByRole('button', { name: /Actions for row/ }))
    const menu = await screen.findByRole('menu', { name: /Row actions for/ })
    await user.click(within(menu).getByRole('menuitem', { name: 'Update status' }))
    const dialog = await screen.findByRole('dialog', { name: 'Update status' })
    await user.type(screen.getByRole('textbox', { name: 'Rationale' }), 'Change.')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(applications.updateStatus).toHaveBeenCalledTimes(1))
  })
})

describe('validator fix 4: canonical Application resolution failure ownership', () => {
  it('shows a canonical safe error when Application fetch rejects, without raw upstream text', async () => {
    const user = userEvent.setup()
    const item = createActionQueueItem({ id: 'app-missing', actionBucket: 'apply_now' })
    const { client, applications } = makeClient({ applications: [], actionQueueItems: [item] })
    applications.get.mockRejectedValue(new Error('network down'))
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByRole('table', { name: 'Action Queue' })
    await user.click(screen.getByRole('button', { name: /Actions for row/ }))
    const alert = await screen.findByTestId('queue-resolution-error')
    expect(alert).toHaveTextContent('Application could not be loaded.')
    expect(alert).not.toHaveTextContent('network down')
  })

  it('shows a canonical safe error when Application is not found, without dynamic id text', async () => {
    const user = userEvent.setup()
    const item = createActionQueueItem({ id: 'app-gone', actionBucket: 'apply_now' })
    const { client, applications } = makeClient({ applications: [], actionQueueItems: [item] })
    applications.get.mockResolvedValue(null)
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByRole('table', { name: 'Action Queue' })
    await user.click(screen.getByRole('button', { name: /Actions for row/ }))
    const alert = await screen.findByTestId('queue-resolution-error')
    expect(alert).toHaveTextContent('Application detail could not be found.')
    expect(alert).not.toHaveTextContent('app-gone')
  })
})

describe('validator fix 6: nonzero-offset empty page recovery', () => {
  it('recovers to offset 0 when a nonzero-offset page is empty but total > 0', async () => {
    const user = userEvent.setup()
    const { client, actionQueue } = makeClient()
    const firstPage = {
      ...createActionQueueResult([createActionQueueItem()]),
      total: 80,
      offset: 0,
      hasMore: true,
    }
    const emptyHighPage = {
      ...createActionQueueResult([]),
      total: 3,
      offset: 50,
      hasMore: false,
    }
    const recoveredPage = {
      ...createActionQueueResult([createActionQueueItem({ id: 'recovered', companyName: 'Recovered Co' })]),
      total: 3,
      offset: 0,
      hasMore: false,
    }
    actionQueue.list.mockImplementation(async (query?: { offset?: number }) => {
      const queryOffset = query?.offset ?? 0
      if (queryOffset === 50) return emptyHighPage
      if (actionQueue.list.mock.calls.length >= 3) return recoveredPage
      return firstPage
    })
    render(<LifecycleWorkbench client={client} />)
    await switchToApplications(user)
    await switchToActionQueueMode(user)
    await screen.findByRole('table', { name: 'Action Queue' })
    const pagination = screen.getByRole('navigation', { name: 'Action Queue pagination' })
    await user.click(within(pagination).getByRole('button', { name: 'Next action queue page' }))
    expect(await screen.findByText('Recovered Co')).toBeInTheDocument()
    await waitFor(() => {
      const lastCall = actionQueue.list.mock.calls.at(-1)?.[0]
      expect(lastCall).toEqual(expect.objectContaining({ offset: 0 }))
    })
  })
})
