import { describe, expect, it } from 'vitest'
import { createLocalScheduler, type LocalScheduledWorkSource } from './local-scheduler'

describe('local scheduler lifecycle', () => {
  it('wakes due persisted work and rearms for the next due instant', async () => {
    let now = new Date('2026-07-15T12:00:00.000Z')
    const timers: Array<{ callback: () => void; delayMs: number }> = []
    const runs: string[] = []
    let nextDueAt: string | null = '2026-07-15T12:00:00.000Z'
    const source: LocalScheduledWorkSource = {
      id: 'fixture',
      nextDueAt: () => nextDueAt,
      runDue: async () => {
        runs.push('fixture')
        nextDueAt = `2026-07-15T12:0${runs.length}:00.000Z`
      },
    }
    const scheduler = createLocalScheduler({
      now: () => now,
      setTimeout(callback, delayMs) {
        timers.push({ callback, delayMs })
        return timers.length - 1
      },
      clearTimeout() {
        // The fixture only needs to observe which callbacks were scheduled.
      },
    })
    scheduler.register(source)

    scheduler.start()
    await scheduler.whenIdle()

    expect(runs).toEqual(['fixture'])
    expect(timers.at(-1)?.delayMs).toBe(60_000)

    now = new Date('2026-07-15T12:01:00.000Z')
    timers.at(-1)?.callback()
    await scheduler.whenIdle()

    expect(runs).toEqual(['fixture', 'fixture'])
  })

  it('continues overdue work when a run crosses its next cadence', async () => {
    let now = new Date('2026-07-15T12:00:00.000Z')
    let nextDueAt = '2026-07-15T12:00:00.000Z'
    let runCount = 0
    const timers: Array<{ callback: () => void; delayMs: number }> = []
    const scheduler = createLocalScheduler({
      now: () => now,
      setTimeout(callback, delayMs) {
        timers.push({ callback, delayMs })
        return timers.length - 1
      },
      clearTimeout() {
        // no-op deterministic timer cancellation
      },
    })
    scheduler.register({
      id: 'fixture',
      nextDueAt: () => nextDueAt,
      runDue: async () => {
        runCount += 1
        if (runCount === 1) {
          now = new Date('2026-07-15T12:16:00.000Z')
          nextDueAt = '2026-07-15T12:15:00.000Z'
        } else {
          nextDueAt = '2026-07-15T13:00:00.000Z'
        }
      },
    })

    scheduler.start()
    await scheduler.whenIdle()

    expect(runCount).toBe(2)
    expect(timers.at(-1)?.delayMs).toBe(2_640_000)
  })

  it('caps long timer hops so valid yearly schedules do not overflow Node timers', async () => {
    const timers: Array<{ callback: () => void; delayMs: number }> = []
    const scheduler = createLocalScheduler({
      now: () => new Date('2026-07-15T12:00:00.000Z'),
      setTimeout(callback, delayMs) {
        timers.push({ callback, delayMs })
        return timers.length - 1
      },
      clearTimeout() {
        // no-op deterministic timer cancellation
      },
    })
    scheduler.register({
      id: 'yearly',
      nextDueAt: () => '2027-07-15T12:00:00.000Z',
      runDue: async () => undefined,
    })

    scheduler.start()
    await scheduler.whenIdle()

    expect(timers).toHaveLength(1)
    expect(timers[0]!.delayMs).toBeLessThanOrEqual(2_147_483_647)
    expect(timers[0]!.delayMs).toBeGreaterThan(0)
  })

  it('backs off when post-run discovery finds due work and a retrying source', async () => {
    let postRunDiscovery = false
    let runCount = 0
    const timers: Array<{ callback: () => void; delayMs: number }> = []
    const scheduler = createLocalScheduler({
      now: () => new Date('2026-07-15T12:00:00.000Z'),
      setTimeout(callback, delayMs) {
        timers.push({ callback, delayMs })
        return timers.length - 1
      },
      clearTimeout() {
        // no-op deterministic timer cancellation
      },
    })
    scheduler.register({
      id: 'overdue',
      nextDueAt: () => '2026-07-15T12:00:00.000Z',
      runDue: async () => {
        runCount += 1
        postRunDiscovery = true
      },
    })
    scheduler.register({
      id: 'retrying',
      nextDueAt: () => {
        if (postRunDiscovery) {
          throw new Error('retry fixture')
        }
        return '2026-07-15T12:30:00.000Z'
      },
      runDue: async () => undefined,
    })

    scheduler.start()
    await scheduler.whenIdle()

    expect(runCount).toBe(1)
    expect(timers.at(-1)?.delayMs).toBe(1_000)
    await scheduler.stop()
  })

  it('stops future wakeups and does not rearm after shutdown', async () => {
    let runCount = 0
    const timers: Array<{ callback: () => void; delayMs: number }> = []
    const scheduler = createLocalScheduler({
      now: () => new Date('2026-07-15T12:00:00.000Z'),
      setTimeout(callback, delayMs) {
        timers.push({ callback, delayMs })
        return timers.length - 1
      },
      clearTimeout() {
        // no-op fake timer cancellation
      },
    })
    scheduler.register({
      id: 'fixture',
      nextDueAt: () => '2026-07-15T13:00:00.000Z',
      runDue: async () => {
        runCount += 1
      },
    })

    scheduler.start()
    await scheduler.stop()
    timers.at(-1)?.callback()
    await scheduler.whenIdle()

    expect(runCount).toBe(0)
  })
})
