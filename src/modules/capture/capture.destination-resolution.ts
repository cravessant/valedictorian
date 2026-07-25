import { createHash } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  replayCaptureRevisionInputSchema,
  retryCaptureProcessingInputSchema,
  type CaptureProcessingStartResult,
  type ProcessingIssue,
  type ReplayCaptureRevisionInput,
  type RetryCaptureProcessingInput,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import { SENSITIVE_KEY_SUBSTRINGS } from '../../db/sensitive-keys'
import { createUuidV7Generator, type Clock, type UuidV7Generator } from '../../db/uuidv7'
import type { CaptureMaterializationService } from './capture.materialization'
import {
  captureResolutionCommandReceipts,
  captureResolutionGenerations,
  captureResolutionStageResults,
  captureRevisions,
  captures,
} from './capture.schema'

type Tx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

const RETRY_POLICY_ID = 'capture-destination-v1'
const RETRY_POLICY_SNAPSHOT = JSON.stringify({
  retryDelaysMs: [2_000, 4_000, 8_000, 16_000, 32_000, 60_000],
  maximumAttempts: 7,
})

export interface DestinationRetryPolicy {
  readonly maximumAttempts: number
  readonly retryDelaysMs: readonly [number, number, number, number, number, number]
}

export interface DestinationResolverSelection {
  readonly id: string
  readonly version: string
}

export interface DestinationWorkIdentity extends DestinationResolverSelection {
  readonly workspaceId: string
  readonly captureId: string
  readonly captureRevision: number
  readonly generationId: string
  readonly inputFingerprint: string
  readonly retryPolicy: DestinationRetryPolicy
}

export interface DestinationWorkPublisher {
  enqueue(identity: DestinationWorkIdentity): Promise<boolean>
}

export interface DestinationExecution {
  readonly captureId: string
  readonly captureRevision: number
  readonly connectorInstanceId: string
  readonly executionScopeId: string
  readonly generationId: string
  readonly providerRecordId: string
  readonly resolverId: string
  readonly resolverVersion: string
}

export interface DestinationWorkReconciliation {
  readonly identity: DestinationWorkIdentity
  readonly attempt: number
  readonly status: 'scheduled' | 'exhausted' | 'terminal' | 'completed'
  readonly nextEligibleAt: string | null
  readonly failureReason: string | null
}

interface CurrentGeneration {
  readonly workspaceId: string
  readonly captureId: string
  readonly captureRevision: number
  readonly generationId: string
  readonly inputFingerprint: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly providerRecordId: string | null
  readonly connectorInstanceId: string | null
  readonly executionScopeId: string | null
  readonly destinationStatus: string
  readonly retryPolicyId: string
  readonly retryPolicySnapshotJson: string
}

export interface CaptureDestinationResolutionService {
  scheduleAcknowledged(captureId: string): Promise<void>
  reconcile(): Promise<void>
  reconcileDurableWork(work: readonly DestinationWorkReconciliation[]): Promise<void>
  start(identity: DestinationWorkIdentity, attempt: number): Promise<DestinationExecution | null>
  resolved(
    identity: DestinationWorkIdentity,
    attempt: number,
    result: { url: string; method: string; providerStatus?: 'closed' | 'hidden' },
  ): Promise<void>
  retryWait(identity: DestinationWorkIdentity, attempt: number, input: { code: 'dependency_unavailable' | 'rate_limited' | 'request_timed_out' | 'transport_failed'; nextAttemptAt: string }): Promise<void>
  terminal(identity: DestinationWorkIdentity, attempt: number, input: { status: 'action_required' | 'blocked' | 'exhausted'; issue: ProcessingIssue }): Promise<void>
  retry(input: RetryCaptureProcessingInput): Promise<CaptureProcessingStartResult>
  replay(input: ReplayCaptureRevisionInput): Promise<CaptureProcessingStartResult>
}

