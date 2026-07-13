import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultLocalConnectorPorts,
  createJitterDelayRuntime,
} from './connector.runtime-ports'

describe('connector runtime ports', () => {
  it('waits for a jittered duration without hard-coding wall-clock sleeps', async () => {
    const sleep = vi.fn(async () => undefined)
    const delay = createJitterDelayRuntime({
      random: () => 0.25,
      sleep,
    })

    await expect(delay.wait({
      minDelayMs: 1_000,
      maxDelayMs: 5_000,
      reason: 'jobright_resolution',
    })).resolves.toBe(2_000)

    expect(sleep).toHaveBeenCalledWith(2_000)
  })

  it('creates default local connector ports with delay runtime only', async () => {
    const sleep = vi.fn(async () => undefined)
    const ports = createDefaultLocalConnectorPorts({
      random: () => 0,
      sleep,
    })

    expect(ports).toEqual({
      connectorRuntime: {
        delay: expect.any(Object),
      },
    })
    expect(JSON.stringify(ports)).not.toContain('connectorAuth')
    expect(JSON.stringify(ports)).not.toContain(['browser', 'Session'].join(''))

    await expect(ports.connectorRuntime.delay?.wait({
      minDelayMs: 1_000,
      maxDelayMs: 10_000,
      reason: 'jobright_resolution',
    })).resolves.toBe(1_000)

    expect(sleep).toHaveBeenCalledWith(1_000)
  })
})
