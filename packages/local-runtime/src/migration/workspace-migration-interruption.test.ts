import { generateKeyPairSync, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkspaceReceiptAuthority } from './workspace-migration-receipt.js'
import {
  LocalWorkspaceMigrationSession,
  type LocalWorkspaceMigrationOptions,
  type WorkspaceMigrationSessionInterruptionPoint,
  type WorkspaceSourceFencePort,
} from './workspace-migration-session.js'
import {
  restoreWorkspaceSnapshot,
  resolveWorkspaceRestoreTransactionPaths,
  type WorkspaceSnapshotInspection,
} from './workspace-migration-snapshot.js'

const roots = new Set<string>()
const now = '2026-08-02T12:00:00.000Z'

afterEach(() => {
  for (const root of roots) {
    makeWritable(root)
    fs.rmSync(root, { force: true, recursive: true })
  }
  roots.clear()
})

describe.sequential('workspace migration operation recovery', () => {
  it.each([
    'fence.persisted',
    'snapshot.written',
    'snapshot.committed',
  ] as const)('resumes final snapshot after interruption at %s', async (point) => {
    const scenario = await createScenario(point)
    await scenario.session.stageSnapshot()
    if (point !== 'fence.persisted') {
      fs.writeFileSync(path.join(scenario.sourceRoot, 'after-backup.txt'), point)
    }
    scenario.interruption.arm(point)
    await expect(scenario.session.fenceSource()).rejects.toThrow(`at ${point}`)

    const recovered = await openScenario(scenario)
    expect(recovered.transfer.phase).toBe('source_fenced')
    expect(recovered.finalSnapshot).toBeNull()
    await recovered.fenceSource()
    expect(recovered.finalSnapshot?.manifest.fenceToken).toBe(scenario.fence.token)
  })

  it.each([
    'restore.copied',
    'receipt.recorded',
    'journal.before_write',
    'journal.persisted',
  ] as const)('resumes staging after interruption at %s', async (point) => {
    const scenario = await createScenario(point)
    scenario.interruption.arm(point)
    await expect(scenario.session.stageSnapshot()).rejects.toThrow(`at ${point}`)

    const recovered = await openScenario(scenario)
    const expectedPhase = point === 'journal.persisted' ? 'snapshot_staged' : 'prepared'
    expect(recovered.transfer.phase).toBe(expectedPhase)
    await recovered.stageSnapshot()
    expect(recovered.transfer.phase).toBe('snapshot_staged')
  })

  it.each([
    'restore.old_moved',
    'restore.swapped',
  ] as const)('restores the previous candidate when interrupted at %s', async (point) => {
    const scenario = await createScenario(point)
    await scenario.session.stageSnapshot()
    await scenario.session.fenceSource()
    const before = digestTree(scenario.targetRoot)
    scenario.interruption.arm(point)
    await expect(scenario.session.verifyFinalSnapshot()).rejects.toThrow(`at ${point}`)

    expect(digestTree(scenario.targetRoot)).toBe(before)
    const recovered = await openScenario(scenario)
    expect(recovered.transfer.phase).toBe('source_fenced')
    await recovered.verifyFinalSnapshot()
    expect(recovered.transfer.phase).toBe('final_snapshot_verified')
  })

  it('unfences the drained source when a fenced transfer aborts', async () => {
    const scenario = await createScenario('abort-unfence')
    await scenario.session.stageSnapshot()
    await scenario.session.fenceSource()
    const unfenceCalls = scenario.fence.unfenceCalls
    await scenario.session.abort()

    expect(scenario.fence.fenced).toBe(false)
    expect(scenario.fence.unfenceCalls).toBe(unfenceCalls + 1)
  })

  it('unfences an external fence interrupted before checkpoint persistence', async () => {
    const scenario = await createScenario('pre-checkpoint-fence')
    await scenario.session.stageSnapshot()
    scenario.interruption.arm('journal.before_write')
    await expect(scenario.session.fenceSource()).rejects.toThrow('journal.before_write')
    expect(scenario.fence.fenced).toBe(true)

    const recovered = await openScenario(scenario)
    expect(recovered.transfer.phase).toBe('snapshot_staged')
    await recovered.abort()
    expect(scenario.fence.fenced).toBe(false)
  })

  it('captures the prepared backup only while drained and returns the source active', async () => {
    const scenario = await createScenario('prepared-drain-proof')

    expect(scenario.session.backup.manifest.fenceToken).toBe(scenario.fence.token)
    expect(scenario.fence.fenced).toBe(false)
    expect(scenario.fence.snapshotInspections).toBe(1)
  })

  it('opens a durable prepared checkpoint after create is interrupted at persistence', async () => {
    const setup = createScenarioSetup('prepared-persisted')
    setup.interruption.arm('journal.persisted')

    await expect(createSession(setup)).rejects.toThrow('at journal.persisted')
    expect(setup.fence.fenced).toBe(false)
    await setup.fence.fenceAndDrain({
      expectedFenceToken: setup.fence.token,
      transferId: setup.transferId,
      workspaceId: createInspection().workspaceId,
    })
    expect(setup.fence.fenced).toBe(true)

    const recovered = await LocalWorkspaceMigrationSession.open({
      ...setup.options,
      transferId: setup.transferId,
    })
    expect(recovered.transfer.phase).toBe('prepared')
    expect(recovered.backup.manifest.fenceToken).toBe(setup.fence.token)
    expect(setup.fence.fenced).toBe(false)
  })

  it('reconciles a lost external fence on open and before the next transition', async () => {
    const scenario = await createScenario('lost-fence')
    await scenario.session.stageSnapshot()
    await scenario.session.fenceSource()
    scenario.fence.loseFence()
    const beforeOpen = scenario.fence.fenceCalls

    const recovered = await openScenario(scenario)
    expect(scenario.fence.fenced).toBe(true)
    expect(scenario.fence.fenceCalls).toBe(beforeOpen + 1)

    scenario.fence.loseFence()
    const beforeVerify = scenario.fence.fenceCalls
    await recovered.verifyFinalSnapshot()
    expect(scenario.fence.fenced).toBe(true)
    expect(scenario.fence.fenceCalls).toBe(beforeVerify + 1)
  })

  it.each([
    'abort.persisted',
    'abort.candidate_discarded',
    'abort.unfenced',
  ] as const)('finishes an aborted cleanup after interruption at %s', async (point) => {
    const scenario = await createScenario(`abort-${point}`)
    await scenario.session.stageSnapshot()
    await scenario.session.fenceSource()
    scenario.interruption.arm(point)

    await expect(scenario.session.abort()).rejects.toThrow(`at ${point}`)
    const recovered = await openScenario(scenario)

    expect(recovered.transfer.phase).toBe('aborted')
    expect(fs.existsSync(scenario.targetRoot)).toBe(false)
    expect(scenario.fence.fenced).toBe(false)
  })

  it('adopts a durably aborted journal before the same session can continue', async () => {
    const scenario = await createScenario('abort-journal-persisted')
    await scenario.session.stageSnapshot()
    await scenario.session.fenceSource()
    scenario.interruption.arm('journal.persisted')

    await scenario.session.abort()

    expect(scenario.session.transfer.phase).toBe('aborted')
    expect(scenario.session.receipts.at(-1)?.receipt.operation).toBe('transfers.abort')
    expect(fs.existsSync(scenario.targetRoot)).toBe(false)
    expect(scenario.fence.fenced).toBe(false)
    await expect(scenario.session.verifyFinalSnapshot()).rejects.toThrow(
      'Transfer is in aborted.',
    )
  })

  it('poisons the session when abort persistence cannot be reconciled', async () => {
    const scenario = await createScenario('abort-ambiguous-journal')
    await scenario.session.stageSnapshot()
    await scenario.session.fenceSource()
    const journalPath = path.join(
      scenario.evidenceRoot,
      'transfers',
      scenario.transferId,
      'journal.json',
    )
    const previousJournal = fs.readFileSync(journalPath)
    scenario.interruption.arm('journal.persisted', () => {
      fs.writeFileSync(journalPath, 'not authenticated json')
    })

    await expect(scenario.session.abort()).rejects.toThrow(
      'persistence is ambiguous; reopen',
    )
    expect(fs.existsSync(scenario.targetRoot)).toBe(true)
    expect(scenario.fence.fenced).toBe(true)
    await expect(scenario.session.abort()).rejects.toThrow('reopen the session')
    await expect(scenario.session.verifyFinalSnapshot()).rejects.toThrow('reopen the session')

    fs.writeFileSync(journalPath, previousJournal)
    const recovered = await openScenario(scenario)
    expect(recovered.transfer.phase).toBe('source_fenced')
    await recovered.abort()
    expect(recovered.transfer.phase).toBe('aborted')
  })

  it.each([
    'receipt.recorded',
    'journal.before_write',
  ] as const)('does not clean up before aborted state is durable at %s', async (point) => {
    const scenario = await createScenario(`abort-before-${point}`)
    await scenario.session.stageSnapshot()
    await scenario.session.fenceSource()
    scenario.interruption.arm(point)

    await expect(scenario.session.abort()).rejects.toThrow(`at ${point}`)
    expect(scenario.session.transfer.phase).toBe('source_fenced')
    expect(fs.existsSync(scenario.targetRoot)).toBe(true)
    expect(scenario.fence.fenced).toBe(true)

    await scenario.session.abort()
    expect(scenario.session.transfer.phase).toBe('aborted')
    expect(fs.existsSync(scenario.targetRoot)).toBe(false)
    expect(scenario.fence.fenced).toBe(false)
  })

  it.each([
    'copying',
    'prepared',
    'prepared_after_move',
    'old_moved',
    'old_moved_after_swap',
    'swapped',
  ] as const)('recovers seeded restore transaction state %s', async (phase) => {
    const scenario = await createScenario(`restore-state-${phase}`)
    const nonce = restoreNonce(phase)
    const transaction = resolveWorkspaceRestoreTransactionPaths(scenario.targetRoot, nonce)
    fs.mkdirSync(scenario.targetRoot)
    fs.writeFileSync(path.join(scenario.targetRoot, 'old.txt'), 'previous workspace')
    fs.cpSync(scenario.session.backup.workspaceDirectory, transaction.temporary, {
      recursive: true,
    })
    if (phase !== 'copying' && phase !== 'prepared') {
      fs.renameSync(scenario.targetRoot, transaction.previous)
    }
    if (phase === 'old_moved_after_swap' || phase === 'swapped') {
      fs.renameSync(transaction.temporary, scenario.targetRoot)
    }
    fs.writeFileSync(transaction.marker, `${JSON.stringify({
      nonce,
      phase: phase === 'old_moved_after_swap'
        ? 'old_moved'
        : phase === 'prepared_after_move' ? 'prepared' : phase,
      previousPath: transaction.previous,
      replace: true,
      snapshotId: scenario.session.backup.manifest.snapshotId,
      targetExisted: true,
      targetRoot: scenario.targetRoot,
      temporaryPath: transaction.temporary,
      version: 2,
    })}\n`)

    await restoreWorkspaceSnapshot(scenario.session.backup, scenario.targetRoot, {
      replace: true,
    })

    expect(digestTree(scenario.targetRoot))
      .toBe(digestTree(scenario.session.backup.workspaceDirectory))
    expect(Object.values(transaction).every((candidate) => !fs.existsSync(candidate))).toBe(true)
  })

  it('never claims or deletes an unrelated restore temporary without a marker', async () => {
    const scenario = await createScenario('unowned-restore-temp')
    const unrelated = path.join(
      path.dirname(scenario.targetRoot),
      `.${path.basename(scenario.targetRoot)}.restore.tmp`,
    )
    fs.mkdirSync(unrelated)
    const sentinel = path.join(unrelated, 'sentinel.txt')
    fs.writeFileSync(sentinel, 'preserve')

    await restoreWorkspaceSnapshot(scenario.session.backup, scenario.targetRoot)

    expect(fs.readFileSync(sentinel, 'utf8')).toBe('preserve')
    expect(digestTree(scenario.targetRoot))
      .toBe(digestTree(scenario.session.backup.workspaceDirectory))
  })

  it('fails closed on a bogus restore phase without bypassing replace false', async () => {
    const scenario = await createScenario('bogus-restore-phase')
    const nonce = restoreNonce('bogus-phase')
    const transaction = resolveWorkspaceRestoreTransactionPaths(scenario.targetRoot, nonce)
    fs.mkdirSync(scenario.targetRoot)
    const sentinel = path.join(scenario.targetRoot, 'sentinel.txt')
    fs.writeFileSync(sentinel, 'preserve')
    fs.writeFileSync(transaction.marker, `${JSON.stringify({
      nonce,
      phase: 'delete_target',
      previousPath: transaction.previous,
      replace: false,
      snapshotId: scenario.session.backup.manifest.snapshotId,
      targetExisted: false,
      targetRoot: scenario.targetRoot,
      temporaryPath: transaction.temporary,
      version: 2,
    })}\n`)

    await expect(restoreWorkspaceSnapshot(scenario.session.backup, scenario.targetRoot))
      .rejects.toThrow('invalid or ambiguous')
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('preserve')
    expect(fs.existsSync(transaction.marker)).toBe(true)
  })

  it('rejects forged nonce-derived paths without authorizing cleanup', async () => {
    const scenario = await createScenario('forged-restore-path')
    const nonce = restoreNonce('forged-path')
    const transaction = resolveWorkspaceRestoreTransactionPaths(scenario.targetRoot, nonce)
    const victim = path.join(path.dirname(scenario.targetRoot), 'restore-forgery-victim')
    fs.mkdirSync(victim)
    const sentinel = path.join(victim, 'sentinel.txt')
    fs.writeFileSync(sentinel, 'preserve')
    fs.mkdirSync(scenario.targetRoot)
    fs.writeFileSync(path.join(scenario.targetRoot, 'target.txt'), 'preserve target')
    fs.writeFileSync(transaction.marker, `${JSON.stringify({
      nonce,
      phase: 'prepared',
      previousPath: transaction.previous,
      replace: true,
      snapshotId: scenario.session.backup.manifest.snapshotId,
      targetExisted: true,
      targetRoot: scenario.targetRoot,
      temporaryPath: victim,
      version: 2,
    })}\n`)

    await expect(restoreWorkspaceSnapshot(
      scenario.session.backup,
      scenario.targetRoot,
      { replace: true },
    )).rejects.toThrow('invalid or ambiguous')
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('preserve')
    expect(fs.readFileSync(path.join(scenario.targetRoot, 'target.txt'), 'utf8'))
      .toBe('preserve target')
    expect(fs.existsSync(transaction.marker)).toBe(true)
  })

  it('rejects an invalid restore nonce without authorizing cleanup', async () => {
    const scenario = await createScenario('forged-restore-nonce')
    const transaction = resolveWorkspaceRestoreTransactionPaths(
      scenario.targetRoot,
      restoreNonce('marker-path'),
    )
    fs.mkdirSync(scenario.targetRoot)
    const sentinel = path.join(scenario.targetRoot, 'sentinel.txt')
    fs.writeFileSync(sentinel, 'preserve')
    fs.writeFileSync(transaction.marker, `${JSON.stringify({
      nonce: '../forged',
      phase: 'prepared',
      previousPath: path.join(path.dirname(scenario.targetRoot), 'victim-previous'),
      replace: true,
      snapshotId: scenario.session.backup.manifest.snapshotId,
      targetExisted: true,
      targetRoot: scenario.targetRoot,
      temporaryPath: path.join(path.dirname(scenario.targetRoot), 'victim-temporary'),
      version: 2,
    })}\n`)

    await expect(restoreWorkspaceSnapshot(
      scenario.session.backup,
      scenario.targetRoot,
      { replace: true },
    )).rejects.toThrow('invalid or ambiguous')
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('preserve')
    expect(fs.existsSync(transaction.marker)).toBe(true)
  })

  it('rejects symlink restore and discard targets without touching the victim', async () => {
    const restoreScenario = await createScenario('restore-symlink-victim')
    const restoreVictim = path.join(path.dirname(restoreScenario.targetRoot), 'restore-victim')
    fs.mkdirSync(restoreVictim)
    const restoreSentinel = path.join(restoreVictim, 'sentinel.txt')
    fs.writeFileSync(restoreSentinel, 'preserve')
    fs.symlinkSync(restoreVictim, restoreScenario.targetRoot)

    await expect(restoreWorkspaceSnapshot(
      restoreScenario.session.backup,
      restoreScenario.targetRoot,
      { replace: true },
    )).rejects.toThrow('symbolic-link restore target')
    expect(fs.readFileSync(restoreSentinel, 'utf8')).toBe('preserve')

    const discardScenario = await createScenario('discard-symlink-victim')
    const discardVictim = path.join(path.dirname(discardScenario.targetRoot), 'discard-victim')
    fs.mkdirSync(discardVictim)
    const discardSentinel = path.join(discardVictim, 'sentinel.txt')
    fs.writeFileSync(discardSentinel, 'preserve')
    fs.symlinkSync(discardVictim, discardScenario.targetRoot)

    await expect(discardScenario.session.abort())
      .rejects.toThrow('symbolic-link migration candidate')
    expect(discardScenario.session.transfer.phase).toBe('aborted')
    expect(fs.readFileSync(discardSentinel, 'utf8')).toBe('preserve')
    fs.unlinkSync(discardScenario.targetRoot)
    expect((await openScenario(discardScenario)).transfer.phase).toBe('aborted')
    expect(fs.readFileSync(discardSentinel, 'utf8')).toBe('preserve')
  })

  it('canonicalizes symlinked ancestors before root and restore safety checks', async () => {
    const scenario = await createScenario('symlink-safety')
    const sourceAlias = path.join(path.dirname(scenario.sourceRoot), 'source-alias')
    fs.symlinkSync(scenario.sourceRoot, sourceAlias)
    await expect(LocalWorkspaceMigrationSession.create({
      ...scenario.options,
      evidenceRoot: path.join(path.dirname(scenario.evidenceRoot), 'alternate-evidence'),
      sourceRoot: scenario.sourceRoot,
      targetRoot: path.join(sourceAlias, 'nested-target'),
      authorityEpoch: 4,
      sourceAuthorityId: 'source-authority',
      targetAuthorityId: 'target-authority',
      transferId: 'transfer-symlink-overlap',
      workspaceId: 'workspace-crash-proof',
    })).rejects.toThrow('roots must not overlap')

    const artifactAlias = path.join(path.dirname(scenario.sourceRoot), 'artifact-alias')
    fs.symlinkSync(scenario.session.backup.directory, artifactAlias)
    await expect(restoreWorkspaceSnapshot(
      scenario.session.backup,
      path.join(artifactAlias, 'nested-target'),
    )).rejects.toThrow('unsafe workspace snapshot restore target')
  })
})