export function createCaptureDestinationResolutionService(input: {
  readonly database: PgliteDatabase
  readonly materialization: CaptureMaterializationService
  readonly publisher: DestinationWorkPublisher
  readonly selectResolver: (adapterId: string, adapterVersion: string) => DestinationResolverSelection | null
  readonly workspaceId: string
  readonly now?: Clock
  readonly newId?: UuidV7Generator
}): CaptureDestinationResolutionService {
  const { database, materialization, publisher, selectResolver, workspaceId } = input
  const now = input.now ?? (() => new Date())
  const newId = input.newId ?? createUuidV7Generator(now)
  const nowIso = () => now().toISOString()

  async function scheduleAcknowledged(captureId: string) {
    await materialization.ensureCapture(workspaceId, captureId)
    const identity = await database.transaction(async (tx) => {
      const current = await currentQueuedGeneration(tx, captureId)
      if (!current) return null
      const selection = selectResolver(current.adapterId, current.adapterVersion)
      if (!selection) {
        await markResolverUnavailable(tx, current.generationId, nowIso())
        return null
      }
      if (!current.providerRecordId || !current.connectorInstanceId || !current.executionScopeId) {
        await markProviderIdentityUnavailable(tx, current.generationId, nowIso())
        return null
      }
      const retryPolicy = parseDestinationRetryPolicy(current.retryPolicyId, current.retryPolicySnapshotJson)
      if (!retryPolicy) {
        await markResolverUnavailable(tx, current.generationId, nowIso())
        return null
      }
      // Resolver selection is resolved exactly at enqueue time. The retry policy is
      // already snapshotted by materialization/successor creation and must not be
      // rewritten on restart.
      await tx.update(captureResolutionGenerations).set({
        resolverSelectionSnapshotJson: JSON.stringify(selection),
        updatedAt: nowIso(),
      }).where(eq(captureResolutionGenerations.id, current.generationId))
      await tx.update(captureResolutionStageResults).set({
        resolverId: selection.id,
        resolverVersion: selection.version,
        updatedAt: nowIso(),
      }).where(and(
        eq(captureResolutionStageResults.generationId, current.generationId),
        eq(captureResolutionStageResults.stage, 'destination'),
      ))
      return { ...current, ...selection, retryPolicy, workspaceId }
    })
    if (identity) await publisher.enqueue(identity)
  }

  async function reconcile() {
    const rows = await database.select({ captureId: captures.id })
      .from(captures)
      .innerJoin(captureResolutionGenerations, and(
        eq(captureResolutionGenerations.captureId, captures.id),
        eq(captureResolutionGenerations.captureRevision, captures.revision),
        eq(captureResolutionGenerations.status, 'active'),
      ))
      .innerJoin(captureResolutionStageResults, and(
        eq(captureResolutionStageResults.generationId, captureResolutionGenerations.id),
        eq(captureResolutionStageResults.stage, 'destination'),
        inArray(captureResolutionStageResults.status, ['queued', 'retry_wait']),
      ))
      .where(eq(captures.workspaceId, workspaceId))
    for (const row of rows) await scheduleAcknowledged(row.captureId)
  }

  /**
   * Startup convergence for a process death between the work-state transition and
   * the capture stage projection. Work remains authoritative for scheduling; this
   * only repairs a stale `running`/retry stage, never creates or completes work.
   */
  async function reconcileDurableWork(work: readonly DestinationWorkReconciliation[]) {
    for (const item of work) {
      const [stage] = await database.select({ status: captureResolutionStageResults.status })
        .from(captureResolutionStageResults)
        .where(and(
          eq(captureResolutionStageResults.generationId, item.identity.generationId),
          eq(captureResolutionStageResults.stage, 'destination'),
        )).limit(1)
      if (!stage || !['running', 'retry_wait', 'queued'].includes(stage.status)) continue
      if (item.status === 'scheduled' && stage.status === 'running' && item.nextEligibleAt) {
        // The durable row has advanced to the next attempt. The stage describes
        // the attempt that just failed before this projection was interrupted.
        await retryWait(item.identity, Math.max(1, item.attempt - 1), {
          code: retryCodeFromWork(item.failureReason), nextAttemptAt: item.nextEligibleAt,
        })
      } else if (item.status === 'exhausted') {
        await terminal(item.identity, item.attempt, {
          status: 'exhausted',
          issue: {
            stage: 'destination', code: 'attempt_budget_exhausted', action: 'retry_now',
            causedBy: retryCodeFromWork(item.failureReason), message: 'The provider could not be reached after the retry limit.', details: {},
          } as ProcessingIssue,
        })
      } else if (item.status === 'terminal') {
        await terminal(item.identity, item.attempt, {
          status: item.failureReason === 'security_rejected' ? 'blocked' : 'action_required',
          issue: {
            stage: 'destination',
            code: item.failureReason === 'security_rejected' ? 'destination_security_rejected' : 'destination_not_found',
            action: item.failureReason === 'security_rejected' ? null : 'complete_job_information',
            causedBy: null,
            message: item.failureReason === 'security_rejected' ? 'The provider returned an unsafe destination URL.' : 'A supported destination was not available.',
            details: {},
          } as ProcessingIssue,
        })
      }
    }
  }

  async function start(identity: DestinationWorkIdentity, attempt: number) {
    return database.transaction(async (tx) => {
      const [row] = await tx.select({
        adapterId: captures.adapterId,
        adapterVersion: captures.adapterVersion,
        connectorInstanceId: captureRevisions.connectorInstanceId,
        executionScopeId: captureRevisions.executionScopeId,
        providerRecordId: captures.providerRecordId,
        generationStatus: captureResolutionGenerations.status,
        inputFingerprint: captureResolutionGenerations.inputFingerprint,
        stageStatus: captureResolutionStageResults.status,
      }).from(captureResolutionGenerations)
        .innerJoin(captures, eq(captures.id, captureResolutionGenerations.captureId))
        .innerJoin(captureRevisions, and(
          eq(captureRevisions.captureId, captureResolutionGenerations.captureId),
          eq(captureRevisions.revision, captureResolutionGenerations.captureRevision),
        ))
        .innerJoin(captureResolutionStageResults, and(
          eq(captureResolutionStageResults.generationId, captureResolutionGenerations.id),
          eq(captureResolutionStageResults.stage, 'destination'),
        ))
        .where(and(
          eq(captureResolutionGenerations.id, identity.generationId),
          eq(captureResolutionGenerations.workspaceId, workspaceId),
          eq(captureResolutionGenerations.captureId, identity.captureId),
          eq(captureResolutionGenerations.captureRevision, identity.captureRevision),
        )).limit(1).for('update')
      if (!row || row.generationStatus !== 'active' || row.inputFingerprint !== identity.inputFingerprint) return null
      if (!['queued', 'retry_wait', 'running'].includes(row.stageStatus)) return null
      if (!row.providerRecordId || !row.connectorInstanceId || !row.executionScopeId) return null
      const selection = selectResolver(row.adapterId, row.adapterVersion)
      if (!selection || selection.id !== identity.id || selection.version !== identity.version) return null
      const timestamp = nowIso()
      await tx.update(captureResolutionStageResults).set({
        attemptCount: attempt,
        issueJson: null,
        nextAttemptAt: null,
        resolverId: selection.id,
        resolverVersion: selection.version,
        status: 'running',
        updatedAt: timestamp,
      }).where(and(
        eq(captureResolutionStageResults.generationId, identity.generationId),
        eq(captureResolutionStageResults.stage, 'destination'),
      ))
      await tx.update(captureResolutionGenerations).set({
        processingSummary: 'processing', updatedAt: timestamp,
      }).where(eq(captureResolutionGenerations.id, identity.generationId))
      return {
        captureId: identity.captureId,
        captureRevision: identity.captureRevision,
        connectorInstanceId: row.connectorInstanceId,
        executionScopeId: row.executionScopeId,
        generationId: identity.generationId,
        providerRecordId: row.providerRecordId,
        resolverId: selection.id,
        resolverVersion: selection.version,
      }
    })
  }

  async function resolved(
    identity: DestinationWorkIdentity,
    attempt: number,
    result: { url: string; method: string; providerStatus?: 'closed' | 'hidden' },
  ) {
    await updateActiveDestination(identity, {
      attemptCount: attempt,
      issueJson: null,
      nextAttemptAt: null,
      resultJson: JSON.stringify(result),
      status: 'resolved',
    }, 'awaiting_information')
  }

  async function retryWait(identity: DestinationWorkIdentity, attempt: number, input: { code: 'dependency_unavailable' | 'rate_limited' | 'request_timed_out' | 'transport_failed'; nextAttemptAt: string }) {
    const issue: ProcessingIssue = {
      stage: 'destination', code: input.code, action: null, causedBy: null,
      message: retryMessage(input.code), details: {},
    }
    await updateActiveDestination(identity, {
      attemptCount: attempt,
      issueJson: JSON.stringify(issue),
      nextAttemptAt: input.nextAttemptAt,
      resultJson: '{}',
      status: 'retry_wait',
    }, 'retrying')
  }

  async function terminal(identity: DestinationWorkIdentity, attempt: number, input: { status: 'action_required' | 'blocked' | 'exhausted'; issue: ProcessingIssue }) {
    await updateActiveDestination(identity, {
      attemptCount: attempt,
      issueJson: JSON.stringify(input.issue),
      nextAttemptAt: null,
      resultJson: '{}',
      status: input.status,
    }, input.status === 'blocked' ? 'blocked' : 'needs_action')
  }

  async function retry(rawInput: RetryCaptureProcessingInput) {
    return startNewGeneration('retry', retryCaptureProcessingInputSchema.parse(rawInput))
  }

  async function replay(rawInput: ReplayCaptureRevisionInput) {
    return startNewGeneration('replay', replayCaptureRevisionInputSchema.parse(rawInput))
  }

  async function startNewGeneration(
    operation: 'retry' | 'replay',
    request: RetryCaptureProcessingInput | ReplayCaptureRevisionInput,
  ): Promise<CaptureProcessingStartResult> {
    await materialization.ensureCapture(workspaceId, request.captureId)
    const requestFingerprint = fingerprint({ operation, request })
    const started = await database.transaction(async (tx) => {
      const receipt = await readReceipt(tx, workspaceId, operation, request.idempotencyKey)
      if (receipt) {
        if (receipt.requestFingerprint === requestFingerprint) return parseReceipt(receipt.resultJson)
        return blocked(request, await currentGuard(tx, workspaceId, request.captureId), 'invalid_input', 'This idempotency key was already used for a different request.')
      }
      const [capture] = await tx.select({ id: captures.id }).from(captures).where(and(
        eq(captures.id, request.captureId),
        eq(captures.workspaceId, workspaceId),
      )).limit(1).for('update')
      if (!capture) return blocked(request, null, 'impossible_state', 'The Capture does not exist in this workspace.')
      const concurrentReceipt = await readReceipt(tx, workspaceId, operation, request.idempotencyKey)
      if (concurrentReceipt) {
        if (concurrentReceipt.requestFingerprint === requestFingerprint) {
          return parseReceipt(concurrentReceipt.resultJson)
        }
        return blocked(request, await currentGuard(tx, workspaceId, request.captureId), 'invalid_input', 'This idempotency key was already used for a different request.')
      }
      const guard = await currentGuard(tx, workspaceId, request.captureId)
      let result: CaptureProcessingStartResult
      if (!guard || guard.captureRevision !== request.expectedCaptureRevision || guard.generationId !== request.expectedGenerationId) {
        result = blocked(request, guard, 'impossible_state', 'The Capture processing state has changed.')
      } else if (guard.status === 'promoted') {
        result = blocked(request, guard, 'impossible_state', 'Promoted Captures cannot be retried or replayed.')
      } else {
        const current = await currentQueuedGeneration(tx, request.captureId, true)
        if (!current || current.generationId !== request.expectedGenerationId) {
          result = blocked(request, guard, 'impossible_state', 'The Capture processing state has changed.')
        } else if (!canStartSuccessor(operation, current.destinationStatus)) {
          result = blocked(request, guard, 'impossible_state', 'The current destination resolution is not eligible for this command.')
        } else {
          const selection = selectResolver(current.adapterId, current.adapterVersion)
          if (!selection) {
            result = blocked(request, guard, 'impossible_state', 'This Capture has no supported destination resolver.')
          } else {
            const successor = await replaceWithSuccessor({
              current,
              newId,
              nowIso,
              selection,
              actor: request.actor,
              trigger: operation === 'retry' ? 'retry_destination' : 'replay',
              tx,
            })
            result = {
              captureId: request.captureId,
              requestCaptureRevision: request.expectedCaptureRevision,
              requestGenerationId: request.expectedGenerationId,
              idempotencyKey: request.idempotencyKey,
              status: 'started',
              captureRevision: successor.captureRevision,
              generationId: successor.generationId,
            }
          }
        }
      }
      await tx.insert(captureResolutionCommandReceipts).values({
        workspaceId,
        operation,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint,
        requestSnapshotJson: commandRequestSnapshot(request),
        resultJson: JSON.stringify(result),
        createdAt: nowIso(),
      })
      return result
    })
    if (started.status === 'started') await scheduleAcknowledged(request.captureId)
    return started
  }

  async function updateActiveDestination(identity: DestinationWorkIdentity, patch: Record<string, unknown>, summary: string) {
    const timestamp = nowIso()
    await database.transaction(async (tx) => {
      const [generation] = await tx.select({ id: captureResolutionGenerations.id })
        .from(captureResolutionGenerations).where(and(
          eq(captureResolutionGenerations.id, identity.generationId),
          eq(captureResolutionGenerations.workspaceId, identity.workspaceId),
          eq(captureResolutionGenerations.captureId, identity.captureId),
          eq(captureResolutionGenerations.captureRevision, identity.captureRevision),
          eq(captureResolutionGenerations.status, 'active'),
          eq(captureResolutionGenerations.inputFingerprint, identity.inputFingerprint),
        )).limit(1)
      if (!generation) return
      await tx.update(captureResolutionStageResults).set({ ...patch, updatedAt: timestamp })
        .where(and(eq(captureResolutionStageResults.generationId, identity.generationId), eq(captureResolutionStageResults.stage, 'destination')))
      await tx.update(captureResolutionGenerations).set({ processingSummary: summary, updatedAt: timestamp })
        .where(eq(captureResolutionGenerations.id, identity.generationId))
    })
  }

  async function currentQueuedGeneration(tx: Tx, captureId: string, acceptTerminal = false): Promise<CurrentGeneration | null> {
    const [row] = await tx.select({
      workspaceId: captures.workspaceId,
      captureId: captures.id,
      captureRevision: captures.revision,
      generationId: captureResolutionGenerations.id,
      inputFingerprint: captureResolutionGenerations.inputFingerprint,
      retryPolicyId: captureResolutionGenerations.retryPolicyId,
      retryPolicySnapshotJson: captureResolutionGenerations.retryPolicySnapshotJson,
      adapterId: captures.adapterId,
      adapterVersion: captures.adapterVersion,
      providerRecordId: captures.providerRecordId,
      connectorInstanceId: captureRevisions.connectorInstanceId,
      executionScopeId: captureRevisions.executionScopeId,
      destinationStatus: captureResolutionStageResults.status,
    }).from(captures)
      .innerJoin(captureResolutionGenerations, and(
        eq(captureResolutionGenerations.captureId, captures.id),
        eq(captureResolutionGenerations.captureRevision, captures.revision),
        eq(captureResolutionGenerations.status, 'active'),
      ))
      .innerJoin(captureRevisions, and(eq(captureRevisions.captureId, captures.id), eq(captureRevisions.revision, captures.revision)))
      .innerJoin(captureResolutionStageResults, and(eq(captureResolutionStageResults.generationId, captureResolutionGenerations.id), eq(captureResolutionStageResults.stage, 'destination')))
      .where(and(eq(captures.workspaceId, workspaceId), eq(captures.id, captureId))).limit(1)
    if (!row || (!acceptTerminal && !['queued', 'retry_wait'].includes(row.destinationStatus))) return null
    return row
  }

  return { scheduleAcknowledged, reconcile, reconcileDurableWork, start, resolved, retryWait, terminal, retry, replay }
}

