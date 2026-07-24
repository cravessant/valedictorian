import { describe, expect, it } from 'vitest'
import { waitForIsolatedValidationCondition } from './isolated-validation-wait'

describe('isolated validation condition wait', () => {
  it('allows structured readiness beyond the previous 30-second matrix bound', async () => {
    let elapsedMs = 0

    await expect(waitForIsolatedValidationCondition(
      () => elapsedMs >= 30_050,
      {
        description: 'the isolated validation manifest',
        now: () => elapsedMs,
        sleep: async (milliseconds) => { elapsedMs += milliseconds },
        timeoutMs: 75_000,
      },
    )).resolves.toBeUndefined()
    expect(elapsedMs).toBe(30_050)
  })

  it('remains bounded when structured readiness never arrives', async () => {
    let elapsedMs = 0

    await expect(waitForIsolatedValidationCondition(
      () => false,
      {
        description: 'the isolated validation manifest',
        now: () => elapsedMs,
        sleep: async (milliseconds) => { elapsedMs += milliseconds },
        timeoutMs: 100,
      },
    )).rejects.toThrow('Timed out waiting for the isolated validation manifest.')
  })
})
