import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectorScheduleSummary } from '@sparxie/sdk'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import {
  availableSchedulingCapability,
  schedulableInstance,
  scheduleSummary,
} from './connector-schedule.test-helpers'
import { useConnectorInstanceSchedules } from './useConnectorInstanceSchedules'

describe('connector schedule load ownership', () => {
  it('refuses save/pause/resume while schedule GET is still loading', async () => {
    let resolveSchedule: (value: ConnectorScheduleSummary | null) => void
    const pendingSchedule = new Promise<ConnectorScheduleSummary | null>((resolve) => {
      resolveSchedule = resolve
    })
    const upsertSchedule = vi.fn(async () => scheduleSummary())
    const pauseSchedule = vi.fn(async () => scheduleSummary({ state: 'paused' }))
    const resumeSchedule = vi.fn(async () => scheduleSummary())
    const deleteSchedule = vi.fn(async () => undefined)
    const api: ConnectorScheduleUiApi = {
      getCapabilities: vi.fn(async () => ({ connectorScheduling: availableSchedulingCapability })),
      getSchedule: vi.fn(() => pendingSchedule),
      upsertSchedule,
      pauseSchedule,
      resumeSchedule,
      deleteSchedule,
    }

    const { result } = renderHook(() => useConnectorInstanceSchedules({
      connectorScheduleApi: api,
      instances: [schedulableInstance],
      workspaceId: 'workspace-1',
    }))

    await waitFor(() => {
      expect(result.current.scheduleStates[schedulableInstance.id]?.isLoading).toBe(true)
    })

    await act(async () => {
      await result.current.saveConnectorSchedule(schedulableInstance)
      await result.current.pauseConnectorSchedule(schedulableInstance)
      await result.current.resumeConnectorSchedule(schedulableInstance)
    })

    expect(upsertSchedule).not.toHaveBeenCalled()
    expect(pauseSchedule).not.toHaveBeenCalled()
    expect(resumeSchedule).not.toHaveBeenCalled()
    expect(deleteSchedule).not.toHaveBeenCalled()

    await act(async () => {
      resolveSchedule!(null)
    })

    await waitFor(() => {
      expect(result.current.scheduleStates[schedulableInstance.id]?.isLoading).toBe(false)
    })
  })

  it('does not let a removed-and-readded instance stale GET replace a newer schedule load', async () => {
    const getResolvers: Array<(value: ConnectorScheduleSummary | null) => void> = []
    const getSchedule = vi.fn(() => new Promise<ConnectorScheduleSummary | null>((resolve) => {
      getResolvers.push(resolve)
    }))
    const api: ConnectorScheduleUiApi = {
      getCapabilities: vi.fn(async () => ({ connectorScheduling: availableSchedulingCapability })),
      getSchedule,
      upsertSchedule: vi.fn(async () => scheduleSummary()),
      pauseSchedule: vi.fn(async () => scheduleSummary({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => scheduleSummary()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    const { result, rerender } = renderHook(
      ({ instances }) => useConnectorInstanceSchedules({
        connectorScheduleApi: api,
        instances,
        workspaceId: 'workspace-1',
      }),
      { initialProps: { instances: [schedulableInstance] } },
    )

    await waitFor(() => {
      expect(getSchedule).toHaveBeenCalledTimes(1)
      expect(result.current.scheduleStates[schedulableInstance.id]?.isLoading).toBe(true)
    })

    rerender({ instances: [] })
    rerender({ instances: [schedulableInstance] })

    await waitFor(() => {
      expect(getSchedule).toHaveBeenCalledTimes(2)
      expect(result.current.scheduleStates[schedulableInstance.id]?.isLoading).toBe(true)
    })

    const newer = scheduleSummary({
      revision: 'rev-newer',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'America/New_York',
    })
    const stale = scheduleSummary({
      revision: 'rev-stale',
      cadence: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    })

    await act(async () => {
      getResolvers[1]!(newer)
    })
    await waitFor(() => {
      expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.revision).toBe('rev-newer')
      expect(result.current.scheduleStates[schedulableInstance.id]?.draft.timezone).toBe('America/New_York')
      expect(result.current.scheduleStates[schedulableInstance.id]?.isLoading).toBe(false)
    })

    await act(async () => {
      getResolvers[0]!(stale)
    })

    await waitFor(() => {
      expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.revision).toBe('rev-newer')
    })
    expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.cadence).toEqual({
      kind: 'interval',
      everyMinutes: 60,
    })
    expect(result.current.scheduleStates[schedulableInstance.id]?.draft.timezone).toBe('America/New_York')
    expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.revision).not.toBe('rev-stale')
  })

  it('does not issue schedule GET for a new workspace until that workspace capability resolves', async () => {
    const getScheduleA = vi.fn(async () => scheduleSummary({ revision: 'rev-a' }))
    const getCapabilitiesA = vi.fn(async () => ({ connectorScheduling: availableSchedulingCapability }))
    const apiA: ConnectorScheduleUiApi = {
      getCapabilities: getCapabilitiesA,
      getSchedule: getScheduleA,
      upsertSchedule: vi.fn(async () => scheduleSummary()),
      pauseSchedule: vi.fn(async () => scheduleSummary({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => scheduleSummary()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    let resolveCapabilitiesB: (value: { connectorScheduling: { available: false } }) => void
    const pendingCapabilitiesB = new Promise<{ connectorScheduling: { available: false } }>((resolve) => {
      resolveCapabilitiesB = resolve
    })
    const getCapabilitiesB = vi.fn(() => pendingCapabilitiesB)
    const getScheduleB = vi.fn(async () => scheduleSummary({ revision: 'rev-b' }))
    const apiB: ConnectorScheduleUiApi = {
      getCapabilities: getCapabilitiesB,
      getSchedule: getScheduleB,
      upsertSchedule: vi.fn(async () => scheduleSummary()),
      pauseSchedule: vi.fn(async () => scheduleSummary({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => scheduleSummary()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    const { result, rerender } = renderHook(
      ({ connectorScheduleApi, workspaceId }) => useConnectorInstanceSchedules({
        connectorScheduleApi,
        instances: [schedulableInstance],
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
      expect(result.current.schedulingCapability).toEqual(availableSchedulingCapability)
      expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.revision).toBe('rev-a')
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
    const pendingCapabilitiesC = new Promise<{ connectorScheduling: typeof availableSchedulingCapability }>((_resolve, reject) => {
      rejectCapabilitiesC = reject
    })
    const getCapabilitiesC = vi.fn(() => pendingCapabilitiesC)
    const getScheduleC = vi.fn(async () => scheduleSummary({ revision: 'rev-c' }))
    const apiC: ConnectorScheduleUiApi = {
      getCapabilities: getCapabilitiesC,
      getSchedule: getScheduleC,
      upsertSchedule: vi.fn(async () => scheduleSummary()),
      pauseSchedule: vi.fn(async () => scheduleSummary({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => scheduleSummary()),
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
      getCapabilities: vi.fn(async () => ({ connectorScheduling: availableSchedulingCapability })),
      getSchedule,
      upsertSchedule,
      pauseSchedule: vi.fn(async () => scheduleSummary({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => scheduleSummary()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    const { result, rerender } = renderHook(
      ({ instances }) => useConnectorInstanceSchedules({
        connectorScheduleApi: api,
        instances,
        workspaceId: 'workspace-1',
      }),
      { initialProps: { instances: [schedulableInstance] } },
    )

    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(1))
    await act(async () => {
      getResolvers[0]!(scheduleSummary({
        revision: 'rev-initial',
        cadence: { kind: 'interval', everyMinutes: 30 },
      }))
    })
    await waitFor(() => {
      expect(result.current.scheduleStates[schedulableInstance.id]?.isLoading).toBe(false)
      expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.revision).toBe('rev-initial')
    })

    await act(async () => {
      result.current.updateScheduleDraft(schedulableInstance.id, {
        mode: 'preset',
        presetId: 'interval-60',
      })
    })
    await act(async () => {
      void result.current.saveConnectorSchedule(schedulableInstance)
    })
    await waitFor(() => expect(upsertSchedule).toHaveBeenCalledTimes(1))
    expect(result.current.scheduleStates[schedulableInstance.id]?.isSaving).toBe(true)

    rerender({ instances: [] })
    rerender({ instances: [schedulableInstance] })

    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(2))
    const newer = scheduleSummary({
      revision: 'rev-from-reload',
      cadence: { kind: 'daily', localTime: '09:00' },
      timezone: 'America/Chicago',
    })
    await act(async () => {
      getResolvers[1]!(newer)
    })
    await waitFor(() => {
      expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.revision).toBe('rev-from-reload')
      expect(result.current.scheduleStates[schedulableInstance.id]?.draft.timezone).toBe('America/Chicago')
      expect(result.current.scheduleStates[schedulableInstance.id]?.isLoading).toBe(false)
    })

    await act(async () => {
      resolveUpsert!(scheduleSummary({
        revision: 'rev-stale-mutation',
        cadence: { kind: 'interval', everyMinutes: 60 },
        timezone: 'UTC',
      }))
    })

    await waitFor(() => {
      expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.revision).toBe('rev-from-reload')
    })
    expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.cadence).toEqual({
      kind: 'daily',
      localTime: '09:00',
    })
    expect(result.current.scheduleStates[schedulableInstance.id]?.draft.timezone).toBe('America/Chicago')
    expect(result.current.scheduleStates[schedulableInstance.id]?.statusMessage).not.toBe('Schedule saved.')
    expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.revision).not.toBe('rev-stale-mutation')
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
      getCapabilities: vi.fn(async () => ({ connectorScheduling: availableSchedulingCapability })),
      getSchedule,
      upsertSchedule: vi.fn(async () => scheduleSummary()),
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
      { initialProps: { instances: [schedulableInstance] } },
    )

    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(1))
    await act(async () => {
      getResolvers[0]!(scheduleSummary({
        revision: 'rev-initial',
        state: start === 'resume' ? 'paused' : 'enabled',
      }))
    })
    await waitFor(() => {
      expect(result.current.scheduleStates[schedulableInstance.id]?.isLoading).toBe(false)
    })

    await act(async () => {
      if (start === 'pause') {
        void result.current.pauseConnectorSchedule(schedulableInstance)
      } else if (start === 'resume') {
        void result.current.resumeConnectorSchedule(schedulableInstance)
      } else {
        result.current.updateScheduleDraft(schedulableInstance.id, { mode: 'manual' })
      }
    })

    if (start === 'delete') {
      await waitFor(() => {
        expect(result.current.scheduleStates[schedulableInstance.id]?.draft.mode).toBe('manual')
      })
      await act(async () => {
        void result.current.saveConnectorSchedule(schedulableInstance)
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
    rerender({ instances: [schedulableInstance] })
    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(2))

    const newer = scheduleSummary({
      revision: 'rev-from-reload',
      cadence: { kind: 'weekly', dayOfWeek: 2, localTime: '08:00' },
      timezone: 'Europe/Paris',
      state: 'enabled',
    })
    await act(async () => {
      getResolvers[1]!(newer)
    })
    await waitFor(() => {
      expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.revision).toBe('rev-from-reload')
    })

    await act(async () => {
      if (outcome === 'success') {
        resolveMutation!(scheduleSummary({
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
      expect(result.current.scheduleStates[schedulableInstance.id]?.canonical?.revision).toBe('rev-from-reload')
    })
    const state = result.current.scheduleStates[schedulableInstance.id]!
    expect(state.draft.timezone).toBe('Europe/Paris')
    expect(state.statusTone).not.toBe('error')
    if (successMessage) {
      expect(state.statusMessage).not.toBe(successMessage)
    }
    expect(state.statusMessage ?? '').not.toMatch(/stale mutation failed|delete failed/i)
    expect(state.canonical?.revision).not.toBe('rev-stale-mutation')
  })

  it('ignores late schedule capability responses after workspace identity changes', async () => {
    let resolveFirstCapabilities: (value: { connectorScheduling: { available: false } }) => void
    const firstCapabilities = new Promise<{ connectorScheduling: { available: false } }>((resolve) => {
      resolveFirstCapabilities = resolve
    })
    const getScheduleA = vi.fn(async () => scheduleSummary({ revision: 'rev-a' }))
    const getCapabilitiesA = vi.fn(() => firstCapabilities)
    const apiA: ConnectorScheduleUiApi = {
      getCapabilities: getCapabilitiesA,
      getSchedule: getScheduleA,
      upsertSchedule: vi.fn(async () => scheduleSummary()),
      pauseSchedule: vi.fn(async () => scheduleSummary({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => scheduleSummary()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    const getScheduleB = vi.fn(async () => scheduleSummary({ revision: 'rev-b' }))
    const getCapabilitiesB = vi.fn(async () => ({ connectorScheduling: availableSchedulingCapability }))
    const apiB: ConnectorScheduleUiApi = {
      getCapabilities: getCapabilitiesB,
      getSchedule: getScheduleB,
      upsertSchedule: vi.fn(async () => scheduleSummary()),
      pauseSchedule: vi.fn(async () => scheduleSummary({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => scheduleSummary()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    const { result, rerender } = renderHook(
      ({ connectorScheduleApi, workspaceId }) => useConnectorInstanceSchedules({
        connectorScheduleApi,
        instances: [schedulableInstance],
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
      expect(getCapabilitiesA).toHaveBeenCalled()
    })

    rerender({
      connectorScheduleApi: apiB,
      workspaceId: 'workspace-b',
    })

    await waitFor(() => {
      expect(getCapabilitiesB).toHaveBeenCalled()
      expect(result.current.schedulingCapability).toEqual(availableSchedulingCapability)
    })
    expect(getScheduleB).toHaveBeenCalled()

    await act(async () => {
      resolveFirstCapabilities!({ connectorScheduling: { available: false } })
    })

    await waitFor(() => {
      expect(result.current.schedulingCapability).toEqual(availableSchedulingCapability)
    })
    expect(getScheduleA).not.toHaveBeenCalled()
    expect(result.current.schedulingCapability).not.toEqual({ available: false })
  })

  it('saves a preset schedule and reloads the persisted cadence after instance remount', async () => {
    const saved = scheduleSummary({
      revision: 'rev-saved',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })
    const upsertSchedule = vi.fn(async () => saved)
    const getSchedule = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(saved)
    const api: ConnectorScheduleUiApi = {
      getCapabilities: vi.fn(async () => ({ connectorScheduling: availableSchedulingCapability })),
      getSchedule,
      upsertSchedule,
      pauseSchedule: vi.fn(async () => scheduleSummary({ state: 'paused' })),
      resumeSchedule: vi.fn(async () => scheduleSummary()),
      deleteSchedule: vi.fn(async () => undefined),
    }

    const first = renderHook(() => useConnectorInstanceSchedules({
      connectorScheduleApi: api,
      instances: [schedulableInstance],
      workspaceId: 'workspace-1',
    }))

    await waitFor(() => {
      expect(first.result.current.scheduleStates[schedulableInstance.id]?.isLoading).toBe(false)
    })

    await act(async () => {
      first.result.current.updateScheduleDraft(schedulableInstance.id, {
        mode: 'preset',
        presetId: 'interval-60',
        timezone: 'UTC',
        state: 'enabled',
      })
    })
    await act(async () => {
      await first.result.current.saveConnectorSchedule(schedulableInstance)
    })

    expect(upsertSchedule).toHaveBeenCalledWith({
      connectorInstanceId: schedulableInstance.id,
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    })
    expect(first.result.current.scheduleStates[schedulableInstance.id]?.canonical?.cadence).toEqual({
      kind: 'interval',
      everyMinutes: 60,
    })

    first.unmount()
    const remounted = renderHook(() => useConnectorInstanceSchedules({
      connectorScheduleApi: api,
      instances: [schedulableInstance],
      workspaceId: 'workspace-1',
    }))

    await waitFor(() => {
      expect(remounted.result.current.scheduleStates[schedulableInstance.id]?.canonical?.revision)
        .toBe('rev-saved')
    })
    expect(remounted.result.current.scheduleStates[schedulableInstance.id]?.canonical?.state).toBe('enabled')
    expect(remounted.result.current.scheduleStates[schedulableInstance.id]?.canonical?.cadence).toEqual({
      kind: 'interval',
      everyMinutes: 60,
    })
    expect(getSchedule).toHaveBeenCalledTimes(2)
  })
})
