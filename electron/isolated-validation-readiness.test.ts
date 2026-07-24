import { describe, expect, it, vi } from 'vitest'
import { createIsolatedValidationReadinessGate } from './isolated-validation-readiness'

describe('isolated validation renderer readiness', () => {
  it('does not publish until the expected window is painted and its renderer has loaded', () => {
    const onReady = vi.fn()
    const gate = createIsolatedValidationReadinessGate({ onReady })

    gate.rendererLoaded()
    expect(onReady).not.toHaveBeenCalled()
    gate.windowReady()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('does not publish when first paint arrives before the renderer load event', () => {
    const onReady = vi.fn()
    const gate = createIsolatedValidationReadinessGate({ onReady })

    gate.windowReady()
    expect(onReady).not.toHaveBeenCalled()
    gate.rendererLoaded()
    expect(onReady).toHaveBeenCalledTimes(1)
  })
})
