import { describe, expect, it, vi } from 'vitest'
import type { ConnectorsPreloadApi } from '../ipc/connectors.preload'
import type { ConnectorSettingsRun } from './connector-settings.types'
import {
  CONNECTOR_RUNS_MAX_FOCUS_PAGES,
  CONNECTOR_RUNS_PAGE_SIZE,
  resolveFocusedConnectorRun,
  type ConnectorRunHistoryItem,
} from './ConnectorRunsPanel'

function run(id: string, startedAt = '2026-07-18T10:00:00.000Z') {
  return { id, startedAt } as ConnectorSettingsRun
}

function item(id: string): ConnectorRunHistoryItem {
  return {
    connectorId: 'fixture.connector',
    connectorName: 'Fixture connector',
    run: run(id),
  }
}

function apiWithRunsList(
  list: (input: { limit?: number; offset?: number }) => Promise<{
    items: ConnectorSettingsRun[]
    hasMore: boolean
  }>,
) {
  const runsList = vi.fn(list)
  const api = {
    list: vi.fn(async () => ({
      items: [{
        id: 'fixture-instance',
        connectorId: 'fixture.connector',
        displayName: 'Fixture connector',
      }],
    })),
    runs: { list: runsList },
  } as unknown as ConnectorsPreloadApi
  return { api, runsList }
}

describe('focused connector-run lookup', () => {
  it('returns an item already present on the initial page without another request', async () => {
    const existing = item('focused-run')
    const { api, runsList } = apiWithRunsList(async () => ({ items: [], hasMore: false }))

    await expect(resolveFocusedConnectorRun(api, existing.run.id, [existing], true))
      .resolves.toEqual({ focusedItem: existing, outcome: 'found' })
    expect(runsList).not.toHaveBeenCalled()
  })

  it('finds a supplied run on a later page', async () => {
    const focused = run('focused-run')
    const { api, runsList } = apiWithRunsList(async ({ offset }) => ({
      items: offset === CONNECTOR_RUNS_PAGE_SIZE ? [focused] : [],
      hasMore: false,
    }))

    await expect(resolveFocusedConnectorRun(api, focused.id, [], true)).resolves.toMatchObject({
      focusedItem: { run: focused },
      outcome: 'found',
    })
    expect(runsList).toHaveBeenCalledWith(expect.objectContaining({
      limit: CONNECTOR_RUNS_PAGE_SIZE,
      offset: CONNECTOR_RUNS_PAGE_SIZE,
    }))
  })

  it('returns not-found only after available history is exhausted', async () => {
    const { api, runsList } = apiWithRunsList(async () => ({ items: [], hasMore: false }))

    await expect(resolveFocusedConnectorRun(api, 'missing-run', [], true)).resolves.toEqual({
      focusedItem: null,
      outcome: 'not_found',
    })
    expect(runsList).toHaveBeenCalledTimes(1)
  })

  it('reports the search limit while older history remains', async () => {
    const { api, runsList } = apiWithRunsList(async () => ({ items: [], hasMore: true }))

    await expect(resolveFocusedConnectorRun(api, 'deep-run', [], true)).resolves.toEqual({
      focusedItem: null,
      outcome: 'search_limit_reached',
    })
    expect(runsList).toHaveBeenCalledTimes(CONNECTOR_RUNS_MAX_FOCUS_PAGES - 1)
    expect(runsList.mock.calls.map(([input]) => input.offset)).toEqual(
      Array.from(
        { length: CONNECTOR_RUNS_MAX_FOCUS_PAGES - 1 },
        (_, index) => (index + 1) * CONNECTOR_RUNS_PAGE_SIZE,
      ),
    )
  })
})
