import {
  abortWorkspaceTransfer,
  activateWorkspaceTarget,
  fenceWorkspaceSource,
  prepareWorkspaceTransfer,
  retireWorkspaceSource,
  stageWorkspaceSnapshot,
  verifyWorkspaceFinalSnapshot,
  WorkspaceProtocolError,
  type WorkspaceReceipt,
  type WorkspaceTransfer,
} from '@sparxie/valedictorian-workspace-server'
import {
  type WorkspaceOldRuntimeVerification,
} from './workspace-migration-alpha55.js'
import { canonicalJson, sha256 } from './workspace-migration-canonical.js'
import type { AuthenticatedWorkspaceReceipt } from './workspace-migration-receipt.js'
import {
  supportedLocalWorkspaceMigrationFixtures,
  type WorkspaceSnapshotArtifact,
  type WorkspaceSnapshotInspection,
} from './workspace-migration-snapshot.js'

export interface WorkspaceMigrationCheckpoint {
  backupFenceTokenDigest: string
  backupSnapshotId: string
  downgradeVerificationDigest: string | null
  fenceToken: string | null
  finalSnapshotId: string | null
  receipts: readonly AuthenticatedWorkspaceReceipt[]
  transfer: WorkspaceTransfer
  version: 2
}

export function reconcileMigrationCheckpoint(checkpoint: WorkspaceMigrationCheckpoint): void {
  const receipts = checkpoint.receipts.map((envelope) => envelope.receipt)
  const prepare = receipts[0]
  if (!prepare || prepare.operation !== 'transfers.prepare') checkpointConflict()
  let transfer = prepareWorkspaceTransfer({
    authorityEpoch: prepare.authorityEpoch,
    sourceAuthorityId: checkpoint.transfer.sourceAuthorityId,
    targetAuthorityId: checkpoint.transfer.targetAuthorityId,
    transferId: checkpoint.transfer.transferId,
    workspaceId: checkpoint.transfer.workspaceId,
  })
  let fenced = false
  let finalized = false
  let rollback = false
  for (const receipt of receipts) {
    let evidence: readonly string[]
    let authorityId: string
    switch (receipt.operation) {
      case 'transfers.prepare':
        if (receipt !== prepare) checkpointConflict()
        evidence = [checkpoint.backupSnapshotId, checkpoint.backupFenceTokenDigest]
        authorityId = transfer.sourceAuthorityId
        break
      case 'snapshots.stage':
        transfer = stageWorkspaceSnapshot(transfer)
        evidence = [checkpoint.backupSnapshotId]
        authorityId = transfer.targetAuthorityId
        break
      case 'transfers.fenceSource':
        transfer = fenceWorkspaceSource(transfer)
        fenced = true
        evidence = [sha256(requireMigrationFenceToken(checkpoint.fenceToken))]
        authorityId = transfer.sourceAuthorityId
        break
      case 'snapshots.finalize':
        if (transfer.phase !== 'source_fenced' || !checkpoint.finalSnapshotId) {
          checkpointConflict()
        }
        finalized = true
        evidence = [checkpoint.finalSnapshotId]
        authorityId = transfer.sourceAuthorityId
        break
      case 'snapshots.verify':
        if (!finalized || !checkpoint.finalSnapshotId) checkpointConflict()
        transfer = verifyWorkspaceFinalSnapshot(transfer)
        evidence = [checkpoint.finalSnapshotId]
        authorityId = transfer.targetAuthorityId
        break
      case 'transfers.activateTarget':
        if (!checkpoint.finalSnapshotId) checkpointConflict()
        transfer = activateWorkspaceTarget(transfer, transfer.authorityEpoch)
        evidence = [checkpoint.finalSnapshotId]
        authorityId = transfer.targetAuthorityId
        break
      case 'transfers.verifyRollbackBackup':
        if (transfer.phase !== 'activated' || !checkpoint.downgradeVerificationDigest) {
          checkpointConflict()
        }
        rollback = true
        evidence = [checkpoint.backupSnapshotId, checkpoint.downgradeVerificationDigest]
        authorityId = transfer.targetAuthorityId
        break
      case 'transfers.retireSource':
        if (!rollback || !checkpoint.downgradeVerificationDigest) checkpointConflict()
        transfer = retireWorkspaceSource(transfer)
        evidence = [checkpoint.downgradeVerificationDigest]
        authorityId = transfer.targetAuthorityId
        break
      case 'transfers.abort':
        transfer = abortWorkspaceTransfer(transfer)
        evidence = [checkpoint.backupSnapshotId]
        authorityId = transfer.sourceAuthorityId
        break
      default:
        checkpointConflict()
    }
    assertReceiptMatches(receipt, transfer, authorityId!, evidence!)
  }
  if (
    canonicalJson(transfer) !== canonicalJson(checkpoint.transfer)
    || fenced !== Boolean(checkpoint.fenceToken)
    || finalized !== Boolean(checkpoint.finalSnapshotId)
    || rollback !== Boolean(checkpoint.downgradeVerificationDigest)
  ) {
    checkpointConflict()
  }
}

