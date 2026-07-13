import { describe, expect, it, vi } from 'vitest'
import {
  createLocalBackendSupervisor,
  type SupervisedBackendListener,
} from './local-backend-supervisor'

describe('local backend supervisor', () => {
  it('recovers a listener that stays open when its health probe times out', async () => {
    vi.useFakeTimers()
    const failedClose = vi.fn(async () => undefined)
    const listeners = ['http://127.0.0.1:50001', 'http://127.0.0.1:50002']
      .map((origin, index): SupervisedBackendListener => ({
        close: index === 0 ? failedClose : vi.fn(async () => undefined),
        onClosed: () => () => undefined,
        onError: () => () => undefined,
        origin,
      }))
    let verification = 0
    const options = {
      liveness: { failureThreshold: 1, intervalMs: 100, timeoutMs: 25 },
      restart: { baseDelayMs: 10, maxAttempts: 2, maxDelayMs: 20 },
      startListener: vi.fn(async () => listeners.shift()!),
      verifyOrigin: vi.fn(async () => {
        verification += 1
        if (verification === 2) return new Promise<boolean>(() => undefined)
        return true
      }),
    }
    const supervisor = createLocalBackendSupervisor(options)

    await supervisor.start()
    await vi.advanceTimersByTimeAsync(125)

    expect(supervisor.getState()).toEqual({ status: 'unavailable' })
    expect(failedClose).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10)
    expect(supervisor.getState()).toEqual({
      origin: 'http://127.0.0.1:50002', status: 'available',
    })
    vi.useRealTimers()
  })

  it('uses the configured clock for deterministic liveness scheduling', async () => {
    let scheduled!: () => void
    const clock = {
      clearTimeout: vi.fn(),
      setTimeout: vi.fn((callback: () => void) => {
        scheduled = callback
        return 1 as unknown as ReturnType<typeof setTimeout>
      }),
    }
    const verifyOrigin = vi.fn(async () => true)
    const options = {
      clock,
      liveness: { failureThreshold: 2, intervalMs: 100, timeoutMs: 25 },
      restart: { baseDelayMs: 10, maxAttempts: 2, maxDelayMs: 20 },
      startListener: vi.fn(async (): Promise<SupervisedBackendListener> => ({
        close: vi.fn(async () => undefined),
        onClosed: () => () => undefined,
        onError: () => () => undefined,
        origin: 'http://127.0.0.1:50101',
      })),
      verifyOrigin,
    }
    const supervisor = createLocalBackendSupervisor(options)

    await supervisor.start()
    expect(clock.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 100)
    scheduled()
    await vi.waitFor(() => expect(verifyOrigin).toHaveBeenCalledTimes(2))
  })

  it('keeps availability after one intermittent probe failure below threshold', async () => {
    vi.useFakeTimers()
    const close = vi.fn(async () => undefined)
    let verification = 0
    const supervisor = createLocalBackendSupervisor({
      liveness: { failureThreshold: 2, intervalMs: 100, timeoutMs: 25 },
      restart: { baseDelayMs: 10, maxAttempts: 2, maxDelayMs: 20 },
      startListener: vi.fn(async (): Promise<SupervisedBackendListener> => ({
        close,
        onClosed: () => () => undefined,
        onError: () => () => undefined,
        origin: 'http://127.0.0.1:50111',
      })),
      verifyOrigin: vi.fn(async () => {
        verification += 1
        return verification !== 2
      }),
    })

    await supervisor.start()
    await vi.advanceTimersByTimeAsync(100)

    expect(supervisor.getState()).toEqual({
      origin: 'http://127.0.0.1:50111', status: 'available',
    })
    expect(close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(supervisor.getState()).toEqual({
      origin: 'http://127.0.0.1:50111', status: 'available',
    })
    vi.useRealTimers()
  })

  it('ignores a late probe failure after a newer verified origin is available', async () => {
    vi.useFakeTimers()
    let fail!: () => void
    let finishStaleProbe!: (healthy: boolean) => void
    const recoveredClose = vi.fn(async () => undefined)
    const listeners: SupervisedBackendListener[] = [
      {
        close: vi.fn(async () => undefined),
        onClosed: () => () => undefined,
        onError(listener) { fail = listener; return () => undefined },
        origin: 'http://127.0.0.1:50201',
      },
      {
        close: recoveredClose,
        onClosed: () => () => undefined,
        onError: () => () => undefined,
        origin: 'http://127.0.0.1:50202',
      },
    ]
    let verification = 0
    const supervisor = createLocalBackendSupervisor({
      liveness: { failureThreshold: 1, intervalMs: 100, timeoutMs: 1_000 },
      restart: { baseDelayMs: 10, maxAttempts: 2, maxDelayMs: 20 },
      startListener: async () => listeners.shift()!,
      verifyOrigin: vi.fn(async () => {
        verification += 1
        if (verification === 2) {
          return await new Promise<boolean>((resolve) => { finishStaleProbe = resolve })
        }
        return true
      }),
    })

    await supervisor.start()
    await vi.advanceTimersByTimeAsync(100)
    fail()
    await supervisor.retry()
    finishStaleProbe(false)
    await Promise.resolve()

    expect(recoveredClose).not.toHaveBeenCalled()
    expect(supervisor.getState()).toEqual({
      origin: 'http://127.0.0.1:50202', status: 'available',
    })
    vi.useRealTimers()
  })

  it('resets the restart budget on manual retry after liveness loss exhausts it', async () => {
    vi.useFakeTimers()
    let verification = 0
    const startListener = vi.fn(async (): Promise<SupervisedBackendListener> => ({
      close: vi.fn(async () => undefined),
      onClosed: () => () => undefined,
      onError: () => () => undefined,
      origin: `http://127.0.0.1:${50300 + startListener.mock.calls.length}`,
    }))
    const supervisor = createLocalBackendSupervisor({
      liveness: { failureThreshold: 1, intervalMs: 100, timeoutMs: 25 },
      restart: { baseDelayMs: 10, maxAttempts: 1, maxDelayMs: 20 },
      startListener,
      verifyOrigin: vi.fn(async () => {
        verification += 1
        return verification === 1 || verification >= 4
      }),
    })

    await supervisor.start()
    await vi.advanceTimersByTimeAsync(125)
    expect(supervisor.getState()).toEqual({ status: 'unavailable' })
    await vi.advanceTimersByTimeAsync(10)
    expect(supervisor.getState()).toEqual({ status: 'unavailable' })
    expect(startListener).toHaveBeenCalledTimes(2)

    await supervisor.retry()
    expect(supervisor.getState()).toEqual({
      origin: 'http://127.0.0.1:50303', status: 'available',
    })
    expect(startListener).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('cancels in-flight liveness work on stop so late results cannot restart', async () => {
    vi.useFakeTimers()
    let finishProbe!: (healthy: boolean) => void
    const startListener = vi.fn(async (): Promise<SupervisedBackendListener> => ({
      close: vi.fn(async () => undefined),
      onClosed: () => () => undefined,
      onError: () => () => undefined,
      origin: 'http://127.0.0.1:50401',
    }))
    let verification = 0
    const supervisor = createLocalBackendSupervisor({
      liveness: { failureThreshold: 1, intervalMs: 100, timeoutMs: 1_000 },
      restart: { baseDelayMs: 10, maxAttempts: 2, maxDelayMs: 20 },
      startListener,
      verifyOrigin: vi.fn(async () => {
        verification += 1
        if (verification === 2) {
          return await new Promise<boolean>((resolve) => { finishProbe = resolve })
        }
        return true
      }),
    })

    await supervisor.start()
    await vi.advanceTimersByTimeAsync(100)
    await supervisor.stop()
    finishProbe(false)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(startListener).toHaveBeenCalledTimes(1)
    expect(supervisor.getState()).toEqual({ status: 'stopped' })
    vi.useRealTimers()
  })

  it('publishes only a verified origin and replaces it after an unexpected close', async () => {
    vi.useFakeTimers()
    const closeListeners: Array<() => void> = []
    const listeners = ['http://127.0.0.1:51001', 'http://127.0.0.1:51002']
      .map((origin): SupervisedBackendListener => ({
        close: vi.fn(async () => undefined),
        onClosed(listener) {
          closeListeners.push(listener)
          return () => undefined
        },
        onError: () => () => undefined,
        origin,
      }))
    const states: Array<{ status: string; origin?: string }> = []
    const supervisor = createLocalBackendSupervisor({
      restart: { baseDelayMs: 100, maxAttempts: 3, maxDelayMs: 1_000 },
      startListener: vi.fn(async () => listeners.shift()!),
      verifyOrigin: vi.fn(async () => true),
    })
    supervisor.subscribe((state) => states.push(state))
    await supervisor.start()
    expect(states).toEqual([
      { status: 'starting' },
      { origin: 'http://127.0.0.1:51001', status: 'available' },
    ])
    closeListeners[0]!()
    expect(supervisor.getState()).toEqual({ status: 'unavailable' })
    await vi.advanceTimersByTimeAsync(100)
    expect(supervisor.getState()).toEqual({
      origin: 'http://127.0.0.1:51002',
      status: 'available',
    })
    vi.useRealTimers()
  })

  it('stops after the bounded exponential restart sequence', async () => {
    vi.useFakeTimers()
    let recovered = false
    const startListener = vi.fn(async () => {
      if (!recovered) throw new Error('listener unavailable')
      return {
        close: vi.fn(async () => undefined), onClosed: () => () => undefined,
        onError: () => () => undefined,
        origin: 'http://127.0.0.1:51004',
      }
    })
    const supervisor = createLocalBackendSupervisor({
      restart: { baseDelayMs: 100, maxAttempts: 3, maxDelayMs: 1_000 },
      startListener,
      verifyOrigin: vi.fn(async () => true),
    })
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(startListener).toHaveBeenCalledTimes(4)
    expect(supervisor.getState()).toEqual({ status: 'unavailable' })
    recovered = true
    await supervisor.retry()
    expect(supervisor.getState()).toEqual({
      origin: 'http://127.0.0.1:51004', status: 'available',
    })
    vi.useRealTimers()
  })

  it('discards a listener that finishes starting after stop', async () => {
    let finishStart!: (listener: SupervisedBackendListener) => void
    const close = vi.fn(async () => undefined); const lateListener: SupervisedBackendListener = {
      close, onClosed: () => () => undefined,
      onError: () => () => undefined,
      origin: 'http://127.0.0.1:51003',
    }
    const supervisor = createLocalBackendSupervisor({
      restart: { baseDelayMs: 1, maxAttempts: 1, maxDelayMs: 1 },
      startListener: () => new Promise((resolve) => { finishStart = resolve }),
      verifyOrigin: vi.fn(async () => true),
    })
    const starting = supervisor.start()
    await supervisor.stop()
    finishStart(lateListener)
    await starting
    expect(close).toHaveBeenCalledOnce()
    expect(supervisor.getState()).toEqual({ status: 'stopped' })
  })

  it('releases a failed listener and schedules one recovery when error and close race', async () => {
    vi.useFakeTimers()
    let fail!: () => void
    let closeUnexpectedly!: () => void
    const close = vi.fn(async () => undefined)
    const listeners: SupervisedBackendListener[] = [
      {
        close,
        onClosed(listener) { closeUnexpectedly = listener; return () => undefined },
        onError(listener) { fail = listener; return () => undefined },
        origin: 'http://127.0.0.1:51005',
      },
      {
        close: vi.fn(async () => undefined),
        onClosed: () => () => undefined,
        onError: () => () => undefined,
        origin: 'http://127.0.0.1:51006',
      },
    ]
    const supervisor = createLocalBackendSupervisor({
      restart: { baseDelayMs: 10, maxAttempts: 2, maxDelayMs: 20 },
      startListener: async () => listeners.shift()!,
      verifyOrigin: async () => true,
    })
    await supervisor.start()

    fail()
    closeUnexpectedly()
    expect(supervisor.getState()).toEqual({ status: 'unavailable' })
    expect(close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10)

    expect(supervisor.getState()).toEqual({
      origin: 'http://127.0.0.1:51006', status: 'available',
    })
    vi.useRealTimers()
  })

  it('recovers without waiting for a failed listener close to settle', async () => {
    vi.useFakeTimers()
    let fail!: () => void
    let resolveClose!: () => void
    const close = vi.fn(() => new Promise<void>((resolve) => { resolveClose = resolve }))
    const listeners: SupervisedBackendListener[] = [
      {
        close,
        onClosed: () => () => undefined,
        onError(listener) { fail = listener; return () => undefined },
        origin: 'http://127.0.0.1:52001',
      },
      {
        close: vi.fn(async () => undefined),
        onClosed: () => () => undefined,
        onError: () => () => undefined,
        origin: 'http://127.0.0.1:52002',
      },
    ]
    const supervisor = createLocalBackendSupervisor({
      restart: { baseDelayMs: 10, maxAttempts: 2, maxDelayMs: 20 },
      startListener: async () => listeners.shift()!,
      verifyOrigin: async () => true,
    })
    await supervisor.start()

    fail()
    await vi.advanceTimersByTimeAsync(10)

    expect(close).toHaveBeenCalledOnce()
    expect(supervisor.getState()).toEqual({
      origin: 'http://127.0.0.1:52002', status: 'available',
    })
    resolveClose()
    vi.useRealTimers()
  })

  it('keeps manual recovery stable when the failed listener closes late', async () => {
    vi.useFakeTimers()
    let fail!: () => void
    let resolveClose!: () => void
    const recoveredClose = vi.fn(async () => undefined)
    const listeners: SupervisedBackendListener[] = [
      {
        close: () => new Promise<void>((resolve) => { resolveClose = resolve }),
        onClosed: () => () => undefined,
        onError(listener) { fail = listener; return () => undefined },
        origin: 'http://127.0.0.1:53001',
      },
      {
        close: recoveredClose,
        onClosed: () => () => undefined,
        onError: () => () => undefined,
        origin: 'http://127.0.0.1:53002',
      },
    ]
    const startListener = vi.fn(async () => listeners.shift()!)
    const supervisor = createLocalBackendSupervisor({
      restart: { baseDelayMs: 10, maxAttempts: 2, maxDelayMs: 20 },
      startListener,
      verifyOrigin: async () => true,
    })
    await supervisor.start()

    fail()
    await supervisor.retry()
    resolveClose()
    await vi.advanceTimersByTimeAsync(100)

    expect(startListener).toHaveBeenCalledTimes(2)
    expect(recoveredClose).not.toHaveBeenCalled()
    expect(supervisor.getState()).toEqual({
      origin: 'http://127.0.0.1:53002', status: 'available',
    })
    vi.useRealTimers()
  })
})
