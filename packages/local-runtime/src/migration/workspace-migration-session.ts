import fs from 'node:fs'
import path from 'node:path'
import {
  abortWorkspaceTransfer,
  activateWorkspaceTarget,
  createWorkspaceReceiptLedger,
  fenceWorkspaceSource,
  prepareWorkspaceTransfer,
  retireWorkspaceSource,
  stageWorkspaceSnapshot,
  verifyWorkspaceFinalSnapshot,
  WorkspaceProtocolError,
  type WorkspaceReceipt,
  type WorkspaceReceiptLedger,
  type WorkspaceTransfer,
} from '@sparxie/valedictorian-workspace-server'
import { writeAtomicDocument } from '../atomic-document.js'
import {
  supportedLocalWorkspaceMigrationFixtures,
  type WorkspaceMigrationInterruptionPoint,
  type WorkspaceSnapshotArtifact,
  type WorkspaceSnapshotInspector,
} from './workspace-migration-snapshot.js'
import {
  createImmutableWorkspaceSnapshot,
  reconcileWorkspaceSnapshot,
  resolveWorkspaceSnapshotArtifact,
  restoreWorkspaceSnapshot,
  verifyWorkspaceSnapshot,
} from './workspace-migration-snapshot.js'
import {
  verifyAlpha55ImmutableBackup,
  type WorkspaceOldRuntimeVerification,
} from './workspace-migration-alpha55.js'
import { canonicalJson, sha256 } from './workspace-migration-canonical.js'
import {
  checkpointAuthorityId,
  reconcileMigrationCheckpoint,
  requireMigrationFenceToken,
  validateOldRuntimeVerification,
  type WorkspaceMigrationCheckpoint,
} from './workspace-migration-checkpoint.js'
import {
  discardMigrationCandidate,
  resolveMigrationJournalPath,
  resolveMigrationRoots,
  resolveMigrationSnapshotRoot,
} from './workspace-migration-paths.js'
import {
  authenticateWorkspaceDocument,
  authenticateWorkspaceReceipt,
  verifyWorkspaceDocument,
  verifyWorkspaceReceipt,
  type AuthenticatedWorkspaceDocument,
  type AuthenticatedWorkspaceReceipt,
  type WorkspaceReceiptAuthority,
} from './workspace-migration-receipt.js'

export type WorkspaceMigrationSessionInterruptionPoint =
  | WorkspaceMigrationInterruptionPoint
  | 'abort.candidate_discarded'
  | 'abort.persisted'
  | 'abort.unfenced'
  | 'fence.persisted'
  | 'prepare.unfenced'
  | 'receipt.recorded'
  | 'journal.before_write'
  | 'journal.persisted'

export interface WorkspaceSourceFencePort {
  fenceAndDrain(input: {
    expectedFenceToken: string | null
    transferId: string
    workspaceId: string
  }): Promise<{ fenceToken: string }>
  unfence(input: {
    fenceToken: string | null
    transferId: string
    workspaceId: string
  }): Promise<void>
}

export interface LocalWorkspaceMigrationOptions {
  authorities: Readonly<Record<string, WorkspaceReceiptAuthority>>
  evidenceRoot: string
  inspect: WorkspaceSnapshotInspector
  interrupt?: (point: WorkspaceMigrationSessionInterruptionPoint) => Promise<void> | void
  now?: () => string
  sourceFence: WorkspaceSourceFencePort
  sourceRoot: string
  targetRoot: string
}

export class LocalWorkspaceMigrationSession {
  readonly #authorities: Readonly<Record<string, WorkspaceReceiptAuthority>>
  readonly #evidenceRoot: string
  readonly #inspect: WorkspaceSnapshotInspector
  readonly #interrupt: NonNullable<LocalWorkspaceMigrationOptions['interrupt']>
  readonly #journalPath: string
  readonly #now: () => string
  readonly #receiptLedger: WorkspaceReceiptLedger
  readonly #sourceFence: WorkspaceSourceFencePort
  readonly #sourceRoot: string
  readonly #targetRoot: string
  #checkpoint: WorkspaceMigrationCheckpoint
  #poisoned = false

