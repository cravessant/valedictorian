import { describe, expect, it } from 'vitest'
import type { ConnectorStatusSummaryRecord } from './connector.repository'
import { mapConnectorStatusSummary } from './connector.status'

describe('connector status mapping', () => {
  it('classifies auth blockers without forwarding sensitive warning details', () => {
    const view = mapConnectorStatusSummary(
      createStatusRecord({
        latestRun: createRunRecord({
          observationCount: 0,
          retryHints: {
            reason: 'browser_session_action_required',
            sessionId: 'fixture-session-123',
          },
          status: 'partial_success',
          warningCount: 4,
          warnings: [
            {
              code: 'auth.expired_session',
              message: 'Fixture session fixture-session-123 expired with fixture-secret-token.',
            },
            {
              code: 'source.rate_limited',
              message: 'Rate limited by Fixture Jobs for 10 minutes.',
            },
            {
              code: 'parser.changed',
              message: 'Fixture Jobs parser changed around pay metadata.',
            },
            {
              code: 'connector.sk_live_abc123',
              message: 'Bearer token sk_live_abc123 expired for cookie cookie-value-123.',
            },
          ],
        }),
      }),
    )

    expect(view).toMatchObject({
      actionLabel: 'Reconnect',
      severity: 'blocked',
      status: 'auth_required',
      statusLabel: 'Auth required',
      summary: 'Reconnect the connector session to continue refreshes.',
      warnings: [
        {
          code: 'auth.expired_session',
          label: 'Expired session',
          message: 'Connector auth expired.',
          severity: 'blocked',
        },
        {
          code: 'source.rate_limited',
          label: 'Rate limited',
          message: 'Connector source rate-limited the latest run.',
          severity: 'warning',
        },
        {
          code: 'parser.changed',
          label: 'Parser changed',
          message: 'Connector parser may need review.',
          severity: 'warning',
        },
        {
          code: 'connector.warning',
          label: 'Connector warning',
          message: 'Connector reported a warning.',
          severity: 'warning',
        },
      ],
    })
    expect(view.actions).toEqual([
      {
        id: 'reconnect',
        label: 'Reconnect',
      },
      {
        id: 'skip',
        label: 'Skip this run',
      },
    ])
    expect(JSON.stringify(view)).not.toContain('fixture-session-123')
    expect(JSON.stringify(view)).not.toContain('fixture-secret-token')
    expect(JSON.stringify(view)).not.toContain('sk_live_abc123')
    expect(JSON.stringify(view)).not.toContain('cookie-value-123')
    expect(JSON.stringify(view)).not.toContain('connector.sk_live_abc123')
  })

  it('treats missing connector secrets as auth-required blockers', () => {
    expect(
      mapConnectorStatusSummary(
        createStatusRecord({
          latestRun: createRunRecord({
            observationCount: 0,
            retryHints: {
              reason: 'secret_missing',
              secretKey: 'fixture-token-key',
            },
            status: 'partial_success',
          }),
        }),
      ),
    ).toMatchObject({
      actionLabel: 'Reconnect',
      severity: 'blocked',
      status: 'auth_required',
      statusLabel: 'Auth required',
    })
  })

  it('treats Jobright auth-required retry hints as auth-required blockers', () => {
    expect(
      mapConnectorStatusSummary(
        createStatusRecord({
          connectorId: 'jobright.resolver',
          displayName: 'Jobright public jobs',
          latestRun: createRunRecord({
            observationCount: 3,
            retryHints: {
              authRequired: 2,
              source: 'jobright',
            },
            status: 'completed',
          }),
        }),
      ),
    ).toMatchObject({
      actionLabel: 'Reconnect',
      severity: 'blocked',
      status: 'auth_required',
      statusLabel: 'Auth required',
    })
  })

  it('surfaces no-job and partial-success states from latest run data', () => {
    expect(
      mapConnectorStatusSummary(
        createStatusRecord({
          latestRun: createRunRecord({
            observationCount: 0,
            status: 'completed',
          }),
        }),
      ),
    ).toMatchObject({
      severity: 'healthy',
      status: 'no_jobs',
      statusLabel: 'No jobs',
      summary: 'Latest run completed with no matching jobs.',
    })

    expect(
      mapConnectorStatusSummary(
        createStatusRecord({
          latestRun: createRunRecord({
            observationCount: 4,
            status: 'partial_success',
          }),
        }),
      ),
    ).toMatchObject({
      severity: 'warning',
      status: 'partial_success',
      statusLabel: 'Partial success',
      summary: 'Latest run completed with warnings.',
    })
  })

  it('maps interrupted-run warnings without exposing raw failure details', () => {
    const view = mapConnectorStatusSummary(
      createStatusRecord({
        latestRun: createRunRecord({
          status: 'cancelled',
          warningCount: 1,
          warnings: [
            {
              code: 'connector.interrupted',
              message: 'Interrupted with sensitive-session-handle.',
            },
          ],
        }),
      }),
    )

    expect(view).toMatchObject({
      status: 'cancelled',
      warnings: [
        {
          code: 'connector.interrupted',
          label: 'Run interrupted',
          message: 'The app closed before this connector run finished.',
          severity: 'warning',
        },
      ],
    })
    expect(JSON.stringify(view)).not.toContain('sensitive-session-handle')
  })
})

function createStatusRecord(
  overrides: Partial<ConnectorStatusSummaryRecord> = {},
): ConnectorStatusSummaryRecord {
  return {
    auth: [],
    config: {},
    connectorId: 'fixture.jobs',
    connectorVersion: '0.1.0',
    createdAt: '2026-07-08T15:00:00.000Z',
    displayName: 'Fixture Jobs',
    enabled: true,
    filters: {},
    id: 'connector-instance-fixture',
    latestRun: null,
    updatedAt: '2026-07-08T15:00:00.000Z',
    ...overrides,
  }
}

function createRunRecord(
  overrides: Partial<NonNullable<ConnectorStatusSummaryRecord['latestRun']>> = {},
): NonNullable<ConnectorStatusSummaryRecord['latestRun']> {
  return {
    completedAt: '2026-07-08T17:00:01.000Z',
    config: {},
    connectorInstanceId: 'connector-instance-fixture',
    coverageEndedAt: '2026-07-08T17:00:00.000Z',
    coverageStartedAt: '2026-07-08T16:00:00.000Z',
    filterSignature: 'filters:{}',
    filters: {},
    id: 'connector-run-1',
    mode: 'catch_up',
    observationCount: 1,
    retryHints: null,
    startedAt: '2026-07-08T17:00:00.000Z',
    status: 'completed',
    stats: {
      observations: 1,
    },
    warningCount: 0,
    warnings: [],
    ...overrides,
  }
}
