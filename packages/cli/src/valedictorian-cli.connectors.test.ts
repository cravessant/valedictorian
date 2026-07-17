import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, runCli } from './valedictorian-cli.test-helpers'

describe('continuous connector synchronization', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('configures provider filters, enabled state, and the inclusive backfill boundary', async () => {
    const payload = connectorInstance()
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors',
      'configure',
      payload.id,
      '--workspace',
      'workspace-1',
      '--enabled',
      'false',
      '--earliest-backfill-date',
      '2026-04-01',
      '--filters-json',
      '{"search":"software internship","remote":true}',
      '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      `https://valedictorian.test/v1/workspaces/workspace-1/connectors/${payload.id}`,
      expect.objectContaining({ method: 'PATCH' }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      earliestBackfillDate: '2026-04-01',
      enabled: false,
      filters: { remote: true, search: 'software internship' },
    })
  })

  it('triggers one bounded opportunity to advance continuous synchronization', async () => {
    const payload = connectorRun({
      completedAt: null,
      newestFrontier: { state: 'not_started' },
      outcome: { kind: 'in_progress' },
      status: 'queued',
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors',
      'trigger',
      payload.connectorInstanceId,
      '--workspace',
      'workspace-1',
      '--filter-signature',
      'internships',
      '--filters-json',
      '{"search":"software internship"}',
      '--reason',
      'advance synchronization',
      '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      filterSignature: 'internships',
      filters: { search: 'software internship' },
      reason: 'advance synchronization',
    })
  })

  it('describes newest-frontier checking in human-readable status output', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(connectorStatus('checking_newest')))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors',
      'status',
      'connector-instance-jobright',
      '--workspace',
      'workspace-1',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Checking newest jobs')
  })

  it('shows sanitized provider cooldown timing in human-readable trigger output', async () => {
    const retryAt = '2026-07-13T12:05:00.000Z'
    const payload = connectorRun({
      outcome: {
        kind: 'cooling_down',
        operation: {
          kind: 'scope_rate_limited',
          executionScopeId: 'source-scope-jobright',
          retryAt,
          serverMinimumDelayMs: 30_000,
        },
      },
      status: 'skipped',
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors',
      'trigger',
      payload.connectorInstanceId,
      '--workspace',
      'workspace-1',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Provider cooling down')
    expect(result.stdout).toContain(`Next attempt: ${retryAt}`)
    expect(result.stdout).not.toMatch(/credential|cookie|password|session|token/i)
  })

  it('describes historical backfill progress in human-readable run output', async () => {
    const payload = connectorRun({
      completedAt: null,
      historicalBackfill: {
        state: 'advancing',
        boundary: { earliestDate: '2026-04-01' },
      },
      newestFrontier: { state: 'caught_up' },
      outcome: { kind: 'in_progress' },
      status: 'running',
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse({ items: [payload], total: 1, limit: 25, offset: 0, hasMore: false }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors', 'runs', 'list', payload.connectorInstanceId,
      '--workspace', 'workspace-1',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Backfilling historical jobs')
  })

  it('describes pending link resolution in human-readable run output', async () => {
    const payload = connectorRun({
      completedAt: null,
      newestFrontier: { state: 'caught_up' },
      historicalBackfill: {
        state: 'caught_up',
        boundary: { earliestDate: '2026-04-01' },
      },
      outcome: { kind: 'in_progress' },
      pendingResolutionCount: 3,
      status: 'running',
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse({ items: [payload], total: 1, limit: 25, offset: 0, hasMore: false }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors', 'runs', 'list', payload.connectorInstanceId,
      '--workspace', 'workspace-1',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Resolving pending links')
  })

  it('describes newest-frontier progress in human-readable trigger output', async () => {
    const payload = connectorRun({
      completedAt: null,
      outcome: { kind: 'in_progress' },
      status: 'running',
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors', 'trigger', payload.connectorInstanceId,
      '--workspace', 'workspace-1',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Checking newest jobs')
  })

  it('describes authentication action in human-readable run output', async () => {
    const payload = connectorRun({
      outcome: {
        kind: 'action_required',
        operation: {
          kind: 'authentication_expired',
          executionScopeId: 'source-scope-jobright',
          requestRefresh: true,
        },
      },
      status: 'skipped',
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse({ items: [payload], total: 1, limit: 25, offset: 0, hasMore: false }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors', 'runs', 'list', payload.connectorInstanceId,
      '--workspace', 'workspace-1',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Authentication required')
  })

  it('describes genuine caught-up state in human-readable run output', async () => {
    const payload = connectorRun({
      historicalBackfill: {
        state: 'caught_up',
        boundary: { earliestDate: '2026-04-01' },
      },
      newestFrontier: { state: 'caught_up' },
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse({ items: [payload], total: 1, limit: 25, offset: 0, hasMore: false }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors', 'runs', 'list', payload.connectorInstanceId,
      '--workspace', 'workspace-1',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Caught up')
  })

  it('describes an exhausted backfill boundary in human-readable run output', async () => {
    const payload = connectorRun({
      historicalBackfill: {
        state: 'boundary_reached',
        boundary: { earliestDate: '2026-04-01' },
      },
      newestFrontier: { state: 'caught_up' },
      outcome: { kind: 'boundary_exhausted' },
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse({ items: [payload], total: 1, limit: 25, offset: 0, hasMore: false }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors', 'runs', 'list', payload.connectorInstanceId,
      '--workspace', 'workspace-1',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Boundary exhausted')
  })

  it('describes bounded execution yield and its reason in human-readable output', async () => {
    const payload = connectorRun({
      outcome: { kind: 'yielded', reason: 'invocation_budget' },
      status: 'skipped',
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors', 'trigger', payload.connectorInstanceId,
      '--workspace', 'workspace-1',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Execution yielded')
    expect(result.stdout).toContain('Yield reason: invocation_budget')
  })

  it('configures the released connector schedule policy', async () => {
    const payload = connectorSchedule()
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors', 'schedules', 'upsert', payload.connectorInstanceId,
      '--workspace', 'workspace-1',
      '--expected-revision', 'null',
      '--state', 'enabled',
      '--cadence-json', '{"kind":"daily","localTime":"09:00"}',
      '--timezone', 'America/New_York',
      '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'daily', localTime: '09:00' },
      timezone: 'America/New_York',
    })
  })

  it('reads the released connector schedule policy', async () => {
    const payload = connectorSchedule()
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors', 'schedules', 'get', payload.connectorInstanceId,
      '--workspace', 'workspace-1', '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      `https://valedictorian.test/v1/workspaces/workspace-1/connectors/${payload.connectorInstanceId}/schedule`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('omits obsolete target and fixed-batch controls from trigger help and parsing', async () => {
    const help = await runCli(['connectors', 'trigger', '--help'])
    const obsolete = await runCli([
      'connectors', 'trigger', 'connector-instance-jobright',
      '--workspace', 'workspace-1',
      '--coverage-started-at', '2026-07-01T00:00:00.000Z',
    ])

    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain('Advance continuous connector synchronization')
    expect(help.stdout).not.toMatch(
      /coverage-(started|ended)-at|useful.?target|requested.?job|max.?links|remaining.?target/i,
    )
    expect(obsolete.exitCode).toBe(1)
    expect(obsolete.stderr).toContain('No flag registered for --coverage-started-at')
  })
})

function connectorInstance() {
  return {
    id: 'connector-instance-jobright',
    connectorId: 'jobright',
    connectorVersion: '0.11.0',
    displayName: 'Jobright',
    enabled: false,
    lifecycle: 'disabled',
    auth: [{ id: 'jobright', mode: 'username_password', label: 'Jobright', configured: true }],
    config: {},
    filters: { remote: true, search: 'software internship' },
    earliestBackfillDate: '2026-04-01',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-13T12:00:00.000Z',
  }
}

function connectorRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    connectorInstanceId: 'connector-instance-jobright',
    executionScopeId: 'source-scope-jobright',
    mode: 'manual',
    scheduleOccurrence: null,
    status: 'completed',
    filterSignature: 'internships',
    observationCount: 0,
    warningCount: 0,
    warnings: [],
    newestFrontier: { state: 'advancing' },
    historicalBackfill: {
      state: 'not_started',
      boundary: { earliestDate: '2026-04-01' },
    },
    pendingResolutionCount: 0,
    outcome: { kind: 'caught_up' },
    startedAt: '2026-07-13T12:00:00.000Z',
    completedAt: '2026-07-13T12:01:00.000Z',
    ...overrides,
  }
}

function connectorStatus(status: string) {
  return {
    id: 'connector-instance-jobright',
    connectorId: 'jobright',
    connectorVersion: '0.11.0',
    displayName: 'Jobright',
    enabled: true,
    auth: [{ id: 'jobright', mode: 'username_password', label: 'Jobright', configured: true }],
    actionRequired: [],
    actions: [],
    lastRunAt: '2026-07-13T12:00:00.000Z',
    latestRunId: 'run-1',
    observationCount: 10,
    severity: 'warning',
    status,
    statusLabel: 'Checking newest jobs',
    summary: 'Advancing the newest provider frontier.',
    warningCount: 0,
    warnings: [],
  }
}

function connectorSchedule() {
  return {
    id: 'schedule-1',
    connectorInstanceId: 'connector-instance-jobright',
    revision: 'revision-1',
    state: 'enabled',
    cadence: { kind: 'daily', localTime: '09:00' },
    timezone: 'America/New_York',
    nextEligibleAt: '2026-07-14T13:00:00.000Z',
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: '2026-07-13T12:00:00.000Z',
    lastOccurrence: null,
    lastRun: null,
  }
}