async function markResolverUnavailable(tx: Tx, generationId: string, timestamp: string) {
  await tx.update(captureResolutionStageResults).set({
    issueJson: JSON.stringify({
      stage: 'destination', code: 'destination_unsupported', action: 'correct_capture',
      causedBy: null, message: 'No compatible destination resolver is available for this Capture.', details: {},
    }),
    nextAttemptAt: null,
    resultJson: '{}',
    status: 'action_required',
    updatedAt: timestamp,
  }).where(and(eq(captureResolutionStageResults.generationId, generationId), eq(captureResolutionStageResults.stage, 'destination')))
  await tx.update(captureResolutionGenerations).set({ processingSummary: 'needs_action', updatedAt: timestamp })
    .where(eq(captureResolutionGenerations.id, generationId))
}

async function markProviderIdentityUnavailable(tx: Tx, generationId: string, timestamp: string) {
  await tx.update(captureResolutionStageResults).set({
    issueJson: JSON.stringify({
      stage: 'destination', code: 'provider_identity_invalid', action: 'correct_capture',
      causedBy: null, message: 'The Capture does not include the provider identity required to resolve its destination.', details: {},
    }),
    nextAttemptAt: null,
    resultJson: '{}',
    status: 'action_required',
    updatedAt: timestamp,
  }).where(and(eq(captureResolutionStageResults.generationId, generationId), eq(captureResolutionStageResults.stage, 'destination')))
  await tx.update(captureResolutionGenerations).set({ processingSummary: 'needs_action', updatedAt: timestamp })
    .where(eq(captureResolutionGenerations.id, generationId))
}

