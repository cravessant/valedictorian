import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type {
  ConnectorProviderUrlResolverResult,
  TransientRetryReason,
} from '@sparxie/valedictorian-connectors-core'
import type {
  CaptureDestinationResolutionService,
  DestinationExecution,
  DestinationWorkReconciliation,
  DestinationWorkIdentity,
} from '../capture/capture.destination-resolution.js'
import type { PgliteDatabase } from '../../db/pglite.js'
import {
  validateDestinationUrl,
  validateResolverMethod,
} from '../capture/destination-url-safety.js'
import {
  captureDestinationResolutionOperation,
  createScheduledWorkRepository,
  type CaptureDestinationResolutionSubject,
  type ScheduledWorkRepository,
} from './scheduled-work.js'
import { captureDestinationResolutionWork } from './scheduling.schema.js'
import {
  destinationSecurityIssue,
  terminalDestinationIssue,
} from './capture-destination-issue.js'

export type CaptureDestinationWorkRepository = ScheduledWorkRepository<
  CaptureDestinationResolutionSubject,
  CaptureDestinationResolutionSubject
>

export function createCaptureDestinationWorkRepository(
  database: PgliteDatabase,
  options: { workspaceId: string; now?: () => Date },
): CaptureDestinationWorkRepository {
  return createScheduledWorkRepository(
    database,
    captureDestinationResolutionOperation,
    { now: options.now, workspaceId: options.workspaceId },
  )
}

/** The immutable scope key for exactly one Capture-resolution generation. */
export function captureDestinationWorkIdempotencyKey(identity: DestinationWorkIdentity) {
  return `capture-destination:sha256:${createHash('sha256').update(JSON.stringify([
    identity.workspaceId,
    identity.captureId,
    identity.captureRevision,
    identity.generationId,
    identity.id,
    identity.version,
    identity.inputFingerprint,
  ])).digest('hex')}`
}

export function enqueueCaptureDestinationWork(
  repository: CaptureDestinationWorkRepository,
  identity: DestinationWorkIdentity,
) {
  return repository.enqueue({
    workspaceId: identity.workspaceId,
    idempotencyKey: captureDestinationWorkIdempotencyKey(identity),
    maxAttempts: identity.retryPolicy.maximumAttempts,
    ownerVersion: identity.version,
    subject: {
      captureId: identity.captureId,
      captureRevision: identity.captureRevision,
      generationId: identity.generationId,
      resolverId: identity.id,
      resolverVersion: identity.version,
      inputFingerprint: identity.inputFingerprint,
      retryDelay1Ms: identity.retryPolicy.retryDelaysMs[0],
      retryDelay2Ms: identity.retryPolicy.retryDelaysMs[1],
      retryDelay3Ms: identity.retryPolicy.retryDelaysMs[2],
      retryDelay4Ms: identity.retryPolicy.retryDelaysMs[3],
      retryDelay5Ms: identity.retryPolicy.retryDelaysMs[4],
      retryDelay6Ms: identity.retryPolicy.retryDelaysMs[5],
    },
  })
}

/** Repair only the capture-owned stage projection after startup claim recovery. */
export async function reconcileCaptureDestinationWork(
  database: PgliteDatabase,
  workspaceId: string,
  state: CaptureDestinationResolutionService,
) {
  const rows = await database.select().from(captureDestinationResolutionWork)
    .where(eq(captureDestinationResolutionWork.workspaceId, workspaceId))
  const reconciliation: DestinationWorkReconciliation[] = rows
    .filter((row) => ['scheduled', 'exhausted', 'terminal', 'completed'].includes(row.status))
    .map((row) => ({
      identity: {
        workspaceId: row.workspaceId,
        captureId: row.captureId,
        captureRevision: row.captureRevision,
        generationId: row.generationId,
        id: row.resolverId,
        version: row.resolverVersion,
        inputFingerprint: row.inputFingerprint,
        retryPolicy: {
          maximumAttempts: row.maxAttempts,
          retryDelaysMs: [
            row.retryDelay1Ms, row.retryDelay2Ms, row.retryDelay3Ms,
            row.retryDelay4Ms, row.retryDelay5Ms, row.retryDelay6Ms,
          ],
        },
      },
      attempt: row.attempt,
      status: row.status as DestinationWorkReconciliation['status'],
      nextEligibleAt: row.nextEligibleAt,
      failureReason: row.failureReason,
    }))
  await state.reconcileDurableWork(reconciliation)
}

