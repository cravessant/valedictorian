import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectorsApi } from '../App.test-helpers'
import type { ConnectorSettingsRun } from './connector-settings.types'
import {
  ConnectorRunLifecycleDetails,
  ConnectorRunSynchronizationDetails,
} from './ConnectorRunDetails'
import { ConnectorRunsPanel } from './ConnectorRunsPanel'

afterEach(cleanup)

function runFixture(overrides: Partial<ConnectorSettingsRun> = {}): ConnectorSettingsRun {
  return {
    id: 'connector-run-responsive',
    connectorInstanceId: 'jobright-responsive',
    executionScopeId: 'scope_fixture_responsive',
    mode: 'manual',
    scheduleOccurrence: null,
    status: 'failed',
    filterSignature: 'filters:{}',
    observationCount: 0,
    warningCount: 1,
    warnings: [{ code: 'jobright_auth_failed', message: 'Authentication failed' }],
    newestFrontier: { state: 'not_started' },
    historicalBackfill: {
      state: 'not_started',
      boundary: { earliestDate: '2026-07-01' },
    },
    pendingResolutionCount: 0,
    outcome: { kind: 'failed', reason: 'provider_schema_changed' },
    startedAt: '2026-07-12T12:00:00.000Z',
    completedAt: '2026-07-12T12:01:00.000Z',
    ...overrides,
  }
}