interface TestScenario {
  authorities: Record<string, WorkspaceReceiptAuthority>
  evidenceRoot: string
  fence: TestFence
  inspect: (workspaceRoot: string) => Promise<WorkspaceSnapshotInspection>
  interruption: TestInterruption
  options: LocalWorkspaceMigrationOptions
  session: LocalWorkspaceMigrationSession
  sourceRoot: string
  targetRoot: string
  transferId: string
}

type TestScenarioSetup = Omit<TestScenario, 'session'>

async function createScenario(name: string): Promise<TestScenario> {
  const setup = createScenarioSetup(name)
  const session = await createSession(setup)
  return { ...setup, session }
}

function createScenarioSetup(name: string): TestScenarioSetup {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migration-crash-')))
  roots.add(root)
  const sourceRoot = path.join(root, 'source')
  const targetRoot = path.join(root, 'target')
  const evidenceRoot = path.join(root, 'evidence')
  fs.mkdirSync(path.join(sourceRoot, 'empty'), { recursive: true })
  fs.writeFileSync(path.join(sourceRoot, 'records.json'), '{"records":1}\n')
  const inspection = createInspection()
  const fence = createFence()
  const interruption = createInterruption()
  const inspect = async (workspaceRoot: string) => {
    if (path.resolve(workspaceRoot) === path.resolve(sourceRoot)) {
      fence.recordSnapshotInspection()
      if (!fence.fenced) {
        throw new Error('Refusing to snapshot a live source.')
      }
    }
    return inspection
  }
  const authorities = createAuthorities()
  const options: LocalWorkspaceMigrationOptions = {
    authorities,
    evidenceRoot,
    inspect,
    interrupt: (point) => interruption.hook(point),
    now: () => now,
    sourceFence: fence,
    sourceRoot,
    targetRoot,
  }
  const transferId = `transfer-${name}`
  return {
    authorities,
    evidenceRoot,
    fence,
    inspect,
    interruption,
    options,
    sourceRoot,
    targetRoot,
    transferId,
  }
}

