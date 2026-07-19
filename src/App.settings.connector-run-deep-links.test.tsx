import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createConnectorsApiWithJobrightDescriptor as createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  openConnectorEditor,
  selectSoftwareEngineeringTaxonomy,
} from './App.test-helpers'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
  delete (window as Window & { profile?: unknown }).profile
  delete (window as Window & { workspace?: unknown }).workspace
  delete (window as Window & { valedictorianWindowChrome?: unknown }).valedictorianWindowChrome
})

function synchronization() {
  return {
    executionScopeId: 'scope_jobright_default',
    scheduleOccurrence: null,
    newestFrontier: { state: 'caught_up' as const },
    historicalBackfill: {
      state: 'not_started' as const,
      boundary: { earliestDate: '2026-07-01' },
    },
    pendingResolutionCount: 0,
    outcome: { kind: 'caught_up' as const },
  }
}

describe('connector-run deep-link App wiring', () => {
  it('opens and focuses a supplied run, then clears stale focus through ordinary Runs navigation', async () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const focusedRun = {
      id: 'connector-run-focus',
      connectorInstanceId: 'jobright-default',
      ...synchronization(),
      mode: 'manual' as const,
      status: 'completed' as const,
      coverage: { start: '2026-07-09T15:00:00.000Z', end: '2026-07-09T16:00:00.000Z' },
      filterSignature: 'filters:{}',
      observationCount: 1,
      warningCount: 0,
      stats: { stage: 'finalizing' },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
    }
    const otherRun = {
      ...focusedRun,
      id: 'connector-run-other',
      startedAt: '2026-07-09T15:00:00.000Z',
      completedAt: '2026-07-09T15:00:01.000Z',
    }
    vi.mocked(connectorsApi.runs.trigger).mockResolvedValueOnce(focusedRun)
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      items: [focusedRun, otherRun],
      total: 2,
      limit: 20,
      offset: 0,
      hasMore: false,
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    const appNavigation = within(
      screen.getByRole('complementary', { name: 'Application navigation' }),
    ).getByRole('navigation', { name: 'Application views' })
    fireEvent.click(within(appNavigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(within(appNavigation).getByRole('button', { name: 'Overview' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))

    await openConnectorEditor()
    fireEvent.click(await screen.findByRole('button', {
      name: /^(Add credentials|Update credentials)$/,
    }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: ' pass with spaces ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))
    await screen.findByText('Auth verified')
    await selectSoftwareEngineeringTaxonomy()
    fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
    fireEvent.click(screen.getByRole('button', {
      name: 'Save Jobright internslist connector settings',
    }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByText('Latest synchronization: Caught up')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: 'View connector-run-focus in Connector Runs',
    }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'connector-runs')
    const focusedArticle = await screen.findByRole('article', { current: true })
    expect(focusedArticle).toHaveAttribute('data-connector-run-id', 'connector-run-focus')
    expect(focusedArticle).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    fireEvent.click(within(appNavigation).getByRole('button', { name: 'Runs' }))

    expect(screen.queryByRole('article', { current: true })).not.toBeInTheDocument()
    for (const article of await screen.findAllByRole('article')) {
      expect(article).not.toHaveAttribute('aria-current')
      expect(article).not.toHaveClass('ring-2')
    }
  })
})
