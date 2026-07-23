import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConnectorScheduleHttpError,
  connectorScheduleErrorBodies,
  type ConnectorScheduleSummary,
} from '@sparxie/sdk'
import { ConnectorScheduleControls } from './ConnectorScheduleControls'
import {
  CONNECTOR_SCHEDULE_LOAD_FAILURE_EXPLANATION,
  CONNECTOR_SCHEDULE_UNAVAILABLE_EXPLANATION,
  createEmptyConnectorScheduleDraft,
} from './connector-schedule.helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import type { ConnectorSettingsInstance } from './connector-settings.types'
import { useConnectorInstanceSchedules } from './useConnectorInstanceSchedules'

const sonnerToast = vi.hoisted(() => {
  const toastFn = vi.fn(() => 'toast-default')
  return Object.assign(toastFn, {
    dismiss: vi.fn(),
    error: vi.fn(() => 'toast-error'),
    success: vi.fn(() => 'toast-success'),
  })
})

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: sonnerToast,
}))

afterEach(cleanup)

beforeEach(() => {
  sonnerToast.mockClear()
  sonnerToast.error.mockClear()
  sonnerToast.success.mockClear()
  sonnerToast.dismiss.mockClear()
})

const availableCapability = {
  available: true as const,
  supportedCadences: ['interval', 'daily', 'weekly'] as const,
  minimumIntervalMinutes: 15,
  maximumCatchUpAgeMinutes: 24 * 60,
  timezoneModel: 'iana' as const,
  missedOccurrencePolicy: 'coalesce_one' as const,
}

const instance = {
  id: 'jobright-default',
  connectorId: 'jobright',
  connectorVersion: '1',
  displayName: 'Jobright internslist',
  enabled: true,
  auth: [],
  config: {},
  filters: {},
  earliestBackfillDate: '2026-01-01',
  createdAt: '2026-07-12T12:00:00.000Z',
  updatedAt: '2026-07-12T12:00:00.000Z',
} as ConnectorSettingsInstance

function createSchedule(overrides: Partial<ConnectorScheduleSummary> = {}): ConnectorScheduleSummary {
  return {
    id: 'schedule-1',
    connectorInstanceId: 'jobright-default',
    revision: 'rev-1',
    state: 'enabled',
    cadence: { kind: 'interval', everyMinutes: 60 },
    timezone: 'UTC',
    nextEligibleAt: '2026-07-12T13:00:00.000Z',
    createdAt: '2026-07-12T12:00:00.000Z',
    updatedAt: '2026-07-12T12:00:00.000Z',
    lastOccurrence: null,
    lastRun: null,
    ...overrides,
  }
}

function createApi(overrides: Partial<ConnectorScheduleUiApi> = {}): ConnectorScheduleUiApi {
  return {
    getCapabilities: vi.fn(async () => ({ connectorScheduling: availableCapability })),
    getSchedule: vi.fn(async () => createSchedule()),
    upsertSchedule: vi.fn(async () => createSchedule()),
    pauseSchedule: vi.fn(async () => createSchedule({ state: 'paused' })),
    resumeSchedule: vi.fn(async () => createSchedule()),
    deleteSchedule: vi.fn(async () => undefined),
    ...overrides,
  }
}

function rejectWithTypedScheduleError(canary: string) {
  return Object.assign(
    new ConnectorScheduleHttpError(
      connectorScheduleErrorBodies.stale_schedule_revision,
      409,
    ),
    { diagnostic: canary },
  )
}