  private constructor(
    options: LocalWorkspaceMigrationOptions,
    checkpoint: WorkspaceMigrationCheckpoint,
  ) {
    const roots = resolveMigrationRoots(options)
    this.#authorities = options.authorities
    this.#evidenceRoot = roots.evidenceRoot
    this.#inspect = options.inspect
    this.#interrupt = options.interrupt ?? (() => undefined)
    this.#checkpoint = checkpoint
    this.#journalPath = resolveMigrationJournalPath(
      roots.evidenceRoot,
      checkpoint.transfer.transferId,
    )
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#sourceFence = options.sourceFence
    this.#sourceRoot = roots.sourceRoot
    this.#targetRoot = roots.targetRoot
    this.#receiptLedger = createWorkspaceReceiptLedger(this.#now)
    for (const envelope of checkpoint.receipts) {
      verifyWorkspaceReceipt(envelope, this.#authority(envelope.receipt.authorityId))
      this.#receiptLedger.record(envelope.receipt)
    }
  }

  static async create(
    options: LocalWorkspaceMigrationOptions & {
      authorityEpoch: number
      sourceAuthorityId: string
      targetAuthorityId: string
      transferId: string
      workspaceId: string
    },
  ): Promise<LocalWorkspaceMigrationSession> {
    const roots = resolveMigrationRoots(options)
    if (fs.existsSync(roots.targetRoot)) {
      throw new TypeError('Migration target workspace must not exist before preparation.')
    }
    const transfer = prepareWorkspaceTransfer({
      authorityEpoch: options.authorityEpoch,
      sourceAuthorityId: options.sourceAuthorityId,
      targetAuthorityId: options.targetAuthorityId,
      transferId: options.transferId,
      workspaceId: options.workspaceId,
    })
    const drained = await options.sourceFence.fenceAndDrain({
      expectedFenceToken: null,
      transferId: options.transferId,
      workspaceId: options.workspaceId,
    })
    const drainToken = requireMigrationFenceToken(drained.fenceToken)
    try {
      const backup = await createImmutableWorkspaceSnapshot({
        authorityEpoch: options.authorityEpoch,
        authorityId: options.sourceAuthorityId,
        createdAt: (options.now ?? (() => new Date().toISOString()))(),
        exportRoot: resolveMigrationSnapshotRoot(roots.evidenceRoot),
        fenceToken: drainToken,
        inspect: options.inspect,
        interrupt: options.interrupt,
        workspaceRoot: roots.sourceRoot,
      })
      const session = new LocalWorkspaceMigrationSession(options, {
        backupFenceTokenDigest: sha256(drainToken),
        backupSnapshotId: backup.manifest.snapshotId,
        downgradeVerificationDigest: null,
        fenceToken: null,
        finalSnapshotId: null,
        receipts: [],
        transfer,
        version: 2,
      })
      await session.#recordAndPersist(
        'transfers.prepare',
        options.sourceAuthorityId,
        [backup.manifest.snapshotId, sha256(drainToken)],
      )
      await options.sourceFence.unfence({
        fenceToken: drainToken,
        transferId: options.transferId,
        workspaceId: options.workspaceId,
      })
      await options.interrupt?.('prepare.unfenced')
      return session
    } catch (error) {
      await options.sourceFence.unfence({
        fenceToken: drainToken,
        transferId: options.transferId,
        workspaceId: options.workspaceId,
      })
      throw error
    }
  }

  static async open(
    options: LocalWorkspaceMigrationOptions & { transferId: string },
  ): Promise<LocalWorkspaceMigrationSession> {
    const roots = resolveMigrationRoots(options)
    const checkpoint = readAuthenticatedMigrationCheckpoint({
      authorities: options.authorities,
      journalPath: resolveMigrationJournalPath(roots.evidenceRoot, options.transferId),
      transferId: options.transferId,
    })
    const session = new LocalWorkspaceMigrationSession(options, checkpoint)
    await verifyWorkspaceSnapshot(session.backup)
    if (
      !session.backup.manifest.fenceToken
      || sha256(session.backup.manifest.fenceToken) !== checkpoint.backupFenceTokenDigest
    ) {
      throw new WorkspaceProtocolError(
        'snapshot_integrity_failed',
        'Prepared backup does not prove a drained source.',
      )
    }
    if (session.finalSnapshot) await verifyWorkspaceSnapshot(session.finalSnapshot)
    await session.#reconcileExternalFence()
    return session
  }

  get backup(): WorkspaceSnapshotArtifact {
    return resolveWorkspaceSnapshotArtifact(
      resolveMigrationSnapshotRoot(this.#evidenceRoot),
      this.#checkpoint.backupSnapshotId,
    )
  }

  get finalSnapshot(): WorkspaceSnapshotArtifact | null {
    return this.#checkpoint.finalSnapshotId
      ? resolveWorkspaceSnapshotArtifact(
        resolveMigrationSnapshotRoot(this.#evidenceRoot),
        this.#checkpoint.finalSnapshotId,
      )
      : null
  }

  get receipts(): readonly AuthenticatedWorkspaceReceipt[] {
    return this.#checkpoint.receipts
  }

  get transfer(): WorkspaceTransfer {
    return this.#checkpoint.transfer
  }

  async stageSnapshot(): Promise<void> {
    this.#assertUsable()
    if (this.transfer.phase === 'snapshot_staged') {
      await reconcileWorkspaceSnapshot(this.backup, this.#targetRoot, this.#inspect)
      return
    }
    if (!fs.existsSync(this.#targetRoot)) {
      await restoreWorkspaceSnapshot(this.backup, this.#targetRoot, {
        interrupt: this.#interrupt,
      })
    }
    await reconcileWorkspaceSnapshot(this.backup, this.#targetRoot, this.#inspect)
    this.#checkpoint = {
      ...this.#checkpoint,
      transfer: stageWorkspaceSnapshot(this.transfer),
    }
    await this.#recordAndPersist(
      'snapshots.stage',
      this.transfer.targetAuthorityId,
      [this.backup.manifest.snapshotId],
    )
  }

  async fenceSource(): Promise<void> {
    this.#assertUsable()
    if (this.transfer.phase === 'snapshot_staged') {
      const fenced = await this.#sourceFence.fenceAndDrain({
        expectedFenceToken: null,
        transferId: this.transfer.transferId,
        workspaceId: this.transfer.workspaceId,
      })
      requireMigrationFenceToken(fenced.fenceToken)
      this.#checkpoint = {
        ...this.#checkpoint,
        fenceToken: fenced.fenceToken,
        transfer: fenceWorkspaceSource(this.transfer),
      }
      await this.#recordAndPersist(
        'transfers.fenceSource',
        this.transfer.sourceAuthorityId,
        [sha256(fenced.fenceToken)],
      )
      await this.#interrupt('fence.persisted')
    }
    if (this.transfer.phase !== 'source_fenced') {
      throw new WorkspaceProtocolError(
        'transfer_phase_conflict',
        `Transfer is in ${this.transfer.phase}.`,
      )
    }
    const fenceToken = requireMigrationFenceToken(this.#checkpoint.fenceToken)
    const resumedFence = await this.#sourceFence.fenceAndDrain({
      expectedFenceToken: fenceToken,
      transferId: this.transfer.transferId,
      workspaceId: this.transfer.workspaceId,
    })
    if (resumedFence.fenceToken !== fenceToken) {
      throw new WorkspaceProtocolError('authority_forbidden', 'Source fence identity changed.')
    }
    if (this.finalSnapshot) {
      await verifyWorkspaceSnapshot(this.finalSnapshot)
      return
    }
    const finalSnapshot = await createImmutableWorkspaceSnapshot({
      authorityEpoch: this.transfer.authorityEpoch,
      authorityId: this.transfer.sourceAuthorityId,
      createdAt: this.#now(),
      exportRoot: resolveMigrationSnapshotRoot(this.#evidenceRoot),
      fenceToken,
      inspect: this.#inspect,
      interrupt: this.#interrupt,
      workspaceRoot: this.#sourceRoot,
    })
    this.#checkpoint = {
      ...this.#checkpoint,
      finalSnapshotId: finalSnapshot.manifest.snapshotId,
    }
    await this.#recordAndPersist(
      'snapshots.finalize',
      this.transfer.sourceAuthorityId,
      [finalSnapshot.manifest.snapshotId],
    )
  }

  async verifyFinalSnapshot(): Promise<void> {
    this.#assertUsable()
    await this.#ensureSourceFenced()
    const finalSnapshot = this.#requireFinalSnapshot()
    if (this.transfer.phase === 'final_snapshot_verified') {
      await reconcileWorkspaceSnapshot(finalSnapshot, this.#targetRoot, this.#inspect)
      return
    }
    if (finalSnapshot.manifest.fenceToken !== this.#checkpoint.fenceToken) {
      throw new WorkspaceProtocolError(
        'snapshot_integrity_failed',
        'Final snapshot does not reference the active fence token.',
      )
    }
    await restoreWorkspaceSnapshot(finalSnapshot, this.#targetRoot, {
      interrupt: this.#interrupt,
      replace: true,
    })
    await reconcileWorkspaceSnapshot(finalSnapshot, this.#targetRoot, this.#inspect)
    this.#checkpoint = {
      ...this.#checkpoint,
      transfer: verifyWorkspaceFinalSnapshot(this.transfer),
    }
    await this.#recordAndPersist(
      'snapshots.verify',
      this.transfer.targetAuthorityId,
      [finalSnapshot.manifest.snapshotId],
    )
  }

  async activateTarget(expectedAuthorityEpoch: number): Promise<void> {
    this.#assertUsable()
    await this.#ensureSourceFenced()
    if (this.transfer.phase === 'activated') return
    this.#checkpoint = {
      ...this.#checkpoint,
      transfer: activateWorkspaceTarget(this.transfer, expectedAuthorityEpoch),
    }
    await this.#recordAndPersist(
      'transfers.activateTarget',
      this.transfer.targetAuthorityId,
      [this.#requireFinalSnapshot().manifest.snapshotId],
    )
  }

  async verifyRollbackBackup(): Promise<WorkspaceOldRuntimeVerification> {
    this.#assertUsable()
    await this.#ensureSourceFenced()
    if (this.transfer.phase !== 'activated') {
      throw new WorkspaceProtocolError(
        'transfer_phase_conflict',
        'Backup downgrade verification belongs to the activated rollback window.',
      )
    }
    const fixture = supportedLocalWorkspaceMigrationFixtures.find(
      (candidate) => (
        `workspace:${candidate.workspaceVersion}/drizzle:${candidate.drizzleJournalVersion}`
        === this.backup.manifest.schemaVersion
      ),
    )
    if (!fixture) throw new Error('No frozen old-runtime verifier supports this backup.')
    const verification = await verifyAlpha55ImmutableBackup({
      backup: this.backup,
      restoreRoot: this.#oldRuntimeRestoreRoot(),
    })
    validateOldRuntimeVerification(verification, fixture, this.backup)
    if (!this.#checkpoint.downgradeVerificationDigest) {
      this.#checkpoint = {
        ...this.#checkpoint,
        downgradeVerificationDigest: verification.evidenceDigest,
      }
      await this.#recordAndPersist(
        'transfers.verifyRollbackBackup',
        this.transfer.targetAuthorityId,
        [this.backup.manifest.snapshotId, verification.evidenceDigest],
      )
    }
    return verification
  }

  async retireSource(): Promise<void> {
    this.#assertUsable()
    await this.#ensureSourceFenced()
    if (this.transfer.phase === 'source_retired') return
    const evidenceDigest = this.#checkpoint.downgradeVerificationDigest
    if (!evidenceDigest) {
      throw new WorkspaceProtocolError(
        'transfer_phase_conflict',
        'Source retirement requires old-runtime backup verification.',
      )
    }
    this.#checkpoint = {
      ...this.#checkpoint,
      transfer: retireWorkspaceSource(this.transfer),
    }
    await this.#recordAndPersist(
      'transfers.retireSource',
      this.transfer.targetAuthorityId,
      [evidenceDigest],
    )
  }

  async abort(): Promise<void> {
    this.#assertUsable()
    if (this.transfer.phase !== 'aborted') {
      const previousCheckpoint = this.#checkpoint
      const transfer = abortWorkspaceTransfer(this.transfer)
      this.#checkpoint = { ...this.#checkpoint, transfer }
      try {
        await this.#recordAndPersist(
          'transfers.abort',
          transfer.sourceAuthorityId,
          [this.backup.manifest.snapshotId],
        )
      } catch (error) {
        const durableCheckpoint = this.#reconcileAbortPersistence(previousCheckpoint)
        if (durableCheckpoint.transfer.phase === 'aborted') {
          await this.#completeAbortCleanup()
          return
        }
        throw error
      }
      await this.#interrupt('abort.persisted')
    }
    await this.#completeAbortCleanup()
  }

  receipt(operation: string): AuthenticatedWorkspaceReceipt {
    const envelope = this.#checkpoint.receipts.find(
      (candidate) => candidate.receipt.operation === operation,
    )
    if (!envelope) {
      throw new WorkspaceProtocolError('receipt_not_found', `No ${operation} receipt exists.`)
    }
    return envelope
  }

  async #reconcileExternalFence(): Promise<void> {
    if (this.transfer.phase === 'aborted') {
      await this.#completeAbortCleanup()
      return
    }
    if (sourceMustRemainFenced(this.transfer)) {
      await this.#ensureSourceFenced()
      return
    }
    await this.#sourceFence.unfence({
      fenceToken: null,
      transferId: this.transfer.transferId,
      workspaceId: this.transfer.workspaceId,
    })
  }

  async #ensureSourceFenced(): Promise<void> {
    if (!sourceMustRemainFenced(this.transfer)) {
      throw new WorkspaceProtocolError(
        'transfer_phase_conflict',
        `Transfer is in ${this.transfer.phase}.`,
      )
    }
    const fenceToken = requireMigrationFenceToken(this.#checkpoint.fenceToken)
    const fenced = await this.#sourceFence.fenceAndDrain({
      expectedFenceToken: fenceToken,
      transferId: this.transfer.transferId,
      workspaceId: this.transfer.workspaceId,
    })
    if (fenced.fenceToken !== fenceToken) {
      throw new WorkspaceProtocolError('authority_forbidden', 'Source fence identity changed.')
    }
  }

  async #completeAbortCleanup(): Promise<void> {
    discardMigrationCandidate(this.#targetRoot, this.#sourceRoot)
    await this.#interrupt('abort.candidate_discarded')
    await this.#sourceFence.unfence({
      fenceToken: this.#checkpoint.fenceToken,
      transferId: this.transfer.transferId,
      workspaceId: this.transfer.workspaceId,
    })
    await this.#interrupt('abort.unfenced')
  }

  #oldRuntimeRestoreRoot(): string {
    return path.join(
      this.#evidenceRoot,
      'compatibility',
      this.transfer.transferId,
      'alpha55-backup',
    )
  }

  #assertUsable(): void {
    if (this.#poisoned) {
      throw new WorkspaceProtocolError(
        'transfer_phase_conflict',
        'Migration session persistence is ambiguous; reopen the session.',
      )
    }
  }

  #reconcileAbortPersistence(
    previousCheckpoint: WorkspaceMigrationCheckpoint,
  ): WorkspaceMigrationCheckpoint {
    let durableCheckpoint: WorkspaceMigrationCheckpoint
    try {
      durableCheckpoint = readAuthenticatedMigrationCheckpoint({
        authorities: this.#authorities,
        journalPath: this.#journalPath,
        transferId: this.transfer.transferId,
      })
    } catch {
      this.#poisoned = true
      throw new WorkspaceProtocolError(
        'transfer_phase_conflict',
        'Migration abort persistence is ambiguous; reopen the session.',
      )
    }
    const durableIdentity = canonicalJson(durableCheckpoint)
    if (durableIdentity === canonicalJson(previousCheckpoint)) {
      this.#checkpoint = durableCheckpoint
      return durableCheckpoint
    }
    if (
      durableCheckpoint.transfer.phase === 'aborted'
      && durableCheckpoint.receipts.at(-1)?.receipt.operation === 'transfers.abort'
    ) {
      this.#checkpoint = durableCheckpoint
      return durableCheckpoint
    }
    this.#poisoned = true
    throw new WorkspaceProtocolError(
      'transfer_phase_conflict',
      'Migration abort persistence conflicts with durable state; reopen the session.',
    )
  }

  #authority(authorityId: string): WorkspaceReceiptAuthority {
    const authority = this.#authorities[authorityId]
    if (!authority) {
      throw new WorkspaceProtocolError(
        'authority_forbidden',
        `No receipt authority is configured for ${authorityId}.`,
      )
    }
    return authority
  }

  async #recordAndPersist(
    operation: string,
    authorityId: string,
    evidenceDigests: readonly string[],
  ): Promise<void> {
    const idempotencyKey = `${this.transfer.transferId}:${operation}`
    const requestFingerprint = sha256(canonicalJson({
      authorityEpoch: this.transfer.authorityEpoch,
      evidenceDigests,
      operation,
      phase: this.transfer.phase,
      transferId: this.transfer.transferId,
    }))
    const receipt = this.#receiptLedger.record({
      actor: 'workspace-migration-recovery',
      authorityEpoch: this.transfer.authorityEpoch,
      authorityId,
      evidenceDigests: Object.freeze([...evidenceDigests]),
      idempotencyKey,
      operation,
      outcome: Object.freeze({
        kind: 'success',
        value: Object.freeze({ phase: this.transfer.phase }),
      }),
      requestFingerprint,
      revisionOrPhase: this.transfer.phase,
      transferId: this.transfer.transferId,
      workspaceId: this.transfer.workspaceId,
    })
    const envelope = authenticateWorkspaceReceipt(receipt, this.#authority(authorityId))
    this.#checkpoint = {
      ...this.#checkpoint,
      receipts: Object.freeze([...this.#checkpoint.receipts, envelope]),
    }
    await this.#interrupt('receipt.recorded')
    await this.#persist()
  }

  #requireFinalSnapshot(): WorkspaceSnapshotArtifact {
    const snapshot = this.finalSnapshot
    if (!snapshot) {
      throw new WorkspaceProtocolError('snapshot_invalid', 'Transfer has no final snapshot.')
    }
    return snapshot
  }

  async #persist(): Promise<void> {
    await this.#interrupt('journal.before_write')
    const authority = this.#authority(checkpointAuthorityId(this.transfer))
    const envelope = authenticateWorkspaceDocument(this.#checkpoint, authority)
    writeAtomicDocument(this.#journalPath, `${JSON.stringify(envelope, null, 2)}\n`)
    await this.#interrupt('journal.persisted')
  }
}

