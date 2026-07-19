import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ValedictorianHttpError,
  ValedictorianTransportError,
  valedictorianFailureKindMessages,
} from 'sparxie'
import { createConnectorsApi } from '../App.test-helpers'
import { ConnectorRunsPanel } from './ConnectorRunsPanel'

afterEach(cleanup)

const JOBRIGHT_TEST_FILTERS = {
  jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
}

async function seedJobrightWithRun(connectorsApi: ReturnType<typeof createConnectorsApi>) {
  await connectorsApi.create({
    id: 'jobright-default',
    connectorId: 'jobright.resolver',
    connectorVersion: '0.13.0',
    displayName: 'Jobright internslist',
    enabled: true,
    auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'jobright-fixture' }],
    config: {},
    filters: JOBRIGHT_TEST_FILTERS,
  })
  vi.mocked(connectorsApi.runs.list).mockResolvedValue({
    items: [{
      id: 'connector-run-stale',
      connectorInstanceId: 'jobright-default',
      executionScopeId: 'scope_jobright_default',
      mode: 'manual' as const,
      scheduleOccurrence: null,
      status: 'completed' as const,
      coverage: { start: null, end: null },
      filterSignature: 'filters:{}',
      observationCount: 1,
      warningCount: 0,
      newestFrontier: { state: 'caught_up' as const },
      historicalBackfill: { state: 'caught_up' as const, boundary: { earliestDate: '2026-07-01' } },
      pendingResolutionCount: 0,
      outcome: { kind: 'caught_up' as const },
      stats: { observations: 1 },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-09T15:02:00.000Z',
      completedAt: '2026-07-09T15:02:01.000Z',
    }],
    total: 1,
    limit: 20,
    offset: 0,
    hasMore: false,
  })
}

describe('ConnectorRunsPanel LoadFailureView surfaces', () => {
  it('settles an initial AbortError to empty non-error UI without a truthy load failure', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError'),
    )

    render(<ConnectorRunsPanel connectorsApi={connectorsApi} />)

    expect(await screen.findByLabelText('Empty connector runs')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading connector runs...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('renders AuthenticationFailure with Retry for typed authentication load failures', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list)
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'authentication',
        message: 'runs auth dump /secret',
        status: 401,
      }))
      .mockResolvedValueOnce({ items: [] })

    render(<ConnectorRunsPanel connectorsApi={connectorsApi} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'authentication-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.authentication)
    expect(alert).not.toHaveTextContent('/secret')
    expect(document.querySelector('[data-slot="scoped-load-failure"]')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(connectorsApi.list).toHaveBeenCalledTimes(2))
    expect(await screen.findByLabelText('Empty connector runs')).toBeInTheDocument()
  })

  it('keeps stale run history beside GlobalFailureAlert after a typed transport refresh failure', async () => {
    const connectorsApi = createConnectorsApi()
    await seedJobrightWithRun(connectorsApi)
    const { rerender } = render(<ConnectorRunsPanel connectorsApi={connectorsApi} />)
    expect(await screen.findByLabelText('Connector run history')).toBeInTheDocument()
    expect(screen.getByText('Jobright internslist')).toBeInTheDocument()

    const failingApi = createConnectorsApi()
    await seedJobrightWithRun(failingApi)
    vi.mocked(failingApi.list).mockRejectedValue(new ValedictorianTransportError({
      cause: new Error('ECONNREFUSED /var/runs/secret'),
    }))
    rerender(<ConnectorRunsPanel connectorsApi={failingApi} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'global-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.unavailable)
    expect(alert).not.toHaveTextContent('ECONNREFUSED')
    expect(screen.getByLabelText('Connector run history')).toBeInTheDocument()
    expect(screen.getByText('Jobright internslist')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="scoped-load-failure"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('clears injected focused run A when switching to B and never restores A after B rejects', async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
    const runA = {
      id: 'focused-run-a',
      connectorInstanceId: 'jobright-default',
      executionScopeId: 'scope_jobright_default',
      mode: 'manual' as const,
      scheduleOccurrence: null,
      status: 'completed' as const,
      coverage: { start: null, end: null },
      filterSignature: 'filters:{}',
      observationCount: 1,
      warningCount: 0,
      newestFrontier: { state: 'caught_up' as const },
      historicalBackfill: { state: 'caught_up' as const, boundary: { earliestDate: '2026-07-01' } },
      pendingResolutionCount: 0,
      outcome: { kind: 'caught_up' as const },
      stats: { observations: 1 },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-08T15:02:00.000Z',
      completedAt: '2026-07-08T15:02:01.000Z',
    }
    const pageOneRun = {
      ...runA,
      id: 'page-one-run',
      startedAt: '2026-07-09T15:02:00.000Z',
      completedAt: '2026-07-09T15:02:01.000Z',
    }
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.13.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'jobright-fixture' }],
      config: {},
      filters: JOBRIGHT_TEST_FILTERS,
    })
    vi.mocked(connectorsApi.runs.list).mockImplementation(async (input) => {
      const offset = input?.offset ?? 0
      if (offset === 0) {
        return {
          items: [pageOneRun],
          total: 2,
          limit: 20,
          offset: 0,
          hasMore: true,
        }
      }
      return {
        items: [runA],
        total: 2,
        limit: 20,
        offset,
        hasMore: false,
      }
    })

    const { rerender } = render(
      <ConnectorRunsPanel
        connectorsApi={connectorsApi}
        focusedRunId="focused-run-a"
        onInspectNormalization={() => undefined}
      />,
    )

    expect(await screen.findByRole('button', {
      name: 'Inspect normalization rows from focused-run-a',
    })).toBeInTheDocument()
    expect(document.querySelector('[data-connector-run-id="focused-run-a"]')).not.toBeNull()
    expect(document.querySelector('[aria-current="true"]')).not.toBeNull()

    const failingApi = createConnectorsApi()
    await failingApi.create({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.13.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'jobright-fixture' }],
      config: {},
      filters: JOBRIGHT_TEST_FILTERS,
    })
    vi.mocked(failingApi.list).mockRejectedValue(new Error('focus B dump /secret'))

    rerender(
      <ConnectorRunsPanel
        connectorsApi={failingApi}
        focusedRunId="focused-run-b"
        onInspectNormalization={() => undefined}
      />,
    )

    expect(document.querySelector('[data-connector-run-id="focused-run-a"]')).toBeNull()
    expect(screen.queryByRole('button', {
      name: 'Inspect normalization rows from focused-run-a',
    })).not.toBeInTheDocument()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).not.toHaveTextContent('/secret')
    expect(screen.queryByLabelText('Connector run history')).not.toBeInTheDocument()
  })
})
