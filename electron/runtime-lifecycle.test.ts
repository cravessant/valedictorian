import { describe, expect, it, vi } from 'vitest'
import { createRuntimeQuitBarrier, stopRuntimeLifecycle } from './runtime-lifecycle'

describe('Electron runtime lifecycle', () => {
  it('stops the supervised backend before closing every runtime-owned resource', async () => {
    const events: string[] = []
    let releaseScheduler: (() => void) | undefined
    const schedulerGate = new Promise<void>((resolve) => {
      releaseScheduler = resolve
    })
    const runtime = {
      stopScheduler: vi.fn(async () => {
        events.push('scheduler.stop')
        await schedulerGate
      }),
      close: vi.fn(async () => { events.push('runtime.close') }),
    }
    const backendSupervisor = {
      stop: vi.fn(async () => { events.push('backend.stop') }),
    }

    const stopPromise = stopRuntimeLifecycle({ backendSupervisor, runtime })
    await Promise.resolve()
    expect(events).toEqual(['scheduler.stop'])

    releaseScheduler?.()
    await stopPromise

    expect(events).toEqual(['scheduler.stop', 'backend.stop', 'runtime.close'])
    expect(runtime.close).toHaveBeenCalledOnce()
  })

  it('delays Electron quit until runtime cleanup settles and coalesces repeated requests', async () => {
    let releaseClose: (() => void) | undefined
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    const closeRuntime = vi.fn(async () => closeGate)
    const quit = vi.fn()
    const barrier = createRuntimeQuitBarrier({ closeRuntime, quit })
    const firstEvent = { preventDefault: vi.fn() }
    const repeatedEvent = { preventDefault: vi.fn() }

    barrier.requestQuit(firstEvent)
    barrier.requestQuit(repeatedEvent)

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce()
    expect(closeRuntime).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()

    releaseClose?.()
    await barrier.whenSettled()

    expect(quit).toHaveBeenCalledOnce()
    const allowedEvent = { preventDefault: vi.fn() }
    barrier.requestQuit(allowedEvent)
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled()
  })
})