export function validateOldRuntimeVerification(
  verification: WorkspaceOldRuntimeVerification,
  fixture: (typeof supportedLocalWorkspaceMigrationFixtures)[number],
  backup: WorkspaceSnapshotArtifact,
): void {
  const expectedInspection = snapshotInspection(backup)
  const expectedDigest = sha256(canonicalJson({
    fixture,
    inspection: verification.inspection,
    snapshotId: backup.manifest.snapshotId,
  }))
  if (
    canonicalJson(verification.fixture) !== canonicalJson(fixture)
    || canonicalJson(verification.inspection) !== canonicalJson(expectedInspection)
    || verification.evidenceDigest !== expectedDigest
  ) {
    throw new WorkspaceProtocolError(
      'snapshot_integrity_failed',
      'Old-runtime verification does not reconcile with the immutable backup.',
    )
  }
}

export function checkpointAuthorityId(transfer: WorkspaceTransfer): string {
  return transfer.phase === 'activated' || transfer.phase === 'source_retired'
    ? transfer.targetAuthorityId
    : transfer.sourceAuthorityId
}

export function requireMigrationFenceToken(value: string | null): string {
  if (!value?.trim()) throw new TypeError('fenceToken must be a non-empty string.')
  return value
}

function assertReceiptMatches(
  receipt: WorkspaceReceipt,
  transfer: WorkspaceTransfer,
  authorityId: string,
  evidenceDigests: readonly string[],
): void {
  const requestFingerprint = sha256(canonicalJson({
    authorityEpoch: transfer.authorityEpoch,
    evidenceDigests,
    operation: receipt.operation,
    phase: transfer.phase,
    transferId: transfer.transferId,
  }))
  const outcome = receipt.outcome
  if (
    receipt.actor !== 'workspace-migration-recovery'
    || receipt.authorityEpoch !== transfer.authorityEpoch
    || receipt.authorityId !== authorityId
    || canonicalJson(receipt.evidenceDigests) !== canonicalJson(evidenceDigests)
    || receipt.idempotencyKey !== `${transfer.transferId}:${receipt.operation}`
    || outcome.kind !== 'success'
    || canonicalJson(outcome.value) !== canonicalJson({ phase: transfer.phase })
    || receipt.requestFingerprint !== requestFingerprint
    || receipt.revisionOrPhase !== transfer.phase
    || receipt.transferId !== transfer.transferId
    || receipt.workspaceId !== transfer.workspaceId
  ) {
    checkpointConflict()
  }
}

function snapshotInspection(artifact: WorkspaceSnapshotArtifact): WorkspaceSnapshotInspection {
  const {
    logicalRecordCounts,
    requiredCapabilities,
    revisionToken,
    schemaVersion,
    secretEnvelopeCount,
    secretEnvelopeDigest,
    workspaceId,
  } = artifact.manifest
  return {
    logicalRecordCounts,
    requiredCapabilities,
    revisionToken,
    schemaVersion,
    secretEnvelopeCount,
    secretEnvelopeDigest,
    workspaceId,
  }
}

function checkpointConflict(): never {
  throw new WorkspaceProtocolError(
    'idempotency_conflict',
    'Signed migration checkpoint does not reconcile with its receipt chain.',
  )
}
