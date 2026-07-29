import type { LocalScheduledWorkSource } from '../scheduling/public'

export interface ScheduledConnectorCaptureRetry {
  connectorInstanceId: string
  nextAttemptAt: string
}

export interface ConnectorCaptureRetryWorkSourceOptions {
  listRetries: () => Promise<ScheduledConnectorCaptureRetry[]> | ScheduledConnectorCaptureRetry[]
  now: () => Date
  runRetry: (
    connectorInstanceId: string,
    signal?: AbortSignal,
  ) => Promise<{ status: string }>
}

/** Runs persisted connector-capture retries independently of cadence wakeups. */
export function createConnectorCaptureRetryWorkSource({
  listRetries,
  now,
  runRetry,
}: ConnectorCaptureRetryWorkSourceOptions): LocalScheduledWorkSource {
  const blocked = new Set<string>()
  let signalGeneration = 0

  return {
    id: 'connector-capture-retries',
    onSignal() {
      signalGeneration += 1
      blocked.clear()
    },
    async nextDueAt() {
      const retries = await listRetries()
      return retries
        .filter((retry) => !blocked.has(retry.connectorInstanceId))
        .map((retry) => retry.nextAttemptAt)
        .sort((left, right) => left.localeCompare(right))[0] ?? null
    },
    async runDue(signal) {
      const currentMs = now().getTime()
      const retries = await listRetries()
      const due = retries
        .filter((retry) => (
          !blocked.has(retry.connectorInstanceId)
          && Date.parse(retry.nextAttemptAt) <= currentMs
        ))
        .sort((left, right) => (
          left.nextAttemptAt.localeCompare(right.nextAttemptAt)
          || left.connectorInstanceId.localeCompare(right.connectorInstanceId)
        ))

      for (const retry of due) {
        if (signal?.aborted) return
        const runGeneration = signalGeneration
        const run = await runRetry(retry.connectorInstanceId, signal)
        if (
          runGeneration === signalGeneration
          && (run.status === 'queued' || run.status === 'running')
        ) {
          blocked.add(retry.connectorInstanceId)
        }
      }
    },
  }
}