async function replaceWithSuccessor(input: {
  readonly current: CurrentGeneration
  readonly newId: UuidV7Generator
  readonly nowIso: () => string
  readonly selection: DestinationResolverSelection
  readonly actor: { id: string; type: string; displayName?: string }
  readonly trigger: 'retry_destination' | 'replay'
  readonly tx: Tx
}) {
  const { current, newId, nowIso, selection, trigger, actor, tx } = input
  const timestamp = nowIso()
  const [ordinal] = await tx.select({ value: captureResolutionGenerations.ordinal }).from(captureResolutionGenerations)
    .where(eq(captureResolutionGenerations.captureId, current.captureId)).orderBy(desc(captureResolutionGenerations.ordinal)).limit(1)
  const generationId = newId()
  await tx.update(captureResolutionGenerations).set({ status: 'superseded', processingSummary: 'stopped', updatedAt: timestamp })
    .where(eq(captureResolutionGenerations.id, current.generationId))
  for (const stage of ['destination', 'information', 'promotion'] as const) {
    await tx.update(captureResolutionStageResults).set({
      status: 'superseded', nextAttemptAt: null, updatedAt: timestamp,
      issueJson: JSON.stringify({ stage, code: 'superseded_by_revision', action: null, causedBy: null, message: 'A newer processing generation replaced this one.', details: {} }),
    }).where(and(eq(captureResolutionStageResults.generationId, current.generationId), eq(captureResolutionStageResults.stage, stage)))
  }
  await tx.insert(captureResolutionGenerations).values({
    id: generationId, workspaceId: current.workspaceId, captureId: current.captureId, captureRevision: current.captureRevision,
    ordinal: (ordinal?.value ?? 0) + 1, trigger, status: 'active', processingSummary: 'processing', inputFingerprint: current.inputFingerprint,
    retryPolicyId: RETRY_POLICY_ID, retryPolicySnapshotJson: RETRY_POLICY_SNAPSHOT,
    resolverSelectionSnapshotJson: JSON.stringify(selection), createdByActorJson: JSON.stringify(actor),
    linkedJobId: null, createdAt: timestamp, updatedAt: timestamp,
  })
  await tx.insert(captureResolutionStageResults).values([
    { generationId, stage: 'destination', captureRevision: current.captureRevision, status: 'queued', attemptCount: 0, issueJson: null, resultJson: '{}', nextAttemptAt: null, resolverId: selection.id, resolverVersion: selection.version, remoteOperationId: null, updatedAt: timestamp },
    { generationId, stage: 'information', captureRevision: current.captureRevision, status: 'awaiting_manual', attemptCount: 0, issueJson: null, resultJson: '{}', nextAttemptAt: null, resolverId: null, resolverVersion: null, remoteOperationId: null, updatedAt: timestamp },
    { generationId, stage: 'promotion', captureRevision: current.captureRevision, status: 'not_ready', attemptCount: 0, issueJson: null, resultJson: '{}', nextAttemptAt: null, resolverId: null, resolverVersion: null, remoteOperationId: null, updatedAt: timestamp },
  ])
  return { captureRevision: current.captureRevision, generationId }
}

