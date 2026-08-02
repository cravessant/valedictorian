/**
 * Portable workspace authority protocol.
 *
 * This module deliberately owns wire-safe protocol semantics without owning
 * persistence. Durable storage and migration of these values is a P12 concern.
 */

export const workspaceFailureDefinitions = {
  capability_unsupported: { httpStatus: 409, kind: 'conflict', retry: 'only-after-capability-change' },
  capability_temporarily_unavailable: { httpStatus: 503, kind: 'unavailable', retry: 'bounded-backoff-and-rediscovery' },
  workspace_not_found: { httpStatus: 404, kind: 'not_found', retry: 'rediscover-workspace' },
  workspace_identity_conflict: { httpStatus: 409, kind: 'conflict', retry: 'reconcile-stable-workspace-and-authority-identities' },
  protocol_version_unsupported: { httpStatus: 409, kind: 'conflict', retry: 'upgrade-source-or-target-before-transfer' },
  authority_unavailable: { httpStatus: 503, kind: 'unavailable', retry: 'rediscover-current-authority-never-queue-offline-mutation' },
  authority_epoch_conflict: { httpStatus: 409, kind: 'conflict', retry: 'rediscover-and-reconcile-before-new-command' },
  workspace_fenced: { httpStatus: 409, kind: 'conflict', retry: 'discover-activation-or-abort-receipt' },
  workspace_retired: { httpStatus: 409, kind: 'conflict', retry: 'route-to-current-authority' },
  active_work_conflict: { httpStatus: 409, kind: 'conflict', retry: 'settle-admitted-work-before-final-snapshot' },
  quiesce_timeout: { httpStatus: 409, kind: 'conflict', retry: 'keep-source-fenced-and-retry-or-explicitly-abort' },
  revision_conflict: { httpStatus: 409, kind: 'conflict', retry: 'read-current-revision-and-reconcile' },
  idempotency_conflict: { httpStatus: 409, kind: 'conflict', retry: 'use-original-fingerprint-or-new-key' },
  snapshot_invalid: { httpStatus: 422, kind: 'validation', retry: 'create-new-snapshot' },
  snapshot_incompatible: { httpStatus: 409, kind: 'conflict', retry: 'upgrade-target-or-use-supported-snapshot' },
  snapshot_integrity_failed: { httpStatus: 409, kind: 'integrity', retry: 'discard-stage-and-create-new-snapshot' },
  transfer_phase_conflict: { httpStatus: 409, kind: 'conflict', retry: 'read-transfer-receipt' },
  transfer_not_found: { httpStatus: 404, kind: 'not_found', retry: 'rediscover-transfer-or-start-a-new-transfer' },
  receipt_not_found: { httpStatus: 404, kind: 'not_found', retry: 'confirm-authority-epoch-and-operation-before-new-command' },
  abort_not_allowed: { httpStatus: 409, kind: 'conflict', retry: 'start-reverse-transfer-after-activation' },
  byok_key_unavailable: { httpStatus: 503, kind: 'unavailable', retry: 'restore-key-access-before-fence-or-activation' },
  secure_storage_unavailable: { httpStatus: 503, kind: 'unavailable', retry: 'restore-protected-storage-before-secret-operation' },
  ciphertext_incompatible: { httpStatus: 409, kind: 'integrity', retry: 'rewrap-with-a-supported-envelope-before-fence' },
  secret_material_forbidden: { httpStatus: 422, kind: 'validation', retry: 'remove-plaintext-or-local-handle' },
  authentication_required: { httpStatus: 401, kind: 'authentication', retry: 'authenticate' },
  authority_forbidden: { httpStatus: 403, kind: 'authorization', retry: 'obtain-explicit-authority' },
  rate_limited: { httpStatus: 429, kind: 'rate_limit', retry: 'honor-retry-after' },
  internal_error: { httpStatus: 500, kind: 'internal', retry: 'query-receipt-before-retrying-mutation' },
} as const

export type WorkspaceFailureCode = keyof typeof workspaceFailureDefinitions
export type WorkspaceFailure = Readonly<{
  code: WorkspaceFailureCode
  httpStatus: (typeof workspaceFailureDefinitions)[WorkspaceFailureCode]['httpStatus']
  kind: (typeof workspaceFailureDefinitions)[WorkspaceFailureCode]['kind']
  message: string
  retry: (typeof workspaceFailureDefinitions)[WorkspaceFailureCode]['retry']
}>

export class WorkspaceProtocolError extends Error {
  readonly failure: WorkspaceFailure

  constructor(code: WorkspaceFailureCode, message: string) {
    super(message)
    this.name = 'WorkspaceProtocolError'
    this.failure = createWorkspaceFailure(code, message)
  }
}

export function createWorkspaceFailure(
  code: WorkspaceFailureCode,
  message: string,
): WorkspaceFailure {
  return { code, message, ...workspaceFailureDefinitions[code] }
}