export function createCaptureDestinationWorkExecutor(input: {
  readonly execute: (context: DestinationExecution, signal?: AbortSignal) => Promise<ConnectorProviderUrlResolverResult>
  readonly repository: CaptureDestinationWorkRepository
  readonly state: CaptureDestinationResolutionService
}) {
  const { execute, repository, state } = input
  return async function executeCaptureDestinationWork(work: {
    id: string
    workspaceId: string
    token: string
    attempt: number
    maxAttempts: number
    subject: CaptureDestinationResolutionSubject
  }, signal?: AbortSignal): Promise<void> {
    const identity: DestinationWorkIdentity = {
      workspaceId: work.workspaceId,
      captureId: work.subject.captureId,
      captureRevision: work.subject.captureRevision,
      generationId: work.subject.generationId,
      id: work.subject.resolverId,
      version: work.subject.resolverVersion,
      inputFingerprint: work.subject.inputFingerprint,
      retryPolicy: {
        maximumAttempts: work.maxAttempts,
        retryDelaysMs: [
          work.subject.retryDelay1Ms, work.subject.retryDelay2Ms, work.subject.retryDelay3Ms,
          work.subject.retryDelay4Ms, work.subject.retryDelay5Ms, work.subject.retryDelay6Ms,
        ],
      },
    }
    const context = await state.start(identity, work.attempt)
    if (!context) {
      // A scoped repository cannot claim a foreign workspace. Still keep this
      // explicit: a failed scope check is never permission to complete work.
      if (repository.workspaceId === work.workspaceId) {
        await repository.complete({ id: work.id, token: work.token })
      }
      return
    }
    let outcome: ConnectorProviderUrlResolverResult
    try {
      outcome = await execute(context, signal)
    } catch {
      await retryOrExhaust({ identity, repository, state, work, retryReason: 'network_interruption' })
      return
    }
    if (outcome.status === 'resolved') {
      const destination = safeResolvedDestination(outcome)
      if (!destination.ok) {
        await state.terminal(identity, work.attempt, {
          status: 'blocked',
          issue: destinationSecurityIssue(identity, destination.reason),
        })
        await repository.fail({ id: work.id, token: work.token, deterministicReason: 'security_rejected' })
        return
      }
      await state.resolved(identity, work.attempt, {
        url: destination.url,
        method: destination.method,
        ...(destination.providerStatus ? { providerStatus: destination.providerStatus } : {}),
      })
      await repository.complete({ id: work.id, token: work.token })
      return
    }
    if (outcome.status === 'retryable') {
      await retryOrExhaust({
        identity,
        repository,
        state,
        work,
        retryReason: outcome.retryReason,
        serverMinimumDelayMs: outcome.serverMinimumDelayMs,
      })
      return
    }
    if (outcome.status === 'interrupted') {
      await retryOrExhaust({
        identity,
        repository,
        state,
        work,
        retryReason: outcome.reason === 'runtime_limit' ? 'operation_timeout' : 'server_failure',
      })
      return
    }
    const terminal = terminalDestinationIssue(outcome, identity)
    await state.terminal(identity, work.attempt, terminal)
    await repository.fail({
      id: work.id,
      token: work.token,
      deterministicReason: 'unresolvable',
    })
  }
}

async function retryOrExhaust(input: {
  readonly identity: DestinationWorkIdentity
  readonly repository: CaptureDestinationWorkRepository
  readonly state: CaptureDestinationResolutionService
  readonly work: { id: string; token: string; attempt: number }
  readonly retryReason: TransientRetryReason
  readonly serverMinimumDelayMs?: number
}) {
  const outcome = await input.repository.fail({
    id: input.work.id,
    token: input.work.token,
    retryReason: input.retryReason,
    ...(input.serverMinimumDelayMs === undefined ? {} : { serverMinimumDelayMs: input.serverMinimumDelayMs }),
  })
  if (outcome.outcome === 'retry') {
    await input.state.retryWait(input.identity, input.work.attempt, {
      code: retryCode(input.retryReason), nextAttemptAt: outcome.nextEligibleAt,
    })
    return
  }
  if (outcome.outcome === 'exhausted') {
    await input.state.terminal(input.identity, input.work.attempt, {
      status: 'exhausted',
      issue: {
        stage: 'destination', code: 'attempt_budget_exhausted', action: 'retry_now',
        causedBy: retryCode(input.retryReason), message: 'The provider could not be reached after the retry limit.', details: {},
      },
    })
  }
}

function retryCode(reason: TransientRetryReason): 'dependency_unavailable' | 'rate_limited' | 'request_timed_out' | 'transport_failed' {
  if (reason === 'rate_limit') return 'rate_limited'
  if (reason === 'operation_timeout') return 'request_timed_out'
  if (reason === 'network_interruption') return 'transport_failed'
  return 'dependency_unavailable'
}

function safeResolvedDestination(outcome: Extract<ConnectorProviderUrlResolverResult, { status: 'resolved' }>) {
  const destination = validateDestinationUrl(outcome.url)
  const method = validateResolverMethod(outcome.method)
  if (!destination.ok) return { ok: false as const, reason: destination.code }
  if (!method.ok) return { ok: false as const, reason: method.code }
  const providerStatus = providerStatusFromEvidence(outcome.evidence)
  return {
    ok: true as const,
    url: destination.url,
    method: outcome.method,
    ...(providerStatus ? { providerStatus } : {}),
  }
}

function providerStatusFromEvidence(
  evidence: Extract<ConnectorProviderUrlResolverResult, { status: 'resolved' }>['evidence'],
): 'closed' | 'hidden' | undefined {
  for (const item of evidence ?? []) {
    if (item.kind !== 'jobright_api_detail' || !isRecord(item.value)) continue
    const providerStatus = item.value.providerStatus
    if (providerStatus === 'hidden' || providerStatus === 'closed') return providerStatus
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