async function currentGuard(tx: Tx, workspaceId: string, captureId: string) {
  const [row] = await tx.select({ captureRevision: captures.revision, generationId: captureResolutionGenerations.id, status: captureResolutionGenerations.status })
    .from(captures).leftJoin(captureResolutionGenerations, and(
      eq(captureResolutionGenerations.captureId, captures.id),
      eq(captureResolutionGenerations.captureRevision, captures.revision),
      inArray(captureResolutionGenerations.status, ['active', 'promoted']),
    ))
    .where(and(eq(captures.id, captureId), eq(captures.workspaceId, workspaceId))).limit(1)
  return row ?? null
}

function blocked(
  request: RetryCaptureProcessingInput | ReplayCaptureRevisionInput,
  current: { captureRevision: number; generationId: string | null; status: string | null } | null,
  code: 'invalid_input' | 'impossible_state',
  message: string,
): CaptureProcessingStartResult {
  return {
    captureId: request.captureId, requestCaptureRevision: request.expectedCaptureRevision, requestGenerationId: request.expectedGenerationId,
    idempotencyKey: request.idempotencyKey, status: 'blocked', currentCaptureRevision: current?.captureRevision ?? request.expectedCaptureRevision,
    currentGenerationId: current?.generationId ?? null, blocker: { code, message },
  }
}

