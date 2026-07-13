import { describe, expect, it, vi } from 'vitest'
import {
  createLocalBackendSupervisor,
  type SupervisedBackendListener,
} from './local-backend-supervisor'

describe('local backend supervisor', () => {
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
