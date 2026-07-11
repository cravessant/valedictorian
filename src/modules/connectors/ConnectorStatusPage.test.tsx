import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConnectorStatusPage } from './ConnectorStatusPage'
import type { ConnectorStatusView } from './connector.status'

describe('ConnectorStatusPage', () => {
  it('renders connector run status, auth blockers, and action affordances without sensitive text', () => {
    const onAction = vi.fn()

    render(
      <ConnectorStatusPage
        contentColumnClass=""
        error={null}
        isLoading={false}
        result={{
          available: true,
          items: [
            createConnectorStatusView({
              actionLabel: 'Reconnect',
              actions: [
                {
                  id: 'reconnect',
                  label: 'Reconnect',
                },
                {
                  id: 'skip',
                  label: 'Skip this run',
                },
              ],
              severity: 'blocked',
              status: 'auth_required',
              statusLabel: 'Auth required',
              summary: 'Reconnect the connector session to continue refreshes.',
              warningCount: 2,
              warnings: [
                {
                  code: 'auth.expired_session',
                  label: 'Expired session',
                  message: 'Expired browser [redacted].',
                  severity: 'blocked',
                },
                {
                  code: 'source.rate_limited',
                  label: 'Rate limited',
                  message: 'Rate limited by Fixture Jobs for 10 minutes.',
                  severity: 'warning',
                },
              ],
            }),
          ],
        }}
        onAction={onAction}
      />,
    )

    const table = screen.getByRole('table', { name: 'Connector status' })

    expect(screen.getByRole('heading', { name: 'Connectors' })).toBeInTheDocument()
    expect(within(table).getByText('Fixture Jobs')).toBeInTheDocument()
    expect(within(table).getByText('Auth required')).toBeInTheDocument()
    expect(within(table).getByText('Reconnect the connector session to continue refreshes.')).toBeInTheDocument()
    expect(within(table).getByText('Expired session')).toBeInTheDocument()
    expect(within(table).getByText('Rate limited')).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Reconnect Fixture Jobs' })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Skip this run for Fixture Jobs' })).toBeInTheDocument()
    expect(screen.queryByText(/fixture-session-123/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/fixture-secret-token/i)).not.toBeInTheDocument()
  })

  it('distinguishes unavailable connector status from no enabled connectors', () => {
    render(
      <ConnectorStatusPage
        contentColumnClass=""
        error={null}
        isLoading={false}
        result={{ available: false, items: [] }}
        onAction={vi.fn()}
      />,
    )

    expect(screen.getByText('Connector status is unavailable for this runtime.')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('0 enabled')).not.toBeInTheDocument()
    expect(screen.queryByText('No enabled connectors.')).not.toBeInTheDocument()
  })

  it('shows full typed retry guidance for a skipped not-due run', () => {
    const nextAttemptAt = '2026-07-11T12:01:00.000Z'
    render(
      <ConnectorStatusPage
        contentColumnClass=""
        error={null}
        isLoading={false}
        result={{
          available: true,
          items: [createConnectorStatusView({
            retryAdvice: {
              state: 'not_due', reason: 'rate_limit', attempt: 2, maxAttempts: 4,
              lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
              nextAttemptAt, horizonAt: '2026-07-11T13:00:00.000Z',
            },
            severity: 'warning', status: 'skipped', statusLabel: 'Skipped / not due',
            summary: 'Latest run was skipped because retry work is not due yet.',
          })],
        }}
        onAction={vi.fn()}
      />,
    )

    expect(screen.getByText(
      `Skipped — not due · Rate limited · Attempt 2 of 4 · Next attempt ${new Date(nextAttemptAt).toLocaleString()}`,
    )).toBeInTheDocument()
  })
})

function createConnectorStatusView(
  overrides: Partial<ConnectorStatusView> = {},
): ConnectorStatusView {
  return {
    actionLabel: null,
    actions: [],
    connectorId: 'fixture.jobs',
    displayName: 'Fixture Jobs',
    enabled: true,
    id: 'connector-instance-fixture',
    lastRunAt: '2026-07-08T17:00:01.000Z',
    latestRunId: 'connector-run-1',
    observationCount: 0,
    retryAdvice: null,
    severity: 'healthy',
    status: 'healthy',
    statusLabel: 'Healthy',
    summary: 'Latest run completed successfully.',
    warningCount: 0,
    warnings: [],
    ...overrides,
  }
}
