import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorsPreloadApi } from '../ipc/connectors.preload'
import { ConnectorRunsPanel } from './ConnectorRunsPanel'
import type { ConnectorSettingsRun } from './connector-settings.types'

afterEach(() => cleanup())

function completedRun(observationCount: number, id = 'focused-run'): ConnectorSettingsRun {
  return {
    id,
    connectorInstanceId: 'fixture-instance',
    executionScopeId: 'fixture-scope',
    mode: 'manual',
    status: 'completed',
    filterSignature: 'filters:{}',
    observationCount,
    warningCount: 0,
    warnings: [],
    scheduleOccurrence: null,
    newestFrontier: { state: 'caught_up' },
    historicalBackfill: { state: 'not_started', boundary: { earliestDate: '2026-07-01' } },
    pendingResolutionCount: 0,
    outcome: { kind: 'caught_up' },
    startedAt: '2026-07-18T10:00:00.000Z',
    completedAt: '2026-07-18T10:01:00.000Z',
  }
}

function runningRun(id = 'focused-run'): ConnectorSettingsRun {
  return {
    id,
    connectorInstanceId: 'fixture-instance',
    executionScopeId: 'fixture-scope',
    mode: 'manual',
    status: 'running',
    filterSignature: 'filters:{}',
    observationCount: 0,
    warningCount: 0,
    warnings: [],
    scheduleOccurrence: null,
    newestFrontier: { state: 'advancing' },
    historicalBackfill: { state: 'not_started', boundary: { earliestDate: '2026-07-01' } },
    pendingResolutionCount: 0,
    outcome: { kind: 'in_progress' },
    startedAt: '2026-07-18T10:00:00.000Z',
    completedAt: null,
  }
}

function apiFor(runs: ConnectorSettingsRun | ConnectorSettingsRun[]) {
  const items = Array.isArray(runs) ? runs : [runs]
  return {
    list: vi.fn(async () => ({
      items: [{
        id: 'fixture-instance',
        connectorId: 'fixture.connector',
        displayName: 'Fixture connector',
      }],
    })),
    runs: {
      list: vi.fn(async () => ({
        items,
        total: items.length,
        limit: 20,
        offset: 0,
        hasMore: false,
      })),
    },
  } as unknown as ConnectorsPreloadApi
}

describe('ConnectorRunsPanel focus ownership', () => {
  it('focuses the exact connector provenance target within a run', async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
    const connectorsApi = apiFor(completedRun(1))
    const { rerender } = render(
      <ConnectorRunsPanel
        connectorsApi={connectorsApi}
        focusedRunId="focused-run"
        focusedProvenanceTarget={{
          connectorRunId: 'focused-run', id: 'fixture-instance', kind: 'instance',
        }}
      />,
    )

    const instance = await waitFor(() => {
      const node = document.querySelector<HTMLElement>(
        '[data-connector-provenance-kind="instance"][data-connector-provenance-id="fixture-instance"]',
      )
      expect(node).toHaveFocus()
      return node!
    })
    expect(instance).toHaveTextContent('fixture-instance')

    rerender(
      <ConnectorRunsPanel
        connectorsApi={connectorsApi}
        focusedRunId="focused-run"
        focusedProvenanceTarget={{
          connectorRunId: 'focused-run', id: 'fixture-scope', kind: 'scope',
        }}
      />,
    )
    await waitFor(() => expect(document.querySelector<HTMLElement>(
      '[data-connector-provenance-kind="scope"][data-connector-provenance-id="fixture-scope"]',
    )).toHaveFocus())
  })

  it('does not steal focus again when the focused run refreshes', async () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const initialApi = apiFor(completedRun(1))
    const { rerender } = render(
      <ConnectorRunsPanel connectorsApi={initialApi} focusedRunId="focused-run" />,
    )

    const focused = await screen.findByRole('article', { current: true })
    await waitFor(() => expect(focused).toHaveFocus())
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    const refreshedApi = apiFor(completedRun(4))
    rerender(<ConnectorRunsPanel connectorsApi={refreshedApi} focusedRunId="focused-run" />)

    await waitFor(() => expect(refreshedApi.runs.list).toHaveBeenCalled())
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(elsewhere).toHaveFocus()
    elsewhere.remove()
  })

  it('keeps polite live-region ownership on the focused active run article', async () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const active = runningRun('focused-active-run')
    const completed = completedRun(1, 'completed-sibling-run')
    const connectorsApi = apiFor([active, completed])

    render(
      <ConnectorRunsPanel
        connectorsApi={connectorsApi}
        focusedRunId="focused-active-run"
      />,
    )

    const focusedArticle = await screen.findByRole('article', { current: true })
    expect(focusedArticle).toHaveAttribute('data-connector-run-id', 'focused-active-run')
    expect(focusedArticle).toHaveAttribute('aria-live', 'polite')
    expect(focusedArticle).toHaveAttribute('tabIndex', '-1')
    await waitFor(() => expect(focusedArticle).toHaveFocus())

    const completedArticle = screen
      .getAllByRole('article')
      .find((article) => article.getAttribute('data-connector-run-id') === 'completed-sibling-run')
    expect(completedArticle).toBeDefined()
    expect(completedArticle).not.toHaveAttribute('aria-live')
    expect(completedArticle).not.toHaveAttribute('aria-current')
    expect(completedArticle).not.toHaveAttribute('tabIndex')
  })
})