function ScheduleHarness({ api }: { api: ConnectorScheduleUiApi }) {
  const {
    capabilityLoadError,
    isScheduleDraftDirty,
    pauseConnectorSchedule,
    resumeConnectorSchedule,
    saveConnectorSchedule,
    scheduleStates,
    schedulingCapability,
    updateScheduleDraft,
  } = useConnectorInstanceSchedules({
    connectorScheduleApi: api,
    instances: [instance],
    workspaceId: 'workspace-1',
  })
  const state = scheduleStates[instance.id]
  if (!state || state.isLoading) {
    return <div role="status">Loading schedule</div>
  }

  return (
    <ConnectorScheduleControls
      capability={schedulingCapability}
      capabilityLoadError={capabilityLoadError}
      canonical={state.canonical}
      connectorDisplayName={instance.displayName}
      connectorEnabled={instance.enabled}
      draft={state.draft}
      isDirty={isScheduleDraftDirty(state.draft, state.canonical)}
      isLoading={state.isLoading}
      isSaving={state.isSaving}
      loadFailure={state.loadFailure}
      statusMessage={state.statusMessage}
      statusTone={state.statusTone}
      validationField={state.validationField}
      onDiscard={vi.fn()}
      onDraftChange={(patch) => updateScheduleDraft(instance.id, patch)}
      onPause={() => {
        void pauseConnectorSchedule(instance)
      }}
      onResume={() => {
        void resumeConnectorSchedule(instance)
      }}
      onSave={() => {
        void saveConnectorSchedule(instance)
      }}
    />
  )
}

function expectSingleFocusedFormFailure(section: HTMLElement, canary: RegExp, safeCopy: string) {
  const alerts = within(section).getAllByRole('alert')
  expect(alerts).toHaveLength(1)
  expect(alerts[0]).toHaveAttribute('data-slot', 'form-failure')
  expect(alerts[0]).toHaveTextContent(safeCopy)
  expect(alerts[0]).not.toHaveTextContent(canary)
  expect(document.activeElement).toBe(alerts[0])
  expect(document.querySelectorAll('[data-slot="form-failure"]')).toHaveLength(1)
  expect(sonnerToast.error).not.toHaveBeenCalled()
  expect(screen.queryByText(canary)).not.toBeInTheDocument()
}

