import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { actionQueueListResult, jsonResponse, runCli } from './valedictorian-cli.test-helpers'

const capture = {
  id: 'capture-1', workspaceId: 'workspace-1', revision: 1, evidenceMode: 'reported',
  adapter: { id: 'cli-1', kind: 'cli', version: '1.0.0' },
  observedAt: '2026-07-21T18:00:00.000Z', receivedAt: '2026-07-21T18:00:01.000Z',
  providerRecordId: null, providerSchema: null, payload: null, evidence: [],
  createdAt: '2026-07-21T18:00:01.000Z', updatedAt: '2026-07-21T18:00:01.000Z', removedAt: null,
}

function capturePage(pageInfo: Record<string, unknown>) {
  return { items: [capture], pageInfo }
}

const terminalCapturePage = {
  items: [],
  pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false },
}

describe('valedictorian-cli resource commands', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('routes a forward lifecycle page with token auth and strict query input', async () => {
    const payload = capturePage({
      startCursor: 'capture-page-2-start', endCursor: 'capture-page-2-end',
      hasPreviousPage: true, hasNextPage: true,
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'captures', 'list', '--workspace', 'workspace-1', '--input-json',
      '{"evidenceMode":"reported","adapterId":"cli-1","includeRemoved":true,"limit":25,"after":"capture-page-1-end"}',
      '--json',
    ], { VALEDICTORIAN_API_TOKEN: 'token-1' })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/captures?evidenceMode=reported&adapterId=cli-1&includeRemoved=true&limit=25&after=capture-page-1-end',
      {
        headers: { accept: 'application/json', authorization: 'Bearer token-1' },
        method: 'GET',
      },
    )
  })

  it('routes a backward lifecycle page and rejects both boundaries at once', async () => {
    const payload = capturePage({
      startCursor: 'capture-page-1-start', endCursor: 'capture-page-1-end',
      hasPreviousPage: false, hasNextPage: true,
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const backward = await runCli([
      'captures', 'list', '--workspace', 'workspace-1',
      '--input-json', '{"limit":25,"before":"capture-page-2-start"}', '--json',
    ])
    const both = await runCli([
      'captures', 'list', '--workspace', 'workspace-1',
      '--input-json', '{"after":"capture-page-1-end","before":"capture-page-2-start"}', '--json',
    ])

    expect(backward.exitCode).toBe(0)
    expect(JSON.parse(backward.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/captures?limit=25&before=capture-page-2-start',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(both.exitCode).toBe(2)
  })

  it('prints only the page boundaries that have another page in human mode', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse(capturePage({
        startCursor: 'capture-page-1-start', endCursor: 'capture-page-1-end',
        hasPreviousPage: false, hasNextPage: true,
      })))
      .mockResolvedValueOnce(jsonResponse(capturePage({
        startCursor: 'capture-page-2-start', endCursor: 'capture-page-2-end',
        hasPreviousPage: true, hasNextPage: false,
      })))
      .mockResolvedValueOnce(jsonResponse(terminalCapturePage)))

    const forward = await runCli(['captures', 'list', '--workspace', 'workspace-1'])
    const backward = await runCli([
      'captures', 'list', '--workspace', 'workspace-1',
      '--input-json', '{"before":"capture-page-3-start"}',
    ])
    const terminal = await runCli(['captures', 'list', '--workspace', 'workspace-1'])

    expect([forward.exitCode, backward.exitCode, terminal.exitCode]).toEqual([0, 0, 0])
    expect(forward.stdout).toContain('Next cursor: capture-page-1-end')
    expect(forward.stdout).not.toContain('Previous cursor:')
    expect(forward.stdout).not.toContain('End of results.')
    expect(backward.stdout).toContain('Previous cursor: capture-page-2-start')
    expect(backward.stdout).not.toContain('Next cursor:')
    expect(terminal.stdout).toContain('End of results.')
    expect(terminal.stdout).not.toContain('cursor')
    expect(`${forward.stdout}${backward.stdout}${terminal.stdout}`).not.toContain('offset')
  })

  it('retains the released 200-item limit for existing list commands', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { message: 'Authentication required.' },
      { status: 401 },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'runs', 'list', '--workspace', 'workspace-1', '--limit', '200', '--json',
    ])

    expect(result.exitCode).toBe(3)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('rejects invalid branded job ids as usage errors before the request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'jobs', 'get', ' ', '--workspace', 'workspace-1', '--json',
    ])

    expect(result.exitCode).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires an explicit workspace and accepts it before the command', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(jsonResponse(terminalCapturePage))
    vi.stubGlobal('fetch', fetchMock)

    const missing = await runCli(['captures', 'list'])
    const global = await runCli([
      '--workspace', 'workspace-1', 'captures', 'list', '--input-json', '{"limit":25}', '--json',
    ])

    expect(missing.exitCode).toBe(2)
    expect(missing.stderr).toContain('--workspace is required')
    expect(global.exitCode).toBe(0)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/captures?limit=25',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('resolves exact workspace names and rejects ambiguous or missing names', async () => {
    const unique = { items: [
      { id: 'workspace-alpha', name: 'Example Workspace', open: true, source: 'local' },
      { id: 'workspace-beta', name: 'Winter Search', open: false, source: 'local' },
    ] }
    const duplicate = { items: [
      { id: 'workspace-one', name: 'Example Workspace', open: true, source: 'local' },
      { id: 'workspace-two', name: 'Example Workspace', open: false, source: 'local' },
    ] }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(unique))
      .mockResolvedValueOnce(jsonResponse(terminalCapturePage))
      .mockResolvedValueOnce(jsonResponse(duplicate))
      .mockResolvedValueOnce(jsonResponse(unique))
    vi.stubGlobal('fetch', fetchMock)

    const resolved = await runCli([
      'captures', 'list', '--workspace', 'example workspace', '--input-json', '{"limit":10}', '--json',
    ])
    const ambiguous = await runCli(['captures', 'list', '--workspace', 'Example Workspace'])
    const missing = await runCli(['captures', 'list', '--workspace', 'Missing Workspace', '--json'])

    expect(resolved.exitCode).toBe(0)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-alpha/captures?limit=10',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(ambiguous.exitCode).toBe(2)
    expect(ambiguous.stderr).toContain('workspace-one')
    expect(ambiguous.stderr).toContain('workspace-two')
    expect(missing.exitCode).toBe(4)
    expect(JSON.parse(missing.stderr)).toMatchObject({
      error: { code: 'workspace_not_found', kind: 'not_found' },
    })
  })

  it('keeps connector status and trigger behavior', async () => {
    const status = {
      id: 'connector-1', displayName: 'Provider', connectorId: 'provider', connectorVersion: '1.0.0',
      enabled: true, auth: [], status: 'authentication_required',
      actionRequired: [{
        id: 'provider-auth', kind: 'auth', label: 'Reconnect',
        message: 'Configure authentication.', severity: 'blocked',
      }],
      actions: [{ id: 'reconnect', label: 'Reconnect' }], lastRunAt: null,
      latestRunId: null, observationCount: 0, severity: 'blocked',
      statusLabel: 'Authentication required', summary: 'Configure authentication.',
      warningCount: 0, warnings: [],
    }
    const run = {
      id: 'run-queued', connectorInstanceId: 'connector-1', executionScopeId: 'scope-provider', mode: 'manual',
      status: 'queued', filterSignature: 'internships', observationCount: 0, warningCount: 0, warnings: [],
      newestFrontier: { state: 'not_started' },
      historicalBackfill: { state: 'not_started', boundary: { earliestDate: '2026-04-01' } },
      pendingResolutionCount: 0, outcome: { kind: 'in_progress' },
      startedAt: '2026-07-21T18:00:00.000Z', completedAt: null, scheduleOccurrence: null,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(status))
      .mockResolvedValueOnce(jsonResponse(run))
    vi.stubGlobal('fetch', fetchMock)

    expect((await runCli(['connectors', 'status', 'connector-1', '--workspace', 'workspace-1', '--json'])).exitCode).toBe(0)
    expect((await runCli([
      'connectors', 'trigger', 'connector-1', '--workspace', 'workspace-1', '--mode', 'manual',
      '--filter-signature', 'internships', '--json',
    ])).exitCode).toBe(0)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/connectors/connector-1/runs',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('keeps credential secret summary behavior', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-cli-profile-'))
    const valuePath = path.join(directory, 'secret-value.txt')
    fs.writeFileSync(valuePath, 'super-secret-password')
    const summary = {
      key: 'provider_password', kind: 'password', label: 'Provider password',
      updatedAt: '2026-07-21T18:00:00.000Z',
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(summary))
      .mockResolvedValueOnce(jsonResponse({ items: [summary] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const upsert = await runCli([
      'secrets', 'upsert', 'provider_password', '--workspace', 'workspace-1', '--kind', 'password',
      '--label', 'Provider password', '--value-file', valuePath, '--json',
    ])
    const list = await runCli(['secrets', 'list', '--workspace', 'workspace-1', '--json'])
    const remove = await runCli(['secrets', 'delete', 'provider_password', '--workspace', 'workspace-1', '--json'])

    expect([upsert.exitCode, list.exitCode, remove.exitCode]).toEqual([0, 0, 0])
    expect(`${upsert.stdout}${list.stdout}${remove.stdout}`).not.toContain('super-secret-password')
  })

  it('keeps action queue and score commands unchanged', async () => {
    const queue = actionQueueListResult({ limit: 25, offset: 5, hasMore: false })
    const score = {
      applicationId: 'application-1', score: 8, band: 'high', roleRelevance: 3,
      careerSignal: 2, cityWorkMode: 2, compensationLogistics: 1, penalties: [],
      rationale: 'Strong fit.', rubricVersion: 'valedictorian-cli', id: 'score-1',
      createdAt: '2026-07-21T18:00:00.000Z',
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(queue))
      .mockResolvedValueOnce(jsonResponse(score))
    vi.stubGlobal('fetch', fetchMock)

    const queueResult = await runCli([
      'action-queue', 'list', '--workspace', 'workspace-1', '--action-bucket', 'apply_now',
      '--limit', '25', '--offset', '5', '--json',
    ])
    const scoreResult = await runCli([
      'scores', 'record', 'application-1', '--score', '8', '--band', 'high',
      '--role-relevance', '3', '--career-signal', '2', '--city-work-mode', '2',
      '--compensation-logistics', '1', '--rationale', 'Strong fit.',
      '--workspace', 'workspace-1', '--json',
    ])

    expect(JSON.parse(queueResult.stdout)).toEqual(queue)
    expect(JSON.parse(scoreResult.stdout)).toEqual(score)
  })
})