async function readReceipt(
  tx: Tx,
  workspaceId: string,
  operation: 'retry' | 'replay',
  idempotencyKey: string,
) {
  const [row] = await tx.select().from(captureResolutionCommandReceipts).where(and(
    eq(captureResolutionCommandReceipts.workspaceId, workspaceId),
    eq(captureResolutionCommandReceipts.operation, operation),
    eq(captureResolutionCommandReceipts.idempotencyKey, idempotencyKey),
  )).limit(1)
  return row
}

function parseReceipt(value: string): CaptureProcessingStartResult {
  return JSON.parse(value) as CaptureProcessingStartResult
}

function retryMessage(code: 'dependency_unavailable' | 'rate_limited' | 'request_timed_out' | 'transport_failed') {
  return ({ dependency_unavailable: 'The provider is temporarily unavailable.', rate_limited: 'The provider requested a later retry.', request_timed_out: 'The provider request timed out.', transport_failed: 'The provider request could not be completed.' })[code]
}

function retryCodeFromWork(reason: string | null): 'dependency_unavailable' | 'rate_limited' | 'request_timed_out' | 'transport_failed' {
  if (reason === 'rate_limit') return 'rate_limited'
  if (reason === 'operation_timeout') return 'request_timed_out'
  if (reason === 'network_interruption') return 'transport_failed'
  return 'dependency_unavailable'
}

