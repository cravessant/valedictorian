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
import { ValedictorianProtocolError } from 'sparxie'
import App from './App'
import {
  createActionQueueItem,
  createActionQueueResult,
  createApplication,
  createConnectorStatusResult,
  createConnectorStatusView,
  createListResult,
  createSettingsApi,
  createSourcingFinding,
  createSourcingResult,
} from './App.test-helpers'
import { ActionQueuePage } from './modules/action-queue/ActionQueuePage'
import { SourcingPage } from './modules/sourcing/SourcingPage'
import { ConnectorRunsPanel } from './settings/ConnectorRunsPanel'
import type { ConnectorsPreloadApi } from './ipc/connectors.preload'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
  delete (window as Window & { actionQueue?: unknown }).actionQueue
  delete (window as Window & { connectors?: unknown }).connectors
})

async function openConnectorsOverview() {
  const appNavigation = within(
    screen.getByRole('complementary', { name: 'Application navigation' }),
  ).getByRole('navigation', { name: 'Application views' })
  const connectorsTrigger = within(appNavigation).getByRole('button', { name: 'Connectors' })
  if (!within(appNavigation).queryByRole('button', { name: 'Overview' })) {
    fireEvent.click(connectorsTrigger)
  }
  fireEvent.click(await within(appNavigation).findByRole('button', { name: 'Overview' }))
  return appNavigation
}

describe('stale refresh failure presentation', () => {
  it('keeps Connector Status rows visible when a later refresh fails', async () => {
    const connectorStatusLoader = vi.fn()
      .mockResolvedValueOnce(createConnectorStatusResult([
        createConnectorStatusView({ displayName: 'Fixture Jobs' }),
      ]))
      .mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'refresh failed' }))
      .mockResolvedValue(createConnectorStatusResult([
        createConnectorStatusView({ displayName: 'Fixture Jobs' }),
      ]))

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorStatusLoader={connectorStatusLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    await openConnectorsOverview()
    expect(await screen.findByText('Fixture Jobs')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Applications' }))
    await screen.findByRole('table', { name: 'Applications' })
    await openConnectorsOverview()

    expect(await screen.findByText('Connector status could not be loaded.')).toBeInTheDocument()
    expect(screen.getByText('Fixture Jobs')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(connectorStatusLoader.mock.calls.length).toBeGreaterThanOrEqual(3))
  })

  it('keeps Connector Runs rows visible when a later poll fails and retries from the alert', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const runningRun = {
      id: 'run-stale-1',
      connectorInstanceId: 'connector-instance-fixture',
      executionScopeId: 'scope-1',
      mode: 'manual' as const,
      scheduleOccurrence: null,
      status: 'running' as const,
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      newestFrontier: { state: 'advancing' as const },
      historicalBackfill: {
        state: 'not_started' as const,
        boundary: { earliestDate: '2026-07-09' },
      },
      pendingResolutionCount: 0,
      outcome: { kind: 'in_progress' as const },
      warnings: [],
      startedAt: '2026-07-08T17:00:01.000Z',
      completedAt: null,
    }

    let listCalls = 0
    const connectorsApi = {
      list: vi.fn(async () => ({
        items: [{
          id: 'connector-instance-fixture',
          connectorId: 'jobright',
          displayName: 'Fixture Jobs',
        }],
      })),
      runs: {
        list: vi.fn(async () => {
          listCalls += 1
          if (listCalls === 1) {
            return { items: [runningRun], hasMore: false }
          }
          if (listCalls === 2) {
            throw new ValedictorianProtocolError({ message: 'poll failed' })
          }
          return { items: [runningRun], hasMore: false }
        }),
      },
    } as unknown as ConnectorsPreloadApi

    render(<ConnectorRunsPanel connectorsApi={connectorsApi} />)

    expect(await screen.findByText('Fixture Jobs')).toBeInTheDocument()
    expect(screen.getByLabelText('Connector run history')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100)
    })

    expect(await screen.findByText('Connector run history could not be loaded.')).toBeInTheDocument()
    expect(screen.getByText('Fixture Jobs')).toBeInTheDocument()
    const callsBeforeRetry = listCalls
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(listCalls).toBeGreaterThan(callsBeforeRetry))
  })

  it('keeps Applications, Action Queue, and Sourcing rows visible beside scoped refresh failures', () => {
    render(
      <ActionQueuePage
        actionBucket={undefined}
        contentColumnClass=""
        error={{
          message: 'Action Queue could not be loaded.',
          retryable: true,
          surface: 'scoped_load',
          title: 'Load failed',
        }}
        isLoading={false}
        result={createActionQueueResult([createActionQueueItem({ companyName: 'Delta Labs' })])}
        onActionBucketChange={vi.fn()}
        onEditApplication={vi.fn()}
        onOpenApplication={vi.fn()}
        onPreviousPage={vi.fn()}
        onNextPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('Action Queue could not be loaded.')).toBeInTheDocument()
    expect(screen.getByText('Delta Labs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()

    cleanup()

    render(
      <SourcingPage
        contentColumnClass=""
        error={{
          message: 'Opportunities could not be loaded.',
          retryable: true,
          surface: 'scoped_load',
          title: 'Load failed',
        }}
        focusedFindingId={null}
        isLoading={false}
        mergeStatus={undefined}
        destinationClass={undefined}
        promotingFindingIds={new Set()}
        result={createSourcingResult([createSourcingFinding()])}
        showDebugData={false}
        sourceId=""
        usability={undefined}
        onCreateFinding={vi.fn()}
        onDecideFinding={vi.fn()}
        onMergeStatusChange={vi.fn()}
        onDestinationClassChange={vi.fn()}
        onOpenApplication={vi.fn()}
        onPreviousPage={vi.fn()}
        onNextPage={vi.fn()}
        onPromoteFinding={vi.fn()}
        onSourceChange={vi.fn()}
        onUsabilityChange={vi.fn()}
        onUpdateFinding={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('Opportunities could not be loaded.')).toBeInTheDocument()
    expect(screen.getByText('Delta Labs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
