// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { createConnectorsApi } from './App.test-helpers'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import { defaultAppSettings } from './settings/app-settings'
import type { ConnectorSettingsRun } from './settings/connector-settings.types'

/** The canonical page boundaries a single-page lifecycle list reports. */
const emptyPageInfo = {
  startCursor: null,
  endCursor: null,
  hasPreviousPage: false,
  hasNextPage: false,
} as const


afterEach(() => {
  cleanup()
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
})

describe('App Capture navigation', () => {
  it('opens the canonical Capture inbox from Connector Runs without a legacy run query', async () => {
    const user = userEvent.setup()
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-one',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.17.0',
      displayName: 'Jobright',
      enabled: true,
      auth: [],
      config: {},
      filters: {},
    })
    const run: ConnectorSettingsRun = {
      id: 'run/one',
      connectorInstanceId: 'jobright-one',
      executionScopeId: 'scope.run-one',
      mode: 'manual',
      scheduleOccurrence: null,
      status: 'completed',
      filterSignature: 'filters:{}',
      observationCount: 1,
      warningCount: 0,
      warnings: [],
      newestFrontier: { state: 'caught_up' },
      historicalBackfill: {
        state: 'caught_up',
        boundary: { earliestDate: '2026-07-01' },
      },
      pendingResolutionCount: 0,
      outcome: { kind: 'caught_up' },
      startedAt: '2026-07-22T12:00:00.000Z',
      completedAt: '2026-07-22T12:01:00.000Z',
    }
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      items: [run],
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    })

    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      return new Response(JSON.stringify(
        url.includes('/capture-resolution/captures')
          ? {
              items: [],
              pageInfo: {
                startCursor: null,
                endCursor: null,
                hasPreviousPage: false,
                hasNextPage: false,
              },
              totalCount: 0,
            }
          : { items: [], pageInfo: emptyPageInfo },
      ), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    })
    Object.defineProperty(window, 'valedictorianHttp', {
      configurable: true,
      value: {
        apiBaseUrl: 'http://127.0.0.1:4317',
        workspaceId: 'workspace-one',
        request,
        getBackendState: () => ({ status: 'available', origin: 'http://127.0.0.1:4317' }),
        onBackendStateChanged: () => vi.fn(),
      },
    })
    const settingsApi: SettingsPreloadApi = {
      get: vi.fn(async () => defaultAppSettings),
      reset: vi.fn(async () => defaultAppSettings),
      update: vi.fn(async () => defaultAppSettings),
    }
    const workspaceApi = {
      getCurrent: vi.fn(async () => null),
    } as unknown as WorkspacePreloadApi

    render(<App settingsApi={settingsApi} workspaceApi={workspaceApi} connectorsApi={connectorsApi} />)
    await screen.findByRole('table', { name: 'Captures' })

    await user.click(screen.getByRole('button', { name: 'Connector runs' }))
    await user.click(await screen.findByRole('button', { name: 'View Captures from run/one' }))

    expect(await screen.findByRole('table', { name: 'Captures' })).toBeInTheDocument()
    await waitFor(() => {
      const urls = request.mock.calls.map(([input]) =>
        input instanceof Request ? input.url : String(input))
      expect(urls.length).toBeGreaterThan(0)
      expect(urls.some((url) => url.includes('connectorRunId='))).toBe(false)
    })

    await user.click(screen.getByRole('button', { name: 'Connector runs' }))
    await user.click(screen.getByRole('button', { name: 'Captures' }))
    await screen.findByRole('table', { name: 'Captures' })
    expect(screen.queryByText('Filtered to connector run run/one')).not.toBeInTheDocument()
    expect(request.mock.calls.every(([input]) =>
      !(input instanceof Request ? input.url : String(input)).includes('connectorRunId=')))
      .toBe(true)
  })
})