function createSession(setup: TestScenarioSetup): Promise<LocalWorkspaceMigrationSession> {
  return LocalWorkspaceMigrationSession.create({
    ...setup.options,
    authorityEpoch: 4,
    sourceAuthorityId: 'source-authority',
    targetAuthorityId: 'target-authority',
    transferId: setup.transferId,
    workspaceId: createInspection().workspaceId,
  })
}

function openScenario(scenario: TestScenario) {
  return LocalWorkspaceMigrationSession.open({
    ...scenario.options,
    transferId: scenario.transferId,
  })
}

interface TestFence extends WorkspaceSourceFencePort {
  readonly fenceCalls: number
  readonly fenced: boolean
  loseFence(): void
  recordSnapshotInspection(): void
  readonly snapshotInspections: number
  readonly token: string
  readonly unfenceCalls: number
}

function createFence(): TestFence {
  const token = 'fence-token'
  let fenceCalls = 0
  let fenced = false
  let snapshotInspections = 0
  let unfenceCalls = 0
  return {
    get fenceCalls() {
      return fenceCalls
    },
    get fenced() {
      return fenced
    },
    loseFence() {
      fenced = false
    },
    get snapshotInspections() {
      return snapshotInspections
    },
    token,
    get unfenceCalls() {
      return unfenceCalls
    },
    async fenceAndDrain({ expectedFenceToken }) {
      fenceCalls += 1
      if (expectedFenceToken && expectedFenceToken !== token) throw new Error('Fence mismatch.')
      fenced = true
      return { fenceToken: token }
    },
    async unfence(input) {
      if (!fenced) return
      if (input.fenceToken && input.fenceToken !== token) throw new Error('Unfence mismatch.')
      fenced = false
      unfenceCalls += 1
    },
    recordSnapshotInspection() {
      snapshotInspections += 1
    },
  }
}

