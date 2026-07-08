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
                  message: 'Rate limited by Jobright for 10 minutes.',
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
    expect(within(table).getByText('InternList')).toBeInTheDocument()
    expect(within(table).getByText('Auth required')).toBeInTheDocument()
    expect(within(table).getByText('Reconnect the connector session to continue refreshes.')).toBeInTheDocument()
    expect(within(table).getByText('Expired session')).toBeInTheDocument()
    expect(within(table).getByText('Rate limited')).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Reconnect InternList' })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Skip this run for InternList' })).toBeInTheDocument()
    expect(screen.queryByText(/jobright-session-123/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/il-secret-token/i)).not.toBeInTheDocument()
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
})

function createConnectorStatusView(
  overrides: Partial<ConnectorStatusView> = {},
): ConnectorStatusView {
  return {
    actionLabel: null,
    actions: [],
    connectorId: 'internlist.jobs',
    displayName: 'InternList',
    enabled: true,
    id: 'connector-instance-internlist',
    lastRunAt: '2026-07-08T17:00:01.000Z',
    latestRunId: 'connector-run-1',
    observationCount: 0,
    severity: 'healthy',
    status: 'healthy',
    statusLabel: 'Healthy',
    summary: 'Latest run completed successfully.',
    warningCount: 0,
    warnings: [],
    ...overrides,
  }
}