describe('ConnectorScheduleControls async FormFailureAlert ownership', () => {
  it('settles an initial schedule capability AbortError to unavailable non-error UI', async () => {
    const api = createApi({
      getCapabilities: vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }),
    })

    function AbortHarness() {
      const {
        capabilityLoadError,
        schedulingCapability,
      } = useConnectorInstanceSchedules({
        connectorScheduleApi: api,
        instances: [instance],
        workspaceId: 'workspace-1',
      })

      return (
        <ConnectorScheduleControls
          capability={schedulingCapability}
          capabilityLoadError={capabilityLoadError}
          canonical={null}
          connectorDisplayName={instance.displayName}
          connectorEnabled={instance.enabled}
          draft={createEmptyConnectorScheduleDraft('UTC')}
          isDirty={false}
          isLoading={false}
          isSaving={false}
          loadFailure={null}
          statusMessage={null}
          statusTone="idle"
          validationField={null}
          onDiscard={vi.fn()}
          onDraftChange={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onSave={vi.fn()}
        />
      )
    }

    render(<AbortHarness />)

    expect(await screen.findByText(
      /No external or cloud scheduler capability is connected/,
    )).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading scheduler capability...')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading schedule')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
  it('renders one focused FormFailureAlert after rejected schedule save and keeps the draft', async () => {
    const canaryText = 'CANARY_SCHEDULE_SAVE /secret/schedule'
    const canary = /CANARY_SCHEDULE_SAVE \/secret\/schedule/
    const safeCopy = connectorScheduleErrorBodies.stale_schedule_revision.message
    const api = createApi({
      upsertSchedule: vi.fn(async () => {
        throw rejectWithTypedScheduleError(canaryText)
      }),
    })

    render(<ScheduleHarness api={api} />)
    const section = await screen.findByLabelText('Jobright internslist schedule')

    fireEvent.change(within(section).getByLabelText('Schedule mode'), {
      target: { value: 'custom-interval' },
    })
    fireEvent.change(within(section).getByLabelText('Every minutes'), {
      target: { value: '45' },
    })
    expect(within(section).getByLabelText('Every minutes')).toHaveValue(45)

    fireEvent.click(within(section).getByRole('button', { name: 'Save schedule' }))

    await waitFor(() => {
      expectSingleFocusedFormFailure(
        screen.getByLabelText('Jobright internslist schedule'),
        canary,
        safeCopy,
      )
    })
    expect(within(screen.getByLabelText('Jobright internslist schedule'))
      .getByLabelText('Every minutes')).toHaveValue(45)
    expect(within(screen.getByLabelText('Jobright internslist schedule'))
      .getByLabelText('Schedule mode')).toHaveValue('custom-interval')
  })

  it('renders one focused FormFailureAlert after rejected pause and keeps canonical controls', async () => {
    const canaryText = 'CANARY_SCHEDULE_PAUSE /secret/pause'
    const canary = /CANARY_SCHEDULE_PAUSE \/secret\/pause/
    const safeCopy = connectorScheduleErrorBodies.stale_schedule_revision.message
    const api = createApi({
      pauseSchedule: vi.fn(async () => {
        throw rejectWithTypedScheduleError(canaryText)
      }),
    })

    render(<ScheduleHarness api={api} />)
    await screen.findByRole('button', { name: 'Pause schedule' })

    fireEvent.click(screen.getByRole('button', { name: 'Pause schedule' }))

    await waitFor(() => {
      expectSingleFocusedFormFailure(
        screen.getByLabelText('Jobright internslist schedule'),
        canary,
        safeCopy,
      )
    })
    expect(screen.getByText(/Persisted:\s*Enabled/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause schedule' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume schedule' })).not.toBeInTheDocument()
  })

  it('renders one focused FormFailureAlert after rejected resume and keeps canonical controls', async () => {
    const canaryText = 'CANARY_SCHEDULE_RESUME /secret/resume'
    const canary = /CANARY_SCHEDULE_RESUME \/secret\/resume/
    const safeCopy = connectorScheduleErrorBodies.stale_schedule_revision.message
    const api = createApi({
      getSchedule: vi.fn(async () => createSchedule({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => {
        throw rejectWithTypedScheduleError(canaryText)
      }),
    })

    render(<ScheduleHarness api={api} />)
    await screen.findByRole('button', { name: 'Resume schedule' })

    fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }))

    await waitFor(() => {
      expectSingleFocusedFormFailure(
        screen.getByLabelText('Jobright internslist schedule'),
        canary,
        safeCopy,
      )
    })
    expect(screen.getByText(/Persisted:\s*Paused/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume schedule' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause schedule' })).not.toBeInTheDocument()
  })

  it('clears FormFailureAlert while retrying pause and refocuses on a new rejection', async () => {
    const canary = /CANARY_SCHEDULE_PAUSE_RETRY \/secret\/pause/
    const safeCopy = connectorScheduleErrorBodies.stale_schedule_revision.message
    let rejectSecondPause!: (reason?: unknown) => void
    const pauseSchedule = vi.fn()
      .mockRejectedValueOnce(rejectWithTypedScheduleError('CANARY_SCHEDULE_PAUSE_RETRY /secret/pause'))
      .mockImplementationOnce(
        () => new Promise((_, reject) => {
          rejectSecondPause = reject
        }),
      )
    const api = createApi({ pauseSchedule })

    render(<ScheduleHarness api={api} />)
    await screen.findByRole('button', { name: 'Pause schedule' })
    fireEvent.click(screen.getByRole('button', { name: 'Pause schedule' }))

    await waitFor(() => {
      expectSingleFocusedFormFailure(
        screen.getByLabelText('Jobright internslist schedule'),
        canary,
        safeCopy,
      )
    })
    const firstAlert = within(screen.getByLabelText('Jobright internslist schedule'))
      .getByRole('alert')
    firstAlert.blur()
    expect(document.activeElement).not.toBe(firstAlert)

    fireEvent.click(screen.getByRole('button', { name: 'Pause schedule' }))
    await waitFor(() => {
      expect(
        within(screen.getByLabelText('Jobright internslist schedule'))
          .queryByRole('alert'),
      ).not.toBeInTheDocument()
    })

    await act(async () => {
      rejectSecondPause(rejectWithTypedScheduleError('CANARY_SCHEDULE_PAUSE_RETRY /secret/pause'))
    })

    await waitFor(() => {
      expectSingleFocusedFormFailure(
        screen.getByLabelText('Jobright internslist schedule'),
        canary,
        safeCopy,
      )
    })
  })

  it('owns rejected Manual-only confirmation with pending disabled controls and one focused FormFailureAlert', async () => {
    const canaryText = 'CANARY_SCHEDULE_REMOVE /secret/remove'
    const canary = /CANARY_SCHEDULE_REMOVE \/secret\/remove/
    const safeCopy = 'An unexpected error occurred.'
    let rejectDelete: ((reason?: unknown) => void) | undefined
    const deleteSchedule = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectDelete = reject
        }),
    )
    const api = createApi({ deleteSchedule })

    render(<ScheduleHarness api={api} />)
    const section = await screen.findByLabelText('Jobright internslist schedule')
    fireEvent.change(within(section).getByLabelText('Schedule mode'), {
      target: { value: 'manual' },
    })
    fireEvent.click(within(section).getByRole('button', { name: 'Save schedule' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Remove automatic schedule?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove schedule' }))

    await waitFor(() => {
      expect(deleteSchedule).toHaveBeenCalledTimes(1)
    })
    expect(within(dialog).getByRole('button', { name: 'Removing...' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()

    await act(async () => {
      rejectDelete?.(new Error(canaryText))
    })

    await waitFor(() => {
      const alerts = within(dialog).getAllByRole('alert')
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toHaveAttribute('data-slot', 'form-failure')
      expect(alerts[0]).toHaveTextContent(safeCopy)
      expect(alerts[0]).not.toHaveTextContent(canary)
      expect(document.activeElement).toBe(alerts[0])
    })
    expect(document.querySelectorAll('[data-slot="form-failure"]')).toHaveLength(1)
    expect(sonnerToast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Remove automatic schedule?' }))
      .toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove schedule' })).toBeEnabled()
  })

  it('maps typed stale-revision delete failures to the shared schedule error body', async () => {
    const canaryText = 'CANARY_SCHEDULE_REMOVE_TYPED /secret/remove'
    const canary = /CANARY_SCHEDULE_REMOVE_TYPED \/secret\/remove/
    const safeCopy = connectorScheduleErrorBodies.stale_schedule_revision.message
    const deleteSchedule = vi.fn(async () => {
      throw rejectWithTypedScheduleError(canaryText)
    })
    const api = createApi({ deleteSchedule })

    render(<ScheduleHarness api={api} />)
    const section = await screen.findByLabelText('Jobright internslist schedule')
    fireEvent.change(within(section).getByLabelText('Schedule mode'), {
      target: { value: 'manual' },
    })
    fireEvent.click(within(section).getByRole('button', { name: 'Save schedule' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Remove automatic schedule?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove schedule' }))

    await waitFor(() => {
      expectSingleFocusedFormFailure(dialog, canary, safeCopy)
    })
    expect(screen.getByRole('alertdialog', { name: 'Remove automatic schedule?' }))
      .toBeInTheDocument()
  })

  it('shows a capability-load failure without the unavailable explanation and never loads schedules', async () => {
    const getCapabilities = vi.fn(async () => {
      throw new Error('capabilities unavailable')
    })
    const getSchedule = vi.fn(async () => null)
    const upsertSchedule = vi.fn(async () => createSchedule())
    const api = createApi({
      getCapabilities,
      getSchedule,
      upsertSchedule,
    })

    function CapabilityFailureHarness() {
      const { capabilityLoadError, schedulingCapability } = useConnectorInstanceSchedules({
        connectorScheduleApi: api,
        instances: [instance],
        workspaceId: 'workspace-1',
      })

      return (
        <ConnectorScheduleControls
          capability={schedulingCapability}
          capabilityLoadError={capabilityLoadError}
          canonical={null}
          connectorDisplayName={instance.displayName}
          connectorEnabled={instance.enabled}
          draft={createEmptyConnectorScheduleDraft('UTC')}
          isDirty={false}
          isLoading={false}
          isSaving={false}
          loadFailure={null}
          statusMessage={null}
          statusTone="idle"
          validationField={null}
          onDiscard={vi.fn()}
          onDraftChange={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onSave={vi.fn()}
        />
      )
    }

    render(<CapabilityFailureHarness />)

    expect(await screen.findByText(CONNECTOR_SCHEDULE_LOAD_FAILURE_EXPLANATION)).toBeInTheDocument()
    expect(screen.queryByText(CONNECTOR_SCHEDULE_UNAVAILABLE_EXPLANATION)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Schedule mode')).not.toBeInTheDocument()
    expect(getCapabilities).toHaveBeenCalled()
    expect(getSchedule).not.toHaveBeenCalled()
    expect(upsertSchedule).not.toHaveBeenCalled()
  })

  it('pauses and resumes using returned revisions and shows last schedule outcomes', async () => {
    const initial = createSchedule({
      revision: 'rev-live',
      state: 'enabled',
      lastOccurrence: {
        id: 'occ-1',
        scheduleId: 'schedule-1',
        scheduleRevision: 'rev-live',
        nominalAt: '2026-07-12T11:00:00.000Z',
        idempotencyKey: 'key',
        admittedMode: 'scheduled',
        outcome: 'completed',
        connectorRunId: 'run-1',
        createdAt: '2026-07-12T11:00:00.000Z',
      },
      lastRun: {
        id: 'run-1',
        status: 'completed',
        mode: 'scheduled',
        startedAt: '2026-07-12T11:00:00.000Z',
        completedAt: '2026-07-12T11:01:00.000Z',
      },
    })
    const pauseSchedule = vi.fn(async () => createSchedule({
      ...initial,
      revision: 'rev-live-paused',
      state: 'paused',
    }))
    const resumeSchedule = vi.fn(async () => createSchedule({
      ...initial,
      revision: 'rev-live-resumed',
      state: 'enabled',
    }))
    const api = createApi({
      getSchedule: vi.fn(async () => initial),
      pauseSchedule,
      resumeSchedule,
    })

    render(<ScheduleHarness api={api} />)
    const section = await screen.findByLabelText('Jobright internslist schedule')

    expect(within(section).getByText(/Persisted:\s*Enabled/)).toBeInTheDocument()
    expect(within(section).getByText(/Last occurrence: completed/)).toBeInTheDocument()
    expect(within(section).getByText(/Last scheduled run: completed \(scheduled\)/)).toBeInTheDocument()

    fireEvent.click(within(section).getByRole('button', { name: 'Pause schedule' }))
    await waitFor(() => {
      expect(pauseSchedule).toHaveBeenCalledWith({
        connectorInstanceId: instance.id,
        expectedRevision: 'rev-live',
      })
    })
    expect(await within(section).findByText(/Persisted:\s*Paused/)).toBeInTheDocument()

    fireEvent.click(within(section).getByRole('button', { name: 'Resume schedule' }))
    await waitFor(() => {
      expect(resumeSchedule).toHaveBeenCalledWith({
        connectorInstanceId: instance.id,
        expectedRevision: 'rev-live-paused',
      })
    })
    expect(await within(section).findByText(/Persisted:\s*Enabled/)).toBeInTheDocument()
  })

  it('shows connector-disabled schedule state and never uses schedule dispatch helpers', async () => {
    const api = createApi({
      getSchedule: vi.fn(async () => createSchedule({ state: 'enabled' })),
    })

    function DisabledHarness() {
      const {
        capabilityLoadError,
        scheduleStates,
        schedulingCapability,
      } = useConnectorInstanceSchedules({
        connectorScheduleApi: api,
        instances: [{ ...instance, enabled: false }],
        workspaceId: 'workspace-1',
      })
      const state = scheduleStates[instance.id]
      if (!state || state.isLoading) {
        return <div role="status">Loading schedule</div>
      }

      return (
        <ConnectorScheduleControls
          capability={schedulingCapability}
          capabilityLoadError={capabilityLoadError}
          canonical={state.canonical}
          connectorDisplayName={instance.displayName}
          connectorEnabled={false}
          draft={state.draft}
          isDirty={false}
          isLoading={state.isLoading}
          isSaving={state.isSaving}
          loadFailure={state.loadFailure}
          statusMessage={state.statusMessage}
          statusTone={state.statusTone}
          validationField={state.validationField}
          onDiscard={vi.fn()}
          onDraftChange={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onSave={vi.fn()}
        />
      )
    }

    render(<DisabledHarness />)
    const section = await screen.findByLabelText('Jobright internslist schedule')

    expect(within(section).getByText(/Persisted:\s*Enabled/)).toBeInTheDocument()
    expect(within(section).getByText('This connector is disabled.', { exact: false })).toBeInTheDocument()
    expect(within(section).getByText(/Saved schedules stay paused from dispatch/)).toBeInTheDocument()
    expect('dispatchDue' in api).toBe(false)
    expect('listAudit' in api).toBe(false)
    expect('listOccurrences' in api).toBe(false)
  })
})