function canStartSuccessor(operation: 'retry' | 'replay', status: string) {
  if (operation === 'retry') return ['action_required', 'blocked', 'exhausted'].includes(status)
  return ['action_required', 'blocked', 'exhausted', 'resolved'].includes(status)
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function parseDestinationRetryPolicy(id: string, snapshot: string): DestinationRetryPolicy | null {
  if (id !== RETRY_POLICY_ID) return null
  try {
    const value = JSON.parse(snapshot) as {
      initialDelaySeconds?: unknown
      maximumAttempts?: unknown
      maximumComputedDelaySeconds?: unknown
      multiplier?: unknown
      retryDelaysMs?: unknown
    }
    if (typeof value.maximumAttempts !== 'number' || !Number.isInteger(value.maximumAttempts) || value.maximumAttempts < 1 || value.maximumAttempts > 7) return null
    const retryDelaysMs = Array.isArray(value.retryDelaysMs)
      ? value.retryDelaysMs
      : legacyRetryDelays(value)
    if (!retryDelaysMs || retryDelaysMs.length !== 6) return null
    if (!retryDelaysMs.every((delay) => Number.isInteger(delay) && delay >= 1 && delay <= 86_400_000)) return null
    const maximumAttempts = value.maximumAttempts
    return {
      maximumAttempts,
      retryDelaysMs: [
        retryDelaysMs[0]!, retryDelaysMs[1]!, retryDelaysMs[2]!,
        retryDelaysMs[3]!, retryDelaysMs[4]!, retryDelaysMs[5]!,
      ],
    }
  } catch {
    return null
  }
}

function legacyRetryDelays(value: {
  initialDelaySeconds?: unknown
  maximumComputedDelaySeconds?: unknown
  multiplier?: unknown
}) {
  const initialDelaySeconds = value.initialDelaySeconds
  const maximumComputedDelaySeconds = value.maximumComputedDelaySeconds
  const multiplier = value.multiplier
  if (
    typeof initialDelaySeconds !== 'number' || typeof maximumComputedDelaySeconds !== 'number'
    || typeof multiplier !== 'number' || initialDelaySeconds < 1 || maximumComputedDelaySeconds < 1 || multiplier < 1
  ) return null
  return Array.from({ length: 6 }, (_, index) => Math.min(
    initialDelaySeconds * 1_000 * multiplier ** index,
    maximumComputedDelaySeconds * 1_000,
  ))
}

function commandRequestSnapshot(request: RetryCaptureProcessingInput | ReplayCaptureRevisionInput) {
  const rationale = 'rationale' in request ? request.rationale ?? null : null
  // Preserve the exact benign rationale for audit. A credential-shaped rationale
  // is represented by an explicit redaction marker and a one-way correlation
  // fingerprint instead of retaining any secret-bearing text.
  return JSON.stringify({
    actor: request.actor,
    rationale: typeof rationale === 'string' && containsSensitiveRationale(rationale)
      ? { redacted: true, sha256: createHash('sha256').update(rationale).digest('hex') }
      : rationale,
  })
}

function containsSensitiveRationale(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SENSITIVE_KEY_SUBSTRINGS.split('|').some((term) =>
    normalized.includes(term.replace(/[^a-z0-9]/g, '')))
    || /(?:api[ _-]?key|client[ _-]?secret|signed[ _-]?(?:credential|request)|x-amz|jwt|session|csrf|xsrf|nonce)/i.test(value)
}