function readAuthenticatedMigrationCheckpoint(input: {
  authorities: Readonly<Record<string, WorkspaceReceiptAuthority>>
  journalPath: string
  transferId: string
}): WorkspaceMigrationCheckpoint {
  const envelope = JSON.parse(
    fs.readFileSync(input.journalPath, 'utf8'),
  ) as AuthenticatedWorkspaceDocument<WorkspaceMigrationCheckpoint>
  const checkpoint = envelope.document
  if (
    checkpoint?.version !== 2
    || checkpoint.transfer?.transferId !== input.transferId
  ) {
    throw new WorkspaceProtocolError(
      'transfer_not_found',
      'Migration checkpoint identity is invalid.',
    )
  }
  const authorityId = checkpointAuthorityId(checkpoint.transfer)
  const authority = input.authorities[authorityId]
  if (!authority) {
    throw new WorkspaceProtocolError('authority_forbidden', 'Checkpoint signer is unavailable.')
  }
  verifyWorkspaceDocument(envelope, authority)
  for (const receipt of checkpoint.receipts) {
    const receiptAuthority = input.authorities[receipt.receipt.authorityId]
    if (!receiptAuthority) {
      throw new WorkspaceProtocolError('authority_forbidden', 'Receipt signer is unavailable.')
    }
    verifyWorkspaceReceipt(receipt, receiptAuthority)
  }
  reconcileMigrationCheckpoint(checkpoint)
  return checkpoint
}

export function migrationReceiptDigest(receipt: WorkspaceReceipt): string {
  return sha256(canonicalJson(receipt))
}

function sourceMustRemainFenced(transfer: WorkspaceTransfer): boolean {
  return [
    'source_fenced',
    'final_snapshot_verified',
    'activated',
    'source_retired',
  ].includes(transfer.phase)
}