export type WorkspaceCapabilityState = 'supported' | 'temporarily_unavailable' | 'unsupported'
export type WorkspaceCapabilityDocument = Readonly<{
  authorityEpoch: number
  authorityId: string
  capabilities: Readonly<Record<string, WorkspaceCapabilityState>>
  version: string
  workspaceId: string
}>

export type WorkspaceIdentityV1 = Readonly<{
  name: string
  source: string
  workspaceId: string
}>

export type WorkspaceIdentityV2 = WorkspaceIdentityV1 & Readonly<{
  authorityEpoch: number
  authorityId: string
  capabilityDocumentVersion: string
  capabilityStates: Readonly<Record<string, WorkspaceCapabilityState>>
}>

export type WorkspaceIdentity = WorkspaceIdentityV1 | WorkspaceIdentityV2

export function isWorkspaceIdentityV2(identity: WorkspaceIdentity): identity is WorkspaceIdentityV2 {
  return 'authorityEpoch' in identity
}

export type WorkspaceReplicaState = 'active' | 'candidate' | 'fenced' | 'retired'
export type WorkspaceAdmissionState = Readonly<{
  authorityEpoch: number
  authorityId: string
  replicaState: WorkspaceReplicaState
  workspaceId: string
}>

export type PortableMutationContext = Readonly<{
  authorityEpoch: number
  idempotencyKey: string
  operation: string
  requestFingerprint: string
  workspaceId: string
}>

function requireNonEmpty(value: string, field: string): void {
  if (!value.trim()) throw new TypeError(`${field} must be a non-empty string`)
}

/**
 * Shared admission gate for HTTP, scheduler claims, maintenance jobs, and
 * internal mutation entrypoints. Callers must not implement their own fence.
 */
export function admitPortableMutation(
  state: WorkspaceAdmissionState,
  context: PortableMutationContext,
): void {
  requireNonEmpty(context.idempotencyKey, 'idempotencyKey')
  requireNonEmpty(context.requestFingerprint, 'requestFingerprint')
  if (context.workspaceId !== state.workspaceId) {
    throw new WorkspaceProtocolError('workspace_identity_conflict', 'Workspace identity does not match authority.')
  }
  if (context.authorityEpoch !== state.authorityEpoch) {
    throw new WorkspaceProtocolError('authority_epoch_conflict', 'Workspace authority epoch is stale.')
  }
  if (state.replicaState === 'fenced') {
    throw new WorkspaceProtocolError('workspace_fenced', 'Workspace authority is fenced.')
  }
  if (state.replicaState === 'retired') {
    throw new WorkspaceProtocolError('workspace_retired', 'Workspace authority is retired.')
  }
  if (state.replicaState !== 'active') {
    throw new WorkspaceProtocolError('authority_unavailable', 'Workspace authority is not active.')
  }
}

export function admitSchedulerClaim(
  state: WorkspaceAdmissionState,
  context: PortableMutationContext,
): void {
  admitPortableMutation(state, context)
}

export type WorkspaceReceiptOutcome =
  | Readonly<{ failure: WorkspaceFailure; kind: 'failure' }>
  | Readonly<{ kind: 'success'; value: unknown }>

export type WorkspaceReceipt = Readonly<{
  actor: string
  authorityEpoch: number
  authorityId: string
  evidenceDigests: readonly string[]
  idempotencyKey: string
  issuedAt: string
  operation: string
  outcome: WorkspaceReceiptOutcome
  requestFingerprint: string
  revisionOrPhase: string
  transferId: string | null
  workspaceId: string
}>

export type WorkspaceReceiptInput = Omit<WorkspaceReceipt, 'issuedAt'> & Readonly<{ issuedAt?: string }>

export function workspaceReceiptKey(
  input: Pick<WorkspaceReceipt, 'authorityEpoch' | 'idempotencyKey' | 'operation' | 'workspaceId'>,
): string {
  return JSON.stringify([
    input.workspaceId,
    input.authorityEpoch,
    input.operation,
    input.idempotencyKey,
  ])
}

export type WorkspaceReceiptLedger = Readonly<{
  lookup(input: Pick<WorkspaceReceipt, 'authorityEpoch' | 'idempotencyKey' | 'operation' | 'workspaceId'>): WorkspaceReceipt
  record(input: WorkspaceReceiptInput): WorkspaceReceipt
}>

/** In-memory reference semantics; P12 supplies a durable adapter. */
export function createWorkspaceReceiptLedger(
  now: () => string = () => new Date().toISOString(),
): WorkspaceReceiptLedger {
  const receipts = new Map<string, WorkspaceReceipt>()
  return {
    lookup(input) {
      const receipt = receipts.get(workspaceReceiptKey(input))
      if (!receipt) throw new WorkspaceProtocolError('receipt_not_found', 'No receipt exists for the idempotency key.')
      return receipt
    },
    record(input) {
      requireNonEmpty(input.idempotencyKey, 'idempotencyKey')
      requireNonEmpty(input.requestFingerprint, 'requestFingerprint')
      const key = workspaceReceiptKey(input)
      const existing = receipts.get(key)
      if (existing) {
        if (existing.requestFingerprint !== input.requestFingerprint) {
          throw new WorkspaceProtocolError('idempotency_conflict', 'Idempotency key was used for another request.')
        }
        return existing
      }
      const receipt = Object.freeze({ ...input, issuedAt: input.issuedAt ?? now() })
      receipts.set(key, receipt)
      return receipt
    },
  }
}

