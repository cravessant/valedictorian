import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectorsApi, createProfileApi } from '../App.test-helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'

const instanceId = 'jobright-run-action'
const displayName = 'Jobright run action'

afterEach(cleanup)

function unavailableScheduleApi(): ConnectorScheduleUiApi {
  return {
    getCapabilities: vi.fn(async () => ({ connectorScheduling: { available: false as const } })),
    getSchedule: vi.fn(async () => null),
    upsertSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    pauseSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    resumeSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    deleteSchedule: vi.fn(async () => { throw new Error('unavailable') }),
  }
}

function instanceFixture(enabled = true) {
  return {
    id: instanceId,
    connectorId: 'jobright.resolver',
    connectorVersion: '0.11.0',
    displayName,
    enabled,
    auth: [{
      id: 'jobright',
      mode: 'username_password' as const,
      label: 'Jobright username and password',
      configured: true,
    }],
    config: {},
    filters: { country: 'US' },
    earliestBackfillDate: '2026-07-02',
    createdAt: '2026-07-09T15:00:00.000Z',
    updatedAt: '2026-07-09T15:00:00.000Z',
  }
}

function completedRun() {
  return {
    id: 'connector-run-action',
    connectorInstanceId: instanceId,
    executionScopeId: 'scope_jobright_run_action',
    mode: 'manual' as const,
    scheduleOccurrence: null,
    status: 'completed' as const,
    filterSignature: 'filters:{}',
    observationCount: 0,
    warningCount: 0,
    newestFrontier: { state: 'caught_up' as const },
    historicalBackfill: {
      state: 'caught_up' as const,
      boundary: { earliestDate: '2026-07-02' },
    },
    pendingResolutionCount: 0,
    outcome: { kind: 'caught_up' as const },
    createdAt: '2026-07-09T15:00:00.000Z',
    updatedAt: '2026-07-09T15:00:00.000Z',
    startedAt: '2026-07-09T15:00:00.000Z',
    finishedAt: '2026-07-09T15:01:00.000Z',
  }
}

function renderPanel(connectorsApi: ReturnType<typeof createConnectorsApi>) {
  return render(
    <ConnectorSettingsPanel
      connectorsApi={connectorsApi}
      connectorScheduleApi={unavailableScheduleApi()}
      onRunSettled={vi.fn()}
      profileApi={createProfileApi()}
      workspaceId="workspace-1"
    />,
  )
}

async function openDetails(summary: HTMLElement) {
  fireEvent.click(within(summary).getByRole('button', { name: `View ${displayName} details` }))
  return screen.findByRole('dialog', { name: `${displayName} details` })
}

function reasonFor(action: HTMLElement, root: HTMLElement) {
  const reasonId = action.getAttribute('aria-describedby')
  expect(reasonId).toBeTruthy()
  const reason = root.querySelector(`#${CSS.escape(reasonId!)}`)
  expect(reason).not.toBeNull()
  return reason!
}

describe('ConnectorSettingsPanel Jobright run action', () => {
  it('keeps the summary action near details and the dialog action centered with one disabled reason', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceFixture(false)] })

    renderPanel(connectorsApi)

    const summary = await screen.findByTestId(`connector-instance-summary-${instanceId}`)
    const summaryRun = within(summary).getByTestId(`connector-summary-run-action-${instanceId}`)
    expect(summaryRun).toBeDisabled()
    expect(within(summary).getByRole('button', { name: `View ${displayName} details` }))
      .toBeInTheDocument()
    const summaryReason = reasonFor(summaryRun, summary)

    const dialog = await openDetails(summary)
    const detailsRun = within(dialog).getByTestId(`connector-details-run-action-${instanceId}`)
    expect(detailsRun).toBeDisabled()
    expect(reasonFor(detailsRun, dialog)).toHaveTextContent(summaryReason.textContent ?? '')
    expect(within(dialog).getByTestId(`connector-details-run-action-position-${instanceId}`))
      .toHaveClass('justify-center')
  })

  it('uses one mutation for either action and shares the active state between placements', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceFixture()] })
    type Run = Awaited<ReturnType<typeof connectorsApi.runs.trigger>>
    let resolveSummaryRun!: (run: Run) => void
    let resolveDetailsRun!: (run: Run) => void
    const summaryRun = new Promise<Run>((resolve) => { resolveSummaryRun = resolve })
    const detailsRun = new Promise<Run>((resolve) => { resolveDetailsRun = resolve })
    vi.mocked(connectorsApi.runs.trigger)
      .mockReturnValueOnce(summaryRun)
      .mockReturnValueOnce(detailsRun)

    renderPanel(connectorsApi)

    const summary = await screen.findByTestId(`connector-instance-summary-${instanceId}`)
    const summaryAction = within(summary).getByTestId(`connector-summary-run-action-${instanceId}`)
    await waitFor(() => expect(summaryAction).toBeEnabled())
    fireEvent.click(summaryAction)
    await waitFor(() => expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(1))

    const dialog = await openDetails(summary)
    const detailsAction = within(dialog).getByTestId(`connector-details-run-action-${instanceId}`)
    expect(summaryAction).toHaveTextContent('Running...')
    expect(summaryAction).toBeDisabled()
    expect(detailsAction).toHaveTextContent('Running...')
    expect(detailsAction).toBeDisabled()
    fireEvent.click(detailsAction)
    expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(1)

    await act(async () => { resolveSummaryRun(completedRun()) })
    await waitFor(() => expect(detailsAction).toBeEnabled())
    expect(summaryAction).toBeEnabled()

    fireEvent.click(detailsAction)
    await waitFor(() => expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(2))
    expect(summaryAction).toHaveTextContent('Running...')
    expect(summaryAction).toBeDisabled()
    expect(detailsAction).toHaveTextContent('Running...')
    expect(detailsAction).toBeDisabled()
    fireEvent.click(summaryAction)
    expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(2)

    await act(async () => { resolveDetailsRun(completedRun()) })
    await waitFor(() => expect(detailsAction).toBeEnabled())
  })
})
