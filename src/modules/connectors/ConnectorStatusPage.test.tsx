import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorStatusPage } from './ConnectorStatusPage'
import type { ConnectorStatusView } from './connector.status'

afterEach(cleanup)

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
    expect(within(table).getByText(
      'Expired session: Expired browser [redacted].',
    )).toBeInTheDocument()
    expect(within(table).getByText(
      'Rate limited: Rate limited by Fixture Jobs for 10 minutes.',
    )).toBeInTheDocument()
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
    expect(screen.queryByLabelText('Empty connector status')).not.toBeInTheDocument()
  })

  it('renders Empty when connectors are available but none are enabled', () => {
    render(
      <ConnectorStatusPage
        contentColumnClass=""
        error={null}
        isLoading={false}
        result={{ available: true, items: [] }}
        onAction={vi.fn()}
      />,
    )

    const empty = screen.getByLabelText('Empty connector status')
    expect(empty).toHaveAttribute('data-slot', 'empty')
    expect(within(empty).getByRole('heading', { name: 'No enabled connectors' })).toBeInTheDocument()
    expect(
      within(empty).getByText('Enable a connector to monitor refresh health here.'),
    ).toBeInTheDocument()
    expect(screen.getByText('0 enabled')).toBeInTheDocument()
    expect(screen.queryByText('Connector status is unavailable for this runtime.')).not.toBeInTheDocument()
  })

  it('shows a localized next attempt for provider cooldown without failure copy', () => {
    const nextAttemptAt = '2026-07-12T12:02:00.000Z'
    render(
      <ConnectorStatusPage
        contentColumnClass=""
        error={null}
        isLoading={false}
        result={{
          available: true,
          items: [createConnectorStatusView({
            nextAttemptAt,
            severity: 'warning',
            status: 'cooling_down',
            statusLabel: 'Cooling down',
            summary: 'The provider asked this connector to pause requests.',
          })],
        }}
        onAction={vi.fn()}
      />,
    )

    expect(screen.getByText(`Next attempt ${new Date(nextAttemptAt).toLocaleString()}`)).toBeInTheDocument()
    expect(screen.queryByText(/failed|stuck/i)).not.toBeInTheDocument()
  })

  it('renders continuing later without treating a worker-lease yield as failure', () => {
    render(
      <ConnectorStatusPage
        contentColumnClass=""
        error={null}
        isLoading={false}
        result={{
          available: true,
          items: [createConnectorStatusView({
            severity: 'warning',
            status: 'skipped',
            statusLabel: 'Continuing later',
            summary:
              'Yielded work is safely checkpointed for the next admitted manual or scheduled work opportunity.',
          })],
        }}
        onAction={vi.fn()}
      />,
    )

    expect(screen.getByText('Continuing later')).toBeInTheDocument()
    expect(screen.getByText(
      'Yielded work is safely checkpointed for the next admitted manual or scheduled work opportunity.',
    )).toBeInTheDocument()
    expect(screen.queryByText(/failed|partial success|stuck/i)).not.toBeInTheDocument()
  })

  it('keeps the wide status table in a named keyboard-focusable scroll region with inspectable values', () => {
    const longSummary =
      'Reconnect the connector session to continue refreshes after the provider paused requests for an extended cooldown window.'
    const longDisplayName = 'Fixture Jobs Connector With A Very Long Display Name'
    const lastRunAt = '2026-07-08T17:00:01.000Z'
    const nextAttemptAt = '2026-07-12T12:02:00.000Z'
    const warningMessage = 'Expired browser session must be refreshed before the next synchronization attempt.'

    render(
      <ConnectorStatusPage
        contentColumnClass=""
        error={null}
        isLoading={false}
        result={{
          available: true,
          items: [
            createConnectorStatusView({
              displayName: longDisplayName,
              lastRunAt,
              nextAttemptAt,
              statusLabel: 'Auth required',
              summary: longSummary,
              actions: [
                { id: 'reconnect', label: 'Reconnect' },
                { id: 'skip', label: 'Skip this run' },
              ],
              warnings: [
                {
                  code: 'auth.expired_session',
                  label: 'Expired session',
                  message: warningMessage,
                  severity: 'blocked',
                },
              ],
            }),
          ],
        }}
        onAction={vi.fn()}
      />,
    )

    const statusSection = screen.getByRole('region', { name: 'Connector status' })
    expect(statusSection).toHaveClass('min-w-0')

    const scrollHint = screen.getByText(/scroll horizontally/i)
    expect(scrollHint).toBeVisible()
    expect(scrollHint).toHaveAttribute('id', 'connector-status-scroll-hint')

    const scrollRegion = screen.getByRole('region', { name: 'Connector status table' })
    expect(scrollRegion).toHaveAttribute('tabIndex', '0')
    expect(scrollRegion).toHaveAttribute('aria-describedby', 'connector-status-scroll-hint')
    expect(scrollRegion).toHaveClass('min-w-0', 'max-w-full', 'overflow-x-auto')
    expect(scrollRegion.compareDocumentPosition(scrollHint) & Node.DOCUMENT_POSITION_PRECEDING)
      .toBeTruthy()

    const table = within(scrollRegion).getByRole('table', { name: 'Connector status' })
    expect(table).toHaveClass('min-w-[1050px]')
    expect(table.parentElement).toBe(scrollRegion)

    expect(within(table).getByText(longDisplayName)).toBeInTheDocument()
    expect(within(table).getByText(longDisplayName).className).not.toMatch(/\btruncate\b/)
    expect(within(table).getByText('fixture.jobs').className).not.toMatch(/\btruncate\b/)

    const statusBadge = within(table).getByText('Auth required')
    expect(statusBadge.className).not.toMatch(/\btruncate\b/)
    expect(statusBadge).toHaveAccessibleName(/Auth required/i)

    expect(within(table).getByText(longSummary)).toBeInTheDocument()
    expect(within(table).getByText(longSummary).className).not.toMatch(/\btruncate\b/)
    expect(within(table).getByText(
      `Next attempt ${new Date(nextAttemptAt).toLocaleString()}`,
    )).toBeInTheDocument()

    const warning = within(table).getByText(`Expired session: ${warningMessage}`)
    expect(warning).toBeVisible()
    expect(warning.className).not.toMatch(/\btruncate\b/)

    const latestRun = within(table).getByText(lastRunAt)
    expect(latestRun.className).not.toMatch(/\btruncate\b/)

    const actions = within(table).getByRole('button', { name: `Reconnect ${longDisplayName}` })
      .closest('div')
    expect(actions).toHaveClass('flex-wrap', 'min-w-0')
    expect(within(table).getByRole('button', {
      name: `Skip this run for ${longDisplayName}`,
    })).toBeInTheDocument()
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
    nextAttemptAt: null,
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
