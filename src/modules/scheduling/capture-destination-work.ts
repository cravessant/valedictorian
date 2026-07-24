import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { eq } from 'drizzle-orm'
import type {
  ConnectorProviderUrlResolverResult,
  TransientRetryReason,
} from '@sparxie/valedictorian-connectors-core'
import type { ProcessingIssue } from '@sparxie/sdk'
import type {
  CaptureDestinationResolutionService,
  DestinationExecution,
  DestinationWorkReconciliation,
  DestinationWorkIdentity,
} from '../capture/capture.destination-resolution'
import type { PgliteDatabase } from '../../db/pglite'
import { SENSITIVE_KEY_SUBSTRINGS } from '../../db/sensitive-keys'
import {
  captureDestinationResolutionOperation,
  createScheduledWorkRepository,
  type CaptureDestinationResolutionSubject,
  type ScheduledWorkRepository,
} from './scheduled-work'
import { captureDestinationResolutionWork } from './scheduling.schema'

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
      // A resolved connector outcome is the narrow trust assertion that this URL
      // is an employer/ATS destination; everything else is treated as untrusted.
      const destination = sanitizeTrustedEmployerOrAtsDestination(outcome.url, outcome.method)
      if (!destination) {
        await state.terminal(identity, work.attempt, {
          status: 'blocked', issue: issue('destination_security_rejected', null, 'The provider returned an unsafe destination URL.'),
        })
        await repository.fail({ id: work.id, token: work.token, deterministicReason: 'security_rejected' })
        return
      }
      await state.resolved(identity, work.attempt, destination)
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
    const terminal = terminalIssue(outcome)
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

function terminalIssue(outcome: Extract<ConnectorProviderUrlResolverResult, { status: 'terminal' }>) {
  if (outcome.reason === 'authentication_required' || outcome.reason === 'authentication_failed') {
    return { status: 'action_required' as const, issue: issue('provider_authentication_required', 'authenticate_provider', 'Provider authentication is required.') }
  }
  if (outcome.reason === 'provider_record_invalid') {
    return { status: 'action_required' as const, issue: issue('provider_identity_invalid', 'correct_capture', 'The provider identity is not valid.') }
  }
  if (outcome.reason === 'provider_schema_changed') {
    return { status: 'action_required' as const, issue: issue('destination_unsupported', 'correct_capture', 'The provider destination is not supported.') }
  }
  return { status: 'action_required' as const, issue: issue('destination_not_found', 'complete_job_information', 'A supported destination was not available.') }
}

function issue(
  code: 'destination_security_rejected' | 'destination_not_found' | 'destination_unsupported' | 'provider_authentication_required' | 'provider_identity_invalid',
  action: 'authenticate_provider' | 'complete_job_information' | 'correct_capture' | null,
  message: string,
): ProcessingIssue {
  return { stage: 'destination', code, action, causedBy: null, message, details: {} } as ProcessingIssue
}

function retryCode(reason: TransientRetryReason): 'dependency_unavailable' | 'rate_limited' | 'request_timed_out' | 'transport_failed' {
  if (reason === 'rate_limit') return 'rate_limited'
  if (reason === 'operation_timeout') return 'request_timed_out'
  if (reason === 'network_interruption') return 'transport_failed'
  return 'dependency_unavailable'
}

function sanitizeTrustedEmployerOrAtsDestination(url: string, method: string) {
  if (url.length === 0 || url.length > 2_048 || url.trim() !== url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null
    if (!parsed.hostname || parsed.hostname.length > 253 || isUnsafeHost(parsed.hostname)) return null
    for (const key of parsed.searchParams.keys()) {
      if (isSensitiveQueryKey(key)) return null
    }
    if (!/^[a-z][a-z0-9_.-]{0,99}$/i.test(method)) return null
    // URL parsing validates structure only. Preserve the resolver-approved value
    // byte-for-byte so the outcome remains auditable against source evidence.
    return { url, method }
  } catch {
    return null
  }
}

function isUnsafeHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.+$/u, '')
  return isIP(host) !== 0
    || host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.test')
    || host.endsWith('.example')
    || host.endsWith('.invalid')
    || host === 'jobright.ai'
    || host.endsWith('.jobright.ai')
}

function isSensitiveQueryKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SENSITIVE_KEY_SUBSTRINGS.split('|').some((term) =>
    normalized.includes(term.replace(/[^a-z0-9]/g, '')))
    || /(?:sig(?:nature)?|jwt|session|csrf|xsrf|nonce|credential|bearer|oauth|xamz)/i.test(normalized)
}
