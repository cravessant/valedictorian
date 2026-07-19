import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectorScheduleSummary } from 'sparxie'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import type { ConnectorSettingsInstance } from './connector-settings.types'
import { useConnectorInstanceSchedules } from './useConnectorInstanceSchedules'

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

describe('connector schedule load ownership', () => {
  it('refuses save/pause/resume while schedule GET is still loading', async () => {
    let resolveSchedule: (value: ConnectorScheduleSummary | null) => void
    const pendingSchedule = new Promise<ConnectorScheduleSummary | null>((resolve) => {
      resolveSchedule = resolve
    })
    const upsertSchedule = vi.fn(async () => createSchedule())
    const pauseSchedule = vi.fn(async () => createSchedule({ state: 'paused' }))
    const resumeSchedule = vi.fn(async () => createSchedule())
    const deleteSchedule = vi.fn(async () => undefined)
    const api: ConnectorScheduleUiApi = {
      getCapabilities: vi.fn(async () => ({ connectorScheduling: availableCapability })),
      getSchedule: vi.fn(() => pendingSchedule),
      upsertSchedule,
      pauseSchedule,
      resumeSchedule,
      deleteSchedule,
    }

    const { result } = renderHook(() => useConnectorInstanceSchedules({
      connectorScheduleApi: api,
      instances: [instance],
      workspaceId: 'workspace-1',
    }))

    await waitFor(() => {
      expect(result.current.scheduleStates[instance.id]?.isLoading).toBe(true)
    })

    await act(async () => {
      await result.current.saveConnectorSchedule(instance)
      await result.current.pauseConnectorSchedule(instance)
      await result.current.resumeConnectorSchedule(instance)
    })

    expect(upsertSchedule).not.toHaveBeenCalled()
    expect(pauseSchedule).not.toHaveBeenCalled()
    expect(resumeSchedule).not.toHaveBeenCalled()
    expect(deleteSchedule).not.toHaveBeenCalled()

    await act(async () => {
      resolveSchedule!(null)
    })

    await waitFor(() => {
      expect(result.current.scheduleStates[instance.id]?.isLoading).toBe(false)
    })
  })

  it('does not let a removed-and-readded instance stale GET replace a newer schedule load', async () => {
    const getResolvers: Array<(value: ConnectorScheduleSummary | null) => void> = []
    const getSchedule = vi.fn(() => new Promise<ConnectorScheduleSummary | null>((resolve) => {
      getResolvers.push(resolve)
    }))
    const api: ConnectorScheduleUiApi = {
      getCapabilities: vi.fn(async () => ({ connectorScheduling: availableCapability })),
      getSchedule,
      upsertSchedule: vi.fn(async () => createSchedule()),
      pauseSchedule: vi.fn(async () => createSchedule({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => createSchedule()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    const { result, rerender } = renderHook(
      ({ instances }) => useConnectorInstanceSchedules({
        connectorScheduleApi: api,
        instances,
        workspaceId: 'workspace-1',
      }),
      { initialProps: { instances: [instance] } },
    )

    await waitFor(() => {
      expect(getSchedule).toHaveBeenCalledTimes(1)
      expect(result.current.scheduleStates[instance.id]?.isLoading).toBe(true)
    })

    rerender({ instances: [] })
    rerender({ instances: [instance] })

    await waitFor(() => {
      expect(getSchedule).toHaveBeenCalledTimes(2)
      expect(result.current.scheduleStates[instance.id]?.isLoading).toBe(true)
    })

    const newer = createSchedule({
      revision: 'rev-newer',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'America/New_York',
    })
    const stale = createSchedule({
      revision: 'rev-stale',
      cadence: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    })

    await act(async () => {
      getResolvers[1]!(newer)
    })
    await waitFor(() => {
      expect(result.current.scheduleStates[instance.id]?.canonical?.revision).toBe('rev-newer')
      expect(result.current.scheduleStates[instance.id]?.draft.timezone).toBe('America/New_York')
      expect(result.current.scheduleStates[instance.id]?.isLoading).toBe(false)
    })

    await act(async () => {
      getResolvers[0]!(stale)
    })

    await waitFor(() => {
      expect(result.current.scheduleStates[instance.id]?.canonical?.revision).toBe('rev-newer')
    })
    expect(result.current.scheduleStates[instance.id]?.canonical?.cadence).toEqual({
      kind: 'interval',
      everyMinutes: 60,
    })
    expect(result.current.scheduleStates[instance.id]?.draft.timezone).toBe('America/New_York')
    expect(result.current.scheduleStates[instance.id]?.canonical?.revision).not.toBe('rev-stale')
  })

  it('does not issue schedule GET for a new workspace until that workspace capability resolves', async () => {
    const getScheduleA = vi.fn(async () => createSchedule({ revision: 'rev-a' }))
    const getCapabilitiesA = vi.fn(async () => ({ connectorScheduling: availableCapability }))
    const apiA: ConnectorScheduleUiApi = {
      getCapabilities: getCapabilitiesA,
      getSchedule: getScheduleA,
      upsertSchedule: vi.fn(async () => createSchedule()),
      pauseSchedule: vi.fn(async () => createSchedule({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => createSchedule()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    let resolveCapabilitiesB: (value: { connectorScheduling: { available: false } }) => void
    const pendingCapabilitiesB = new Promise<{ connectorScheduling: { available: false } }>((resolve) => {
      resolveCapabilitiesB = resolve
    })
    const getCapabilitiesB = vi.fn(() => pendingCapabilitiesB)
    const getScheduleB = vi.fn(async () => createSchedule({ revision: 'rev-b' }))
    const apiB: ConnectorScheduleUiApi = {
      getCapabilities: getCapabilitiesB,
      getSchedule: getScheduleB,
      upsertSchedule: vi.fn(async () => createSchedule()),
      pauseSchedule: vi.fn(async () => createSchedule({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => createSchedule()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    const { result, rerender } = renderHook(
      ({ connectorScheduleApi, workspaceId }) => useConnectorInstanceSchedules({
        connectorScheduleApi,
        instances: [instance],
        workspaceId,
      }),
      {
        initialProps: {
          connectorScheduleApi: apiA,
          workspaceId: 'workspace-a',
        },
      },
    )

    await waitFor(() => {
      expect(getScheduleA).toHaveBeenCalledTimes(1)
      expect(result.current.schedulingCapability).toEqual(availableCapability)
      expect(result.current.scheduleStates[instance.id]?.canonical?.revision).toBe('rev-a')
    })

    rerender({
      connectorScheduleApi: apiB,
      workspaceId: 'workspace-b',
    })

    await waitFor(() => {
      expect(getCapabilitiesB).toHaveBeenCalled()
    })
    expect(getScheduleB).not.toHaveBeenCalled()
    expect(result.current.schedulingCapability).toBeNull()
    expect(result.current.capabilityLoadError).toBeNull()

    await act(async () => {
      resolveCapabilitiesB!({ connectorScheduling: { available: false } })
    })

    await waitFor(() => {
      expect(result.current.schedulingCapability).toEqual({ available: false })
    })
    expect(getScheduleB).not.toHaveBeenCalled()

    let rejectCapabilitiesC: (reason?: unknown) => void
    const pendingCapabilitiesC = new Promise<{ connectorScheduling: typeof availableCapability }>((_resolve, reject) => {
      rejectCapabilitiesC = reject
    })
    const getCapabilitiesC = vi.fn(() => pendingCapabilitiesC)
    const getScheduleC = vi.fn(async () => createSchedule({ revision: 'rev-c' }))
    const apiC: ConnectorScheduleUiApi = {
      getCapabilities: getCapabilitiesC,
      getSchedule: getScheduleC,
      upsertSchedule: vi.fn(async () => createSchedule()),
      pauseSchedule: vi.fn(async () => createSchedule({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => createSchedule()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    rerender({
      connectorScheduleApi: apiC,
      workspaceId: 'workspace-c',
    })

    await waitFor(() => {
      expect(getCapabilitiesC).toHaveBeenCalled()
    })
    expect(getScheduleC).not.toHaveBeenCalled()

    await act(async () => {
      rejectCapabilitiesC!(new Error('capabilities unavailable'))
    })

    await waitFor(() => {
      expect(result.current.capabilityLoadError?.message).toMatch(/could not be loaded/i)
    })
    expect(getScheduleC).not.toHaveBeenCalled()
    expect(result.current.schedulingCapability).toBeNull()
  })

  it('does not let a stale save mutation replace a newer remove/re-add schedule load', async () => {
    const getResolvers: Array<(value: ConnectorScheduleSummary | null) => void> = []
    const getSchedule = vi.fn(() => new Promise<ConnectorScheduleSummary | null>((resolve) => {
      getResolvers.push(resolve)
    }))
    let resolveUpsert: (value: ConnectorScheduleSummary) => void
    const pendingUpsert = new Promise<ConnectorScheduleSummary>((resolve) => {
      resolveUpsert = resolve
    })
    const upsertSchedule = vi.fn(() => pendingUpsert)
    const api: ConnectorScheduleUiApi = {
      getCapabilities: vi.fn(async () => ({ connectorScheduling: availableCapability })),
      getSchedule,
      upsertSchedule,
      pauseSchedule: vi.fn(async () => createSchedule({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => createSchedule()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    const { result, rerender } = renderHook(
      ({ instances }) => useConnectorInstanceSchedules({
        connectorScheduleApi: api,
        instances,
        workspaceId: 'workspace-1',
      }),
      { initialProps: { instances: [instance] } },
    )

    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(1))
    await act(async () => {
      getResolvers[0]!(createSchedule({
        revision: 'rev-initial',
        cadence: { kind: 'interval', everyMinutes: 30 },
      }))
    })
    await waitFor(() => {
      expect(result.current.scheduleStates[instance.id]?.isLoading).toBe(false)
      expect(result.current.scheduleStates[instance.id]?.canonical?.revision).toBe('rev-initial')
    })

    await act(async () => {
      result.current.updateScheduleDraft(instance.id, {
        mode: 'preset',
        presetId: 'interval-60',
      })
    })
    await act(async () => {
      void result.current.saveConnectorSchedule(instance)
    })
    await waitFor(() => expect(upsertSchedule).toHaveBeenCalledTimes(1))
    expect(result.current.scheduleStates[instance.id]?.isSaving).toBe(true)

    rerender({ instances: [] })
    rerender({ instances: [instance] })

    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(2))
    const newer = createSchedule({
      revision: 'rev-from-reload',
      cadence: { kind: 'daily', localTime: '09:00' },
      timezone: 'America/Chicago',
    })
    await act(async () => {
      getResolvers[1]!(newer)
    })
    await waitFor(() => {
      expect(result.current.scheduleStates[instance.id]?.canonical?.revision).toBe('rev-from-reload')
      expect(result.current.scheduleStates[instance.id]?.draft.timezone).toBe('America/Chicago')
      expect(result.current.scheduleStates[instance.id]?.isLoading).toBe(false)
    })

    await act(async () => {
      resolveUpsert!(createSchedule({
        revision: 'rev-stale-mutation',
        cadence: { kind: 'interval', everyMinutes: 60 },
        timezone: 'UTC',
      }))
    })

    await waitFor(() => {
      expect(result.current.scheduleStates[instance.id]?.canonical?.revision).toBe('rev-from-reload')
    })
    expect(result.current.scheduleStates[instance.id]?.canonical?.cadence).toEqual({
      kind: 'daily',
      localTime: '09:00',
    })
    expect(result.current.scheduleStates[instance.id]?.draft.timezone).toBe('America/Chicago')
    expect(result.current.scheduleStates[instance.id]?.statusMessage).not.toBe('Schedule saved.')
    expect(result.current.scheduleStates[instance.id]?.canonical?.revision).not.toBe('rev-stale-mutation')
  })

  it.each([
    {
      name: 'pause success',
      start: 'pause' as const,
      outcome: 'success' as const,
      successMessage: 'Schedule paused.',
    },
    {
      name: 'resume success',
      start: 'resume' as const,
      outcome: 'success' as const,
      successMessage: 'Schedule resumed.',
    },
    {
      name: 'manual delete success',
      start: 'delete' as const,
      outcome: 'success' as const,
      successMessage: 'Automatic schedule removed.',
    },
    {
      name: 'pause error',
      start: 'pause' as const,
      outcome: 'error' as const,
      successMessage: null,
    },
    {
      name: 'resume error',
      start: 'resume' as const,
      outcome: 'error' as const,
      successMessage: null,
    },
    {
      name: 'manual delete error',
      start: 'delete' as const,
      outcome: 'error' as const,
      successMessage: null,
    },
  ])('does not let a stale $name mutation replace a newer remove/re-add schedule load', async ({
    start,
    outcome,
    successMessage,
  }) => {
    const getResolvers: Array<(value: ConnectorScheduleSummary | null) => void> = []
    const getSchedule = vi.fn(() => new Promise<ConnectorScheduleSummary | null>((resolve) => {
      getResolvers.push(resolve)
    }))
    let resolveMutation: (value: ConnectorScheduleSummary) => void
    let rejectMutation: (reason?: unknown) => void
    const pendingMutation = new Promise<ConnectorScheduleSummary>((resolve, reject) => {
      resolveMutation = resolve
      rejectMutation = reject
    })
    const pauseSchedule = vi.fn(() => pendingMutation)
    const resumeSchedule = vi.fn(() => pendingMutation)
    const deleteSchedule = vi.fn(async () => {
      await pendingMutation
    })

    const api: ConnectorScheduleUiApi = {
      getCapabilities: vi.fn(async () => ({ connectorScheduling: availableCapability })),
      getSchedule,
      upsertSchedule: vi.fn(async () => createSchedule()),
      pauseSchedule,
      resumeSchedule,
      deleteSchedule,
    }

    const { result, rerender } = renderHook(
      ({ instances }) => useConnectorInstanceSchedules({
        connectorScheduleApi: api,
        instances,
        workspaceId: 'workspace-1',
      }),
      { initialProps: { instances: [instance] } },
    )

    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(1))
    await act(async () => {
      getResolvers[0]!(createSchedule({
        revision: 'rev-initial',
        state: start === 'resume' ? 'paused' : 'enabled',
      }))
    })
    await waitFor(() => {
      expect(result.current.scheduleStates[instance.id]?.isLoading).toBe(false)
    })

    await act(async () => {
      if (start === 'pause') {
        void result.current.pauseConnectorSchedule(instance)
      } else if (start === 'resume') {
        void result.current.resumeConnectorSchedule(instance)
      } else {
        result.current.updateScheduleDraft(instance.id, { mode: 'manual' })
      }
    })

    if (start === 'delete') {
      await waitFor(() => {
        expect(result.current.scheduleStates[instance.id]?.draft.mode).toBe('manual')
      })
      await act(async () => {
        void result.current.saveConnectorSchedule(instance)
      })
    }

    await waitFor(() => {
      if (start === 'pause') {
        expect(pauseSchedule).toHaveBeenCalledTimes(1)
      } else if (start === 'resume') {
        expect(resumeSchedule).toHaveBeenCalledTimes(1)
      } else {
        expect(deleteSchedule).toHaveBeenCalledTimes(1)
      }
    })

    rerender({ instances: [] })
    rerender({ instances: [instance] })
    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(2))

    const newer = createSchedule({
      revision: 'rev-from-reload',
      cadence: { kind: 'weekly', dayOfWeek: 2, localTime: '08:00' },
      timezone: 'Europe/Paris',
      state: 'enabled',
    })
    await act(async () => {
      getResolvers[1]!(newer)
    })
    await waitFor(() => {
      expect(result.current.scheduleStates[instance.id]?.canonical?.revision).toBe('rev-from-reload')
    })

    await act(async () => {
      if (outcome === 'success') {
        resolveMutation!(createSchedule({
          revision: 'rev-stale-mutation',
          state: start === 'pause' ? 'paused' : 'enabled',
          cadence: { kind: 'interval', everyMinutes: 15 },
          timezone: 'UTC',
        }))
      } else {
        rejectMutation!(new Error('stale mutation failed'))
      }
    })

    await waitFor(() => {
      expect(result.current.scheduleStates[instance.id]?.canonical?.revision).toBe('rev-from-reload')
    })
    const state = result.current.scheduleStates[instance.id]!
    expect(state.draft.timezone).toBe('Europe/Paris')
    expect(state.statusTone).not.toBe('error')
    if (successMessage) {
      expect(state.statusMessage).not.toBe(successMessage)
    }
    expect(state.statusMessage ?? '').not.toMatch(/stale mutation failed|delete failed/i)
    expect(state.canonical?.revision).not.toBe('rev-stale-mutation')
  })
})
