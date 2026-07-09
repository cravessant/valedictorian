import type { ConnectorBrowserSessionRuntime, ConnectorDelayRuntime } from '@sparxie/valedictorian-connectors-core'
import type { AppConnectorAuthHost, AppConnectorRuntimePorts } from './connector.runner'

export interface ConnectorDelayRuntimeOptions {
  random?: () => number
  sleep?: (durationMs: number) => Promise<void>
}

export type DefaultLocalConnectorPorts = {
  connectorAuth: AppConnectorAuthHost
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

export function createUnavailableBrowserSessionRuntime(): ConnectorBrowserSessionRuntime {
  return {
    async resolveLink(_input) {
      return {
        method: 'local_browser_session_unavailable',
        officialUrl: null,
        reason: 'browser_session_runtime_unavailable',
        status: 'auth_required',
      }
    },
  }
}

export function createUnavailableConnectorAuthHost(): AppConnectorAuthHost {
  return {
    browserSessions: {
      async resolve(reference) {
        return {
          id: reference.id,
          mode: reference.mode,
          reason: 'browser_session_action_required',
          ...(reference.sessionKey === undefined ? {} : { sessionKey: reference.sessionKey }),
          status: 'action_required',
        }
      },
    },
  }
}

export function createDefaultLocalConnectorPorts(
  options: DefaultLocalConnectorPortsOptions = {},
): DefaultLocalConnectorPorts {
  return {
    connectorAuth: createUnavailableConnectorAuthHost(),
    connectorRuntime: {
      browserSession: createUnavailableBrowserSessionRuntime(),
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