interface TestInterruption {
  arm(point: WorkspaceMigrationSessionInterruptionPoint, action?: () => void): void
  hook(point: WorkspaceMigrationSessionInterruptionPoint): void
}

function createInterruption(): TestInterruption {
  let armed: WorkspaceMigrationSessionInterruptionPoint | null = null
  let action: (() => void) | undefined
  return {
    arm(point, nextAction) {
      armed = point
      action = nextAction
    },
    hook(point) {
      if (point !== armed) return
      armed = null
      const armedAction = action
      action = undefined
      armedAction?.()
      throw new Error(`Injected interruption at ${point}.`)
    },
  }
}

function createInspection(): WorkspaceSnapshotInspection {
  return {
    logicalRecordCounts: { records: 1 },
    requiredCapabilities: ['workspace.snapshot.import'],
    revisionToken: 'revision-1',
    schemaVersion: 'workspace:1/drizzle:7',
    secretEnvelopeCount: 1,
    secretEnvelopeDigest: 'sha256:secret-envelope-digest',
    workspaceId: 'workspace-crash-proof',
  }
}

function restoreNonce(_label: string): string {
  return randomUUID()
}

function createAuthorities(): Record<string, WorkspaceReceiptAuthority> {
  return Object.fromEntries(['source-authority', 'target-authority'].map((authorityId) => {
    const keys = generateKeyPairSync('ed25519')
    return [authorityId, {
      authorityId,
      keyId: `${authorityId}-key`,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    }]
  }))
}

function digestTree(root: string): string {
  const entries: string[] = []
  visit(root, '')
  return entries.join('|')

  function visit(directory: string, relative: string): void {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name)
      const next = path.posix.join(relative, name)
      if (fs.statSync(absolute).isDirectory()) visit(absolute, next)
      else entries.push(`${next}:${fs.readFileSync(absolute, 'hex')}`)
    }
  }
}

function makeWritable(root: string): void {
  if (!fs.existsSync(root)) return
  fs.chmodSync(root, fs.statSync(root).isDirectory() ? 0o700 : 0o600)
  if (fs.statSync(root).isDirectory()) {
    for (const name of fs.readdirSync(root)) makeWritable(path.join(root, name))
  }
}
