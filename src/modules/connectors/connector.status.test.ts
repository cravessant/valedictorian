import { describe, expect, it } from 'vitest'
import type { ConnectorStatusSummaryRecord, ConnectorWarning } from './connector.repository'
import { mapConnectorStatusSummary } from './connector.status'

describe('connector status mapping', () => {
  it('shows an advancing newest frontier as checking newest', () => {
    expect(mapConnectorStatusSummary(createStatusRecord({
      latestRun: createRunRecord({
        completedAt: null,
        status: 'running',
        synchronization: {
          newestFrontier: { state: 'advancing' },
          historicalBackfill: {
            state: 'not_started',
            boundary: { earliestDate: '2026-07-01' },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'in_progress' },
        },
      }),
    }))).toMatchObject({
      severity: 'warning',
      status: 'checking_newest',
      statusLabel: 'Checking newest',
      summary: 'Checking the provider for newly published jobs.',
    })
  })

  it('shows an advancing historical frontier as backfilling', () => {
    expect(mapConnectorStatusSummary(createStatusRecord({
      latestRun: createRunRecord({
        completedAt: null,
        status: 'running',
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'advancing',
            boundary: { earliestDate: '2026-07-01' },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'in_progress' },
        },
      }),
    }))).toMatchObject({
      severity: 'warning',
      status: 'backfilling',
      statusLabel: 'Backfilling',
      summary: 'Checking older provider history back to July 1, 2026.',
    })
  })

  it('shows persisted destination work as resolving', () => {
    expect(mapConnectorStatusSummary(createStatusRecord({
      latestRun: createRunRecord({
        completedAt: null,
        status: 'running',
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'caught_up',
            boundary: { earliestDate: '2026-07-01' },
          },
          pendingResolutionCount: 7,
          outcome: { kind: 'in_progress' },
        },
      }),
    }))).toMatchObject({
      severity: 'warning',
      status: 'resolving',
      statusLabel: 'Resolving links',
      summary: 'Resolving destinations for 7 captured jobs.',
    })
  })

  it('shows provider cooldown with its next permitted attempt', () => {
    expect(mapConnectorStatusSummary(createStatusRecord({
      latestRun: createRunRecord({
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'advancing',
            boundary: { earliestDate: '2026-07-01' },
          },
          pendingResolutionCount: 3,
          outcome: {
            kind: 'cooling_down',
            operation: {
              kind: 'scope_rate_limited',
              executionScopeId: 'scope_fixture_connector_status',
              retryAt: '2026-07-12T12:02:00.000Z',
              serverMinimumDelayMs: 120_000,
            },
          },
        },
      }),
    }))).toMatchObject({
      nextAttemptAt: '2026-07-12T12:02:00.000Z',
      severity: 'warning',
      status: 'cooling_down',
      statusLabel: 'Cooling down',
      summary: 'The provider asked this connector to pause requests.',
    })
  })

  it('labels an explicit worker-lease yield as continuing later', () => {
    expect(mapConnectorStatusSummary(createStatusRecord({
      latestRun: createRunRecord({
        status: 'skipped',
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'advancing',
            boundary: { earliestDate: '2026-07-01' },
          },
          pendingResolutionCount: 4,
          outcome: { kind: 'yielded', reason: 'invocation_budget' },
        },
      }),
    }))).toMatchObject({
      severity: 'warning',
      status: 'skipped',
      statusLabel: 'Continuing later',
      summary:
        'Yielded work is safely checkpointed for the next admitted manual or scheduled work opportunity.',
    })
  })

  it('shows source-scoped authentication action without relying on warning text', () => {
    expect(mapConnectorStatusSummary(createStatusRecord({
      latestRun: createRunRecord({
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'advancing',
            boundary: { earliestDate: '2026-07-01' },
          },
          pendingResolutionCount: 3,
          outcome: {
            kind: 'action_required',
            operation: {
              kind: 'authentication_expired',
              executionScopeId: 'scope_fixture_connector_status',
              requestRefresh: true,
            },
          },
        },
      }),
    }))).toMatchObject({
      actionLabel: 'Reconnect',
      severity: 'blocked',
      status: 'auth_required',
      statusLabel: 'Authentication required',
      summary: 'Refresh connector credentials to continue synchronization.',
    })
  })

  it('does not expose internal retry attempts for a yielded run', () => {
    const status = mapConnectorStatusSummary(createStatusRecord({
      latestRun: createRunRecord({
        status: 'skipped',
        retryHints: {
          state: 'not_due', reason: 'operation_timeout', attempt: 2, maxAttempts: 3,
          lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
          nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
        },
      }),
    }))
    expect(status).toMatchObject({
      severity: 'warning', status: 'skipped', statusLabel: 'Continuing later',
    })
    expect(JSON.stringify(status)).not.toMatch(/retryAdvice|maxAttempts|attempt/)
  })

  it('classifies auth blockers without forwarding sensitive warning details', () => {
    const view = mapConnectorStatusSummary(
      createStatusRecord({
        latestRun: createRunRecord({
          observationCount: 0,
          retryHints: null,
          status: 'failed',
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
      statusLabel: 'Authentication required',
      summary: 'Refresh connector credentials to continue synchronization.',
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
            retryHints: null,
            status: 'completed',
            warnings: [{ code: 'auth.required', message: 'secret missing' }],
          }),
        }),
      ),
    ).toMatchObject({
      actionLabel: 'Reconnect',
      severity: 'blocked',
      status: 'auth_required',
      statusLabel: 'Authentication required',
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
            retryHints: null,
            status: 'completed',
            warnings: [{ code: 'jobright_auth_required', message: 'auth required' }],
          }),
        }),
      ),
    ).toMatchObject({
      actionLabel: 'Reconnect',
      severity: 'blocked',
      status: 'auth_required',
      statusLabel: 'Authentication required',
    })
  })

  it('maps released Jobright failures to actionable sanitized guidance', () => {
    const view = mapConnectorStatusSummary(
      createStatusRecord({
        connectorId: 'jobright.resolver',
        displayName: 'Jobright internslist',
        latestRun: createRunRecord({
          observationCount: 1,
          status: 'failed',
          warningCount: 4,
          warnings: [
            {
              code: 'jobright_auth_failed',
              message: 'Raw auth failure contained sensitive fixture material.',
            },
            {
              code: 'jobright_discovery_failed',
              message: 'Raw discovery failure contained sensitive fixture material.',
            },
            {
              code: 'jobright_parser_changed',
              message: 'Raw parser response contained sensitive fixture material.',
            },
            {
              code: 'jobright_zero_useful_results',
              message: 'Raw URL failure contained sensitive fixture material.',
            },
          ],
        }),
      }),
    )

    expect(view).toMatchObject({
      status: 'auth_required',
      warnings: [
        {
          code: 'jobright_auth_failed',
          label: 'Jobright auth failed',
          message: 'Jobright authentication failed. Validate credentials and retry this run.',
          severity: 'blocked',
        },
        {
          code: 'jobright_discovery_failed',
          label: 'Jobright discovery failed',
          message: 'Jobright discovery failed. Review API availability and retry this run.',
          severity: 'warning',
        },
        {
          code: 'jobright_parser_changed',
          label: 'Jobright API changed',
          message: 'Update the Jobright API parser before retrying this run.',
          severity: 'warning',
        },
        {
          code: 'jobright_zero_useful_results',
          label: 'No usable Jobright URLs',
          message: 'Review unresolved Jobright results before retrying this run.',
          severity: 'warning',
        },
      ],
    })
    expect(JSON.stringify(view)).not.toContain('sensitive fixture material')
  })

  it('maps explicit Jobright discovery outcomes to app-owned sanitized guidance', () => {
    const view = mapConnectorStatusSummary(
      createStatusRecord({
        connectorId: 'jobright.resolver',
        displayName: 'Jobright internslist',
        latestRun: createRunRecord({
          observationCount: 1,
          status: 'failed',
          warningCount: 4,
          warnings: [
            {
              code: 'jobright_discovery_forbidden',
              label: 'raw upstream discovery forbidden label',
              message: 'HTTP 403 body with cookie=secret and Authorization: Bearer tok',
            },
            {
              code: 'jobright_discovery_http_client_error',
              label: 'raw upstream client error label',
              message: 'HTTP 400 https://jobright.ai/api with session=abc',
            },
            {
              code: 'jobright_discovery_http_non_success',
              label: 'raw upstream non-success label',
              message: 'HTTP 502 response body leaked privately',
            },
            {
              code: 'jobright_discovery_non_success',
              label: 'raw upstream provider envelope label',
              message: 'providerCode=PRIVATE_CODE message=do-not-show',
            },
          ],
        }),
      }),
    )

    expect(view).toMatchObject({
      warnings: [
        {
          code: 'jobright_discovery_forbidden',
          label: 'Jobright discovery forbidden',
          message:
            'Jobright denied discovery access. Review provider access policy, then retry this run.',
          severity: 'warning',
        },
        {
          code: 'jobright_discovery_http_client_error',
          label: 'Jobright discovery request error',
          message:
            'Jobright rejected the discovery request. Check the request contract, then retry this run.',
          severity: 'warning',
        },
        {
          code: 'jobright_discovery_http_non_success',
          label: 'Jobright discovery non-success',
          message:
            'Jobright discovery returned a non-success response. Check provider availability and the request contract, then retry this run.',
          severity: 'warning',
        },
        {
          code: 'jobright_discovery_non_success',
          label: 'Jobright discovery rejected',
          message:
            'Jobright discovery returned a provider non-success result. Check provider availability and access policy, then retry this run.',
          severity: 'warning',
        },
      ],
    })
    expect(JSON.stringify(view)).not.toMatch(
      /raw upstream|cookie=secret|Bearer tok|https:\/\/jobright\.ai|session=abc|PRIVATE_CODE|do-not-show|response body leaked/i,
    )
  })

  it('shows caught-up synchronization independently of per-run intake', () => {
    expect(
      mapConnectorStatusSummary(
        createStatusRecord({
          latestRun: createRunRecord({
            observationCount: 0,
            status: 'completed',
            synchronization: {
              newestFrontier: { state: 'caught_up' },
              historicalBackfill: {
                state: 'caught_up',
                boundary: { earliestDate: '2026-07-01' },
              },
              pendingResolutionCount: 0,
              outcome: { kind: 'caught_up' },
            },
          }),
        }),
      ),
    ).toMatchObject({
      severity: 'healthy',
      status: 'caught_up',
      statusLabel: 'Caught up',
      summary: 'Newest jobs, historical backfill, and pending link resolution are caught up.',
    })
  })

  it('shows the configured historical boundary as exhausted', () => {
    expect(mapConnectorStatusSummary(createStatusRecord({
      latestRun: createRunRecord({
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'boundary_reached',
            boundary: { earliestDate: '2026-07-01' },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'boundary_exhausted' },
        },
      }),
    }))).toMatchObject({
      severity: 'healthy',
      status: 'boundary_exhausted',
      statusLabel: 'Boundary reached',
      summary: 'Historical backfill reached the configured July 1, 2026 boundary.',
    })
  })

  it('shows provider history exhaustion separately from the configured boundary', () => {
    expect(mapConnectorStatusSummary(createStatusRecord({
      latestRun: createRunRecord({
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'source_exhausted',
            boundary: { earliestDate: '2026-07-01' },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'source_exhausted' },
        },
      }),
    }))).toMatchObject({
      severity: 'healthy',
      status: 'source_exhausted',
      statusLabel: 'Provider history exhausted',
      summary: 'The provider has no older history available before this point.',
    })
  })

  it('surfaces sanitized warnings from an explicitly yielded run', () => {
    expect(
      mapConnectorStatusSummary(
        createStatusRecord({
          latestRun: createRunRecord({
            observationCount: 4,
            status: 'completed',
            warningCount: 1,
            warnings: [{ code: 'source.timeout', message: 'Source operation timed out.' }],
          }),
        }),
      ),
    ).toMatchObject({
      severity: 'warning', status: 'skipped', statusLabel: 'Continuing later',
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
    earliestBackfillDate: '2026-07-01',
    enabled: true,
    executionScopeId: 'scope_fixture_connector_status',
    filters: {},
    id: 'connector-instance-fixture',
    latestRun: null,
    updatedAt: '2026-07-08T15:00:00.000Z',
    ...overrides,
  }
}

type ConnectorRunRecordOverrides
  = Partial<Omit<NonNullable<ConnectorStatusSummaryRecord['latestRun']>, 'warnings'>>
    // Persisted warnings are raw provider evidence: sanitization is what these tests prove.
    & { warnings?: ReadonlyArray<ConnectorWarning & Record<string, unknown>> }

function createRunRecord(
  overrides: ConnectorRunRecordOverrides = {},
): NonNullable<ConnectorStatusSummaryRecord['latestRun']> {
  const status = overrides.status ?? 'completed'
  const warnings = overrides.warnings ?? []
  const hasAuthWarning = warnings.some((warning) => /auth/.test(warning.code))
  const outcome = hasAuthWarning
    ? {
        kind: 'action_required' as const,
        operation: {
          kind: 'authentication_expired' as const,
          executionScopeId: 'scope_fixture_connector_status',
          requestRefresh: true as const,
        },
      }
    : status === 'failed'
      ? { kind: 'failed' as const, reason: 'fixture_failed' }
      : status === 'cancelled'
        ? { kind: 'cancelled' as const, reason: 'fixture_cancelled' }
        : status === 'skipped' || warnings.length > 0
          ? { kind: 'yielded' as const, reason: 'operation_timeout' as const }
          : { kind: 'caught_up' as const }
  return {
    completedAt: '2026-07-08T17:00:01.000Z',
    config: {},
    connectorInstanceId: 'connector-instance-fixture',
    executionScopeId: 'scope_fixture_connector_status',
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
    synchronization: {
      newestFrontier: { state: 'caught_up' },
      historicalBackfill: {
        state: outcome.kind === 'caught_up' ? 'caught_up' : 'advancing',
        boundary: { earliestDate: '2026-07-01' },
      },
      pendingResolutionCount: 0,
      outcome,
    },
    ...overrides,
  }
}
