import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultApplicationLoader,
  defaultConnectorScheduleApi,
  defaultConnectorsApi,
} from './loaders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

describe('renderer HTTP loaders', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
    delete (window as Window & { connectors?: unknown }).connectors
  })

  it('loads applications through the workspace-scoped HTTP client when configured', async () => {
    const payload = { hasMore: false, items: [], limit: 1, offset: 0, total: 0 }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)
    ;(window as Window & {
      valedictorianHttp?: { apiBaseUrl: string; workspaceId: string }
    }).valedictorianHttp = {
      apiBaseUrl: 'https://valedictorian.test',
      workspaceId: 'workspace-1',
    }

    await expect(defaultApplicationLoader({ limit: 1 })).resolves.toEqual(payload)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/applications?limit=1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('reads root capabilities and workspace schedules through the Sparxie HTTP client', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/capabilities')) {
        return jsonResponse({
          localSqlite: true,
          agentWorkflows: false,
          workflowRuns: false,
          applicationAttempts: true,
          sourcing: true,
          connectors: true,
          hostedSync: false,
          multiWorkspace: true,
          billing: false,
          connectorScheduling: { available: false },
        })
      }

      if (url.includes('/connectors/') && url.endsWith('/schedule')) {
        return jsonResponse(null, 404)
      }

      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    ;(window as Window & {
      valedictorianHttp?: { apiBaseUrl: string; workspaceId: string }
    }).valedictorianHttp = {
      apiBaseUrl: 'https://valedictorian.test',
      workspaceId: 'workspace-schedule',
    }

    await expect(defaultConnectorScheduleApi.getCapabilities()).resolves.toEqual({
      connectorScheduling: { available: false },
    })
    await expect(defaultConnectorScheduleApi.getSchedule('connector-1')).resolves.toBeNull()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/capabilities',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-schedule/connectors/connector-1/schedule',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('uses a privileged renderer fetch adapter when provided by preload without exposing a token', async () => {
    const request = vi.fn(async () => jsonResponse({
      localSqlite: false,
      agentWorkflows: false,
      workflowRuns: false,
      applicationAttempts: true,
      sourcing: true,
      connectors: true,
      hostedSync: false,
      multiWorkspace: true,
      billing: false,
      connectorScheduling: { available: false },
    }))
    ;(window as Window & {
      valedictorianHttp?: {
        apiBaseUrl: string
        workspaceId: string
        request: typeof fetch
      }
    }).valedictorianHttp = {
      apiBaseUrl: 'https://api.valedictorian.test',
      workspaceId: 'workspace-remote',
      request: request as unknown as typeof fetch,
    }

    await expect(defaultConnectorScheduleApi.getCapabilities()).resolves.toEqual({
      connectorScheduling: { available: false },
    })

    expect(request).toHaveBeenCalledWith(
      'https://api.valedictorian.test/v1/capabilities',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(JSON.stringify(window.valedictorianHttp)).not.toContain('token')
  })

  it('prefers HTTP connectors over preload IPC when HTTP is configured', async () => {
    const httpConnector = {
      id: 'http-connector',
      connectorId: 'fixture.jobs',
      connectorVersion: '1.0.0',
      displayName: 'HTTP Connector',
      enabled: true,
      auth: [],
      config: {},
      filters: {},
      earliestBackfillDate: '2026-01-01',
      createdAt: '2026-07-09T15:00:00.000Z',
      updatedAt: '2026-07-09T15:00:00.000Z',
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse({ items: [httpConnector] }))
    vi.stubGlobal('fetch', fetchMock)
    const ipcList = vi.fn(async () => ({ items: [{ id: 'ipc-connector' }] }))
    ;(window as Window & {
      connectors?: { list: typeof ipcList }
      valedictorianHttp?: { apiBaseUrl: string; workspaceId: string }
    }).connectors = { list: ipcList }
    ;(window as Window & {
      valedictorianHttp?: { apiBaseUrl: string; workspaceId: string }
    }).valedictorianHttp = {
      apiBaseUrl: 'https://valedictorian.test',
      workspaceId: 'workspace-1',
    }

    await expect(defaultConnectorsApi.list()).resolves.toEqual({ items: [httpConnector] })
    expect(ipcList).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/connectors',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