describe('connector status and run responsive inspectability', () => {
  it('keeps run status, summary, warnings, timestamp, and actions inspectable without truncation', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-responsive',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.11.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [],
      config: {},
      filters: {},
    })
    const run = runFixture()
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      items: [run],
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    })
    const viewCaptures = vi.fn()

    render(
      <ConnectorRunsPanel
        connectorsApi={connectorsApi}
        onViewCaptures={viewCaptures}
      />,
    )

    const article = await screen.findByRole('article')
    expect(article).toHaveAttribute('data-connector-run-id', run.id)
    expect(article).toHaveClass('min-w-0')

    const header = article.querySelector('[data-slot="card-header"]')
    const card = article.querySelector('[data-slot="card"]')
    expect(card).not.toBeNull()
    expect(card).toHaveClass('@container/connector-run-card', 'min-w-0')
    expect(card).not.toHaveClass('overflow-x-auto')
    expect(header).not.toBeNull()
    expect(header).toHaveClass(
      'min-w-0',
      'has-data-[slot=card-action]:grid-cols-1',
      '@md/connector-run-card:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]',
    )
    const cardAction = article.querySelector('[data-slot="card-action"]')
    expect(cardAction).toHaveClass(
      'col-start-1',
      'row-span-1',
      'row-start-3',
      '@md/connector-run-card:col-start-2',
      '@md/connector-run-card:row-span-2',
      '@md/connector-run-card:row-start-1',
    )

    const status = within(article).getByRole('status', { name: 'Connector synchronization state' })
    expect(status).toHaveClass('min-w-0')
    expect(status).toHaveTextContent('Failed')
    expect(status).toHaveTextContent('Synchronization stopped because the connector failed.')
    expect(status.className).not.toMatch(/\btruncate\b/)
    expect(status.textContent ?? '').not.toMatch(/…$/)

    const timestamp = within(article).getByText(`manual · ${run.startedAt}`)
    expect(timestamp).toHaveClass('min-w-0', 'break-words')
    expect(timestamp.className).not.toMatch(/\btruncate\b/)
    expect(timestamp).toHaveTextContent(run.startedAt)

    expect(within(article).getByText('Jobright authentication failed')).toBeInTheDocument()
    expect(within(article).getByText(
      'Jobright authentication failed. Validate credentials and retry the run.',
    )).toBeInTheDocument()

    const inspect = within(article).getByRole('button', {
      name: `View Captures from ${run.id}`,
    })
    expect(inspect).toHaveClass('max-w-full', 'min-w-0', 'whitespace-normal')
    inspect.focus()
    expect(inspect).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(viewCaptures).toHaveBeenCalledWith({
      connectorInstanceId: run.connectorInstanceId,
      connectorRunId: run.id,
    })
  })

  it('sanitizes authentication-expired run history and shows released credential retry guidance', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-auth-expired',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.11.0',
      displayName: 'Jobright public jobs',
      enabled: true,
      auth: [],
      config: {},
      filters: {},
    })
    const run = runFixture({
      id: 'connector-run-auth-expired',
      connectorInstanceId: 'jobright-auth-expired',
      status: 'failed',
      warningCount: 1,
      warnings: [{
        code: 'auth.required',
        label: 'sensitive raw warning label',
        message: 'sensitive session handle from run history',
        severity: 'blocked',
      }],
      newestFrontier: { state: 'not_started' },
      outcome: {
        kind: 'action_required',
        operation: {
          kind: 'authentication_expired',
          executionScopeId: 'scope_fixture_responsive',
          requestRefresh: true,
        },
      },
    })
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      items: [run],
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    })

    render(<ConnectorRunsPanel connectorsApi={connectorsApi} />)

    const article = await screen.findByRole('article')
    expect(within(article).getByText(
      'Update and validate Jobright credentials, then run again.',
    )).toBeInTheDocument()
    expect(screen.queryByText('sensitive raw warning label')).not.toBeInTheDocument()
    expect(screen.queryByText(/sensitive session handle/i)).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Connector synchronization state' }))
      .toHaveTextContent('Authentication required')
  })

  it('contains synchronization and lifecycle copy with overflow-safe wrapping', () => {
    render(
      <>
        <ConnectorRunSynchronizationDetails run={runFixture({
          pendingResolutionCount: 12,
          newestFrontier: { state: 'caught_up' },
          outcome: { kind: 'in_progress' },
        })} />
        <ConnectorRunLifecycleDetails run={runFixture({
          lifecycleCounts: {
            version: 'connector-run-lifecycle-counts/v1',
            source: 'frozen_terminal',
            scope: {
              kind: 'connector_run',
              connectorRunId: 'connector-run-responsive',
              executionScopeId: 'scope_fixture_responsive',
            },
            provider: {
              returnedRows: 5,
              validRecords: 4,
              invalidRecords: 1,
              sourceDuplicates: 0,
              capturedRecords: 4,
              occurrenceCount: 4,
              unclassifiedRows: 0,
              captureShortfall: 0,
              gaps: [],
              invariant: 'reconciled',
            },
            destination: {
              normalized: 2,
              resolvedEmployerOrAts: 1,
              resolvedThirdParty: 1,
              unresolved: 1,
              pending: 1,
              gateRejected: 0,
              unclassified: 0,
              invariant: 'reconciled',
            },
            opportunity: {
              opportunitiesCreated: 1,
              existingJobMatches: 0,
              notFit: 0,
              rejected: 0,
              actionableReview: 1,
              unclassified: 0,
              invariant: 'reconciled',
            },
          },
        })} />
      </>,
    )

    const status = screen.getByRole('status', { name: 'Connector synchronization state' })
    expect(status).toHaveClass('min-w-0')
    expect(status).toHaveTextContent('Resolving links')
    expect(status).toHaveTextContent(
      '12 captured jobs still need destination resolution.',
    )
    expect(within(status).getByText(/Newest frontier:/).closest('p')).toHaveClass('break-words')
    expect(status.className).not.toMatch(/\btruncate\b/)

    const syncSection = status.closest('section')
    expect(syncSection).toHaveClass('@container/connector-run-sync', 'min-w-0')
    const syncStages = status.querySelector('[data-slot="connector-run-sync-stages"]')
    expect(syncStages).not.toBeNull()
    expect(syncStages).toHaveClass(
      'min-w-0',
      '@md/connector-run-sync:grid-cols-3',
    )
    expect(syncStages).not.toHaveClass('sm:grid-cols-3')

    const lifecycle = screen.getByLabelText('Run lifecycle counts')
    expect(lifecycle.parentElement).toHaveClass(
      '@container/connector-run-lifecycle',
      'min-w-0',
    )
    expect(lifecycle).toHaveClass(
      'min-w-0',
      '@md/connector-run-lifecycle:grid-cols-3',
    )
    expect(lifecycle).not.toHaveClass('md:grid-cols-3')
    expect(within(lifecycle).getByRole('heading', { name: 'Provider intake' })).toBeInTheDocument()
    expect(within(lifecycle).getByText('Provider returned rows: 5')).toBeInTheDocument()

    const disclosure = screen.getByRole('button', { name: 'How synchronization works' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Each work opportunity checks the newest frontier first/)).toBeInTheDocument()
  })
})
