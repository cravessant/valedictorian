import type { LocalScheduledWorkSource } from '../../runtime/local-scheduler'

export interface ClaimedProviderUrlResolutionWork {
  acquisitionToken: string
  attempt: number
  captureEvidenceVersionId: string
  connectorInstanceId: string
  executionScopeId: string
  inputHash: string
  horizonAt: string
  intermediaryUrl: string
  maxAttempts: number
  providerRecordId: string
  resolverId: string
  resolverVersion: string
  serverMinimumDelayMs: number | null
  retryWorkId: string
}

export interface ProviderUrlResolutionWorkSourceOptions {
  claimDue: (
    dueAt: string,
  ) => Promise<ClaimedProviderUrlResolutionWork | null>
    | ClaimedProviderUrlResolutionWork
    | null
  execute: (
    work: ClaimedProviderUrlResolutionWork,
    signal?: AbortSignal,
  ) => Promise<void>
  nextDueAt: () => Promise<string | null> | string | null
  now: () => Date
}

export function createProviderUrlResolutionWorkSource({
  claimDue,
  execute,
  nextDueAt,
  now,
}: ProviderUrlResolutionWorkSourceOptions): LocalScheduledWorkSource {
  return {
    id: 'provider-url-resolution',
    nextDueAt,
    async runDue(signal) {
      while (!signal?.aborted) {
        const work = await claimDue(now().toISOString())
        if (!work) return
        await execute(work, signal)
      }
    },
  }
}
