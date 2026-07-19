import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourcingFindingsListInput } from 'sparxie'
import { ValedictorianProtocolError } from 'sparxie'
import App from './App'
import {
  createActionQueueItem,
  createActionQueueResult,
  createApplication,
  createConnectorsApiWithJobrightDescriptor,
  createListResult,
  createProfileApi,
  createSettingsApi,
  createSourcingFinding,
  createSourcingResult,
  openConnectorDetails,
  openConnectorEditor,
  openSettingsPage,
  selectSoftwareEngineeringTaxonomy,
} from './App.test-helpers'

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
  delete (window as Window & { actionQueue?: unknown }).actionQueue
  delete (window as Window & { profile?: unknown }).profile
  delete (window as Window & { workspace?: unknown }).workspace
  delete (window as Window & { valedictorianWindowChrome?: unknown }).valedictorianWindowChrome
})

async function authenticateJobrightForSettlement(args: {
  connectorsApi: ReturnType<typeof createConnectorsApiWithJobrightDescriptor>
  profileApi: ReturnType<typeof createProfileApi>
}) {
  await openConnectorEditor()
  fireEvent.click(
    await screen.findByRole('button', { name: /^(Add credentials|Update credentials)$/ }),
  )
  fireEvent.change(await screen.findByLabelText('Jobright email'), {
    target: { value: 'demo@example.com' },
  })
  fireEvent.change(screen.getByLabelText('Jobright password'), {
    target: { value: 'pass' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))
  await screen.findByText('Auth verified')
  await selectSoftwareEngineeringTaxonomy()
  fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
  fireEvent.click(screen.getByRole('button', { name: 'Save Jobright internslist connector settings' }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
  })
  expect(args.connectorsApi.status.reconnect).toHaveBeenCalled()
  expect(args.profileApi.secrets.upsert).toHaveBeenCalled()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('App list query-identity boundaries', () => {
  it('clears Applications rows on filter identity change and does not restore A after B rejects', async () => {
    const appA = createApplication({ id: 'app-a', companyName: 'Alpha Applications Co' })
    const pendingB = deferred<ReturnType<typeof createListResult>>()
    const applicationLoader = vi.fn()
      .mockResolvedValueOnce(createListResult([appA]))
      .mockImplementationOnce(() => pendingB.promise)

    render(
      <App
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    expect(await screen.findByText('Alpha Applications Co')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'beta-query' } })

    expect(screen.queryByText('Alpha Applications Co')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Applications loading' })).toBeInTheDocument()

    pendingB.reject(new Error('applications B dump /secret'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).not.toHaveTextContent('/secret')
    expect(screen.queryByText('Alpha Applications Co')).not.toBeInTheDocument()
  })

  it('keeps Applications rows during same-query Retry pending and after rejection', async () => {
    const appA = createApplication({ id: 'app-a', companyName: 'Stale Applications Co' })
    const pendingRetry = deferred<ReturnType<typeof createListResult>>()

    const { rerender } = render(
      <App
        applicationLoader={vi.fn(async () => createListResult([appA]))}
        settingsApi={createSettingsApi()}
      />,
    )

    expect(await screen.findByText('Stale Applications Co')).toBeInTheDocument()

    const failingLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'refresh fail' }))
      .mockImplementationOnce(() => pendingRetry.promise)
    rerender(
      <App
        applicationLoader={failingLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    expect(await screen.findByText('Applications could not be loaded.')).toBeInTheDocument()
    expect(screen.getByText('Stale Applications Co')).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('Stale Applications Co')).toBeInTheDocument()

    pendingRetry.reject(new ValedictorianProtocolError({ message: 'retry fail' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'scoped-load-failure')
    })
    expect(screen.getByText('Stale Applications Co')).toBeInTheDocument()
  })

  it('clears Action Queue rows on bucket identity change and does not restore A after B rejects', async () => {
    const itemA = createActionQueueItem({
      id: 'aq-a',
      companyName: 'Alpha Queue Co',
      actionBucket: 'apply_now',
    })
    const pendingB = deferred<ReturnType<typeof createActionQueueResult>>()
    const actionQueueLoader = vi.fn()
      .mockResolvedValueOnce(createActionQueueResult([itemA]))
      .mockImplementationOnce(() => pendingB.promise)

    render(
      <App
        actionQueueLoader={actionQueueLoader}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Action Queue' }))
    expect(await screen.findByText('Alpha Queue Co')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /Needs info/ }))

    expect(screen.queryByText('Alpha Queue Co')).not.toBeInTheDocument()

    pendingB.reject(new Error('queue B dump /secret'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).not.toHaveTextContent('/secret')
    expect(screen.queryByText('Alpha Queue Co')).not.toBeInTheDocument()
  })

  it('clears Sourcing rows on filter identity change and does not restore A after B rejects', async () => {
    const findingA = createSourcingFinding({
      id: 'finding-a',
      roleTitle: 'Alpha Sourcing Role',
      companyName: 'Alpha Sourcing Co',
    })
    const pendingB = deferred<ReturnType<typeof createSourcingResult>>()
    const sourcingLoader = vi.fn()
      .mockResolvedValueOnce(createSourcingResult([findingA]))
      .mockImplementationOnce(() => pendingB.promise)

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        sourcingLoader={sourcingLoader}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Sourcing' }))
    expect(await screen.findByText('Alpha Sourcing Role')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Merge status'), { target: { value: 'new' } })

    expect(screen.queryByText('Alpha Sourcing Role')).not.toBeInTheDocument()

    pendingB.reject(new Error('sourcing B dump /secret'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).not.toHaveTextContent('/secret')
    expect(screen.queryByText('Alpha Sourcing Role')).not.toBeInTheDocument()
  })

  it('keeps Sourcing rows during same-query Retry after a refresh failure', async () => {
    const findingA = createSourcingFinding({
      id: 'finding-stale',
      roleTitle: 'Stale Sourcing Role',
    })

    const { rerender } = render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        sourcingLoader={vi.fn(async () => createSourcingResult([findingA]))}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Sourcing' }))
    expect(await screen.findByText('Stale Sourcing Role')).toBeInTheDocument()

    const failingLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'sourcing refresh fail' }))
      .mockResolvedValueOnce(createSourcingResult([findingA]))
    rerender(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        sourcingLoader={failingLoader}
      />,
    )

    expect(await screen.findByText('Opportunities could not be loaded.')).toBeInTheDocument()
    expect(screen.getByText('Stale Sourcing Role')).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(failingLoader).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Stale Sourcing Role')).toBeInTheDocument()
  })

  it('does not let a deferred connector-settlement Sourcing refresh overwrite a newer filter target', async () => {
    const findingA = createSourcingFinding({
      id: 'finding-settlement-a',
      companyName: 'Settlement Co A',
      roleTitle: 'Settlement Role A',
    })
    const findingB = createSourcingFinding({
      id: 'finding-filter-b',
      companyName: 'Filter Co B',
      roleTitle: 'Filter Role B',
      mergeStatus: 'new',
    })
    const deferredSettlementRefresh = deferred<ReturnType<typeof createSourcingResult>>()
    let deferNextDefaultQuery = false
    const sourcingLoader = vi.fn(async (query: SourcingFindingsListInput) => {
      if (query.mergeStatus === 'new') {
        return createSourcingResult([findingB])
      }
      if (deferNextDefaultQuery) {
        deferNextDefaultQuery = false
        return deferredSettlementRefresh.promise
      }
      return createSourcingResult([findingA])
    })

    const connectorsApi = createConnectorsApiWithJobrightDescriptor()
    const profileApi = createProfileApi()
    type ConnectorRun = Awaited<ReturnType<typeof connectorsApi.runs.trigger>>
    let resolveRun: ((run: ConnectorRun) => void) | undefined
    const pendingRun = new Promise<ConnectorRun>((resolve) => {
      resolveRun = resolve
    })
    vi.mocked(connectorsApi.runs.trigger).mockReturnValueOnce(pendingRun)

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        sourcingLoader={sourcingLoader}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await waitFor(() => expect(connectorsApi.create).toHaveBeenCalled())
    await authenticateJobrightForSettlement({ connectorsApi, profileApi })
    await openConnectorDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    expect(await screen.findByText('Settlement Role A')).toBeInTheDocument()

    deferNextDefaultQuery = true
    await act(async () => {
      resolveRun?.({
        id: 'connector-run-settlement',
        connectorInstanceId: 'jobright-default',
        executionScopeId: 'scope_jobright_default',
        mode: 'manual',
        scheduleOccurrence: null,
        status: 'completed',
        filterSignature: 'filters:{}',
        observationCount: 1,
        warningCount: 0,
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'caught_up',
          boundary: { earliestDate: '2026-07-01' },
        },
        pendingResolutionCount: 0,
        outcome: { kind: 'caught_up' },
        warnings: [],
        startedAt: '2026-07-09T16:00:00.000Z',
        completedAt: '2026-07-09T16:00:01.000Z',
      } as ConnectorRun)
    })

    await waitFor(() => {
      expect(sourcingLoader.mock.calls.some((call) => call[0]?.mergeStatus === undefined)).toBe(true)
      expect(deferredSettlementRefresh.promise).toBeInstanceOf(Promise)
    })
    await waitFor(() => expect(deferNextDefaultQuery).toBe(false))

    fireEvent.change(screen.getByLabelText('Merge status'), { target: { value: 'new' } })
    expect(await screen.findByText('Filter Role B')).toBeInTheDocument()
    expect(screen.queryByText('Settlement Role A')).not.toBeInTheDocument()

    await act(async () => {
      deferredSettlementRefresh.resolve(createSourcingResult([findingA]))
    })

    expect(screen.queryByText('Settlement Role A')).not.toBeInTheDocument()
    expect(screen.getByText('Filter Role B')).toBeInTheDocument()
    expect(screen.getByLabelText('Merge status')).toHaveValue('new')
  })

  it('refreshes Sourcing after deferred connector settlement when the Settings panel closed', async () => {
    const sourcingLoader = vi.fn(async () => createSourcingResult([
      createSourcingFinding({ id: 'finding-panel-close', roleTitle: 'Panel Close Role' }),
    ]))
    const connectorsApi = createConnectorsApiWithJobrightDescriptor()
    const profileApi = createProfileApi()
    type ConnectorRun = Awaited<ReturnType<typeof connectorsApi.runs.trigger>>
    const pending = deferred<ConnectorRun>()
    vi.mocked(connectorsApi.runs.trigger).mockReturnValueOnce(pending.promise)

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        sourcingLoader={sourcingLoader}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await waitFor(() => expect(connectorsApi.create).toHaveBeenCalled())
    await authenticateJobrightForSettlement({ connectorsApi, profileApi })
    await openConnectorDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    expect(await screen.findByText('Panel Close Role')).toBeInTheDocument()
    const sourcingCallsAfterNavigate = sourcingLoader.mock.calls.length

    await act(async () => {
      pending.resolve(completedConnectorRun())
      await pending.promise
    })

    await waitFor(() => {
      expect(sourcingLoader.mock.calls.length).toBeGreaterThan(sourcingCallsAfterNavigate)
    })
    expect(screen.getByText('Panel Close Role')).toBeInTheDocument()
  })

})

function completedConnectorRun() {
  return {
    id: 'connector-run-settlement',
    connectorInstanceId: 'jobright-default',
    executionScopeId: 'scope_jobright_default',
    mode: 'manual' as const,
    scheduleOccurrence: null,
    status: 'completed' as const,
    filterSignature: 'filters:{}',
    observationCount: 1,
    warningCount: 0,
    newestFrontier: { state: 'caught_up' as const },
    historicalBackfill: {
      state: 'caught_up' as const,
      boundary: { earliestDate: '2026-07-01' },
    },
    pendingResolutionCount: 0,
    outcome: { kind: 'caught_up' as const },
    warnings: [],
    startedAt: '2026-07-09T16:00:00.000Z',
    completedAt: '2026-07-09T16:00:01.000Z',
  }
}
