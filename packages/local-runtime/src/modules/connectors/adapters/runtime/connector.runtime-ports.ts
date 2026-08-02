import type { ConnectorDelayRuntime } from '@sparxie/valedictorian-connectors-core'
import type { AppConnectorRuntimePorts } from '../../ports/connector.runner-contracts.js'

export interface ConnectorDelayRuntimeOptions {
  random?: () => number
  sleep?: (durationMs: number) => Promise<void>
}

export type DefaultLocalConnectorPorts = {
  connectorRuntime: AppConnectorRuntimePorts
}

export type DefaultLocalConnectorPortsOptions = ConnectorDelayRuntimeOptions

export function createJitterDelayRuntime({
  random = Math.random,
  sleep = defaultSleep,
}: ConnectorDelayRuntimeOptions = {}): ConnectorDelayRuntime {
  return {
    async wait(input) {
      const minDelayMs = normalizeDelay(input.minDelayMs)
      const maxDelayMs = Math.max(minDelayMs, normalizeDelay(input.maxDelayMs))
      const ratio = clamp(random(), 0, 1)
      const durationMs = Math.round(minDelayMs + (maxDelayMs - minDelayMs) * ratio)

      await sleep(durationMs)

      return durationMs
    },
  }
}

export function createDefaultLocalConnectorPorts(
  options: DefaultLocalConnectorPortsOptions = {},
): DefaultLocalConnectorPorts {
  return {
    connectorRuntime: {
      delay: createJitterDelayRuntime(options),
    },
  }
}

function defaultSleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, durationMs)
  })
}

function normalizeDelay(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, value)
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum
  }

  return Math.min(maximum, Math.max(minimum, value))
}