export const workspaceTransferPhases = [
  'idle',
  'prepared',
  'snapshot_staged',
  'source_fenced',
  'final_snapshot_verified',
  'activated',
  'source_retired',
  'aborted',
] as const

export type WorkspaceTransferPhase = (typeof workspaceTransferPhases)[number]
export type WorkspaceTransfer = Readonly<{
  authorityEpoch: number
  phase: WorkspaceTransferPhase
  sourceAuthorityId: string
  sourceState: WorkspaceReplicaState
  targetAuthorityId: string
  targetState: 'absent' | WorkspaceReplicaState
  transferId: string
  workspaceId: string
}>

function transition(
  transfer: WorkspaceTransfer,
  expected: readonly WorkspaceTransferPhase[],
  update: Partial<WorkspaceTransfer>,
): WorkspaceTransfer {
  if (!expected.includes(transfer.phase)) {
    throw new WorkspaceProtocolError('transfer_phase_conflict', `Transfer is in ${transfer.phase}.`)
  }
  return Object.freeze({ ...transfer, ...update })
}

export function prepareWorkspaceTransfer(input: {
  authorityEpoch: number
  sourceAuthorityId: string
  targetAuthorityId: string
  transferId: string
  workspaceId: string
}): WorkspaceTransfer {
  if (input.sourceAuthorityId === input.targetAuthorityId) {
    throw new WorkspaceProtocolError('workspace_identity_conflict', 'Source and target authorities must differ.')
  }
  return Object.freeze({
    ...input,
    phase: 'prepared',
    sourceState: 'active',
    targetState: 'candidate',
  })
}

export function stageWorkspaceSnapshot(transfer: WorkspaceTransfer): WorkspaceTransfer {
  return transition(transfer, ['prepared'], { phase: 'snapshot_staged' })
}

export function fenceWorkspaceSource(transfer: WorkspaceTransfer): WorkspaceTransfer {
  return transition(transfer, ['snapshot_staged'], {
    phase: 'source_fenced',
    sourceState: 'fenced',
  })
}

export function verifyWorkspaceFinalSnapshot(transfer: WorkspaceTransfer): WorkspaceTransfer {
  return transition(transfer, ['source_fenced'], { phase: 'final_snapshot_verified' })
}

export function activateWorkspaceTarget(
  transfer: WorkspaceTransfer,
  expectedAuthorityEpoch: number,
): WorkspaceTransfer {
  if (expectedAuthorityEpoch !== transfer.authorityEpoch) {
    throw new WorkspaceProtocolError('authority_epoch_conflict', 'Activation authority epoch is stale.')
  }
  return transition(transfer, ['final_snapshot_verified'], {
    authorityEpoch: transfer.authorityEpoch + 1,
    phase: 'activated',
    targetState: 'active',
  })
}

export function retireWorkspaceSource(transfer: WorkspaceTransfer): WorkspaceTransfer {
  return transition(transfer, ['activated'], {
    phase: 'source_retired',
    sourceState: 'retired',
  })
}

export function abortWorkspaceTransfer(transfer: WorkspaceTransfer): WorkspaceTransfer {
  if (transfer.phase === 'activated' || transfer.phase === 'source_retired') {
    throw new WorkspaceProtocolError('abort_not_allowed', 'Activated transfers require a reverse transfer.')
  }
  const aborted = transition(
    transfer,
    ['prepared', 'snapshot_staged', 'source_fenced', 'final_snapshot_verified'],
    { phase: 'aborted', sourceState: 'active', targetState: 'retired' },
  )
  return aborted
}

export function reverseWorkspaceTransfer(
  transfer: WorkspaceTransfer,
  reverseTransferId: string,
): WorkspaceTransfer {
  if (transfer.phase !== 'activated' && transfer.phase !== 'source_retired') {
    throw new WorkspaceProtocolError('transfer_phase_conflict', 'Only an activated transfer can be reversed.')
  }
  if (reverseTransferId === transfer.transferId) {
    throw new WorkspaceProtocolError('idempotency_conflict', 'A reverse transfer requires a new transfer id.')
  }
  return prepareWorkspaceTransfer({
    authorityEpoch: transfer.authorityEpoch,
    sourceAuthorityId: transfer.targetAuthorityId,
    targetAuthorityId: transfer.sourceAuthorityId,
    transferId: reverseTransferId,
    workspaceId: transfer.workspaceId,
  })
}
