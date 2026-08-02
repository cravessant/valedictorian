import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WorkspaceProtocolError,
  type WorkspaceTransferPhase,
} from '@sparxie/valedictorian-workspace-server'
import {
  createPgliteClient,
  migratePgliteDatabase,
} from '../db/pglite.js'
import { createPgliteCaptureService } from '../modules/capture/public.js'
import { createPgliteSecretService } from '../modules/secrets/public.js'
import { createWorkspaceSecretScope } from '../protected-secrets.js'
import { initializeWorkspace } from '../workspace/workspace.initializer.js'
import { resolveWorkspaceLayout } from '../workspace.paths.js'
import { canonicalJson, sha256 } from './workspace-migration-canonical.js'
import { ALPHA55_VERIFIER_TIMEOUT_MS } from './workspace-migration-alpha55.js'
import {
  authenticateWorkspaceDocument,
  type WorkspaceReceiptAuthority,
} from './workspace-migration-receipt.js'
import {
  LocalWorkspaceMigrationSession,
  type WorkspaceMigrationSessionInterruptionPoint,
  type WorkspaceSourceFencePort,
} from './workspace-migration-session.js'
import {
  createImmutableWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
  supportedLocalWorkspaceMigrationFixtures,
  type WorkspaceSnapshotInspection,
} from './workspace-migration-snapshot.js'

const timestamp = '2026-08-02T12:00:00.000Z'
const fixtureEncryptedEnvelope = 'envelope:v1:Y2lwaGVydGV4dC1vbmx5'
const fixturePlaintextSecret = 'fixture-plaintext-secret-must-never-serialize'
const migrationWorkspaceId = '00000000-0000-0000-0000-000000000000'
const temporaryRoots = new Set<string>()
const abortablePhases = [
  'prepared',
  'snapshot_staged',
  'source_fenced',
  'final_snapshot_verified',
] as const
const interruptionPhases = [
  ...abortablePhases,
  'activated',
  'source_retired',
  'aborted',
] as const

afterEach(() => {
  const roots = [...temporaryRoots]
  temporaryRoots.clear()
  for (const root of roots) {
    makeTreeWritable(root)
    fs.rmSync(root, { force: true, recursive: true })
  }
})

describe.sequential('local workspace migration and interrupted recovery', () => {
  it.each(supportedLocalWorkspaceMigrationFixtures)(
    'binds supported fixture $runtimeTag to its preserved ORM baseline',
    (fixture) => {
      const packageRoot = path.resolve(import.meta.dirname, '../..')
      const repositoryRoot = path.resolve(packageRoot, '../..')
      const baseline = fs.readFileSync(
        path.join(packageRoot, 'drizzle/0000_pglite_operational_baseline.sql'),
      )
      const journalBytes = fs.readFileSync(path.join(packageRoot, 'drizzle/meta/_journal.json'))
      const journal = JSON.parse(journalBytes.toString('utf8')) as { version: string }
      const compatibilityRoot = path.join(packageRoot, 'drizzle/compatibility')
      const compatibilityBundle = fs.readFileSync(
        path.join(compatibilityRoot, 'alpha55-verifier.mjs'),
      )
      const compatibilityManifestBytes = fs.readFileSync(
        path.join(compatibilityRoot, 'alpha55-verifier.json'),
      )
      const compatibilityManifest = JSON.parse(
        compatibilityManifestBytes.toString('utf8'),
      ) as {
        bundleSha256: string
        sourceFilesSha256: Record<string, string>
      }

      expect(supportedLocalWorkspaceMigrationFixtures).toHaveLength(1)
      expect(fixture.workspaceVersion).toBe(1)
      expect(journal.version).toBe(fixture.drizzleJournalVersion)
      expect(digest(baseline)).toBe(fixture.baselineSha256)
      expect(digest(journalBytes)).toBe(fixture.drizzleJournalSha256)
      expect(digest(compatibilityBundle)).toBe(fixture.compatibilityBundleSha256)
      expect(digest(compatibilityManifestBytes)).toBe(fixture.compatibilityManifestSha256)
      expect(compatibilityManifest.bundleSha256).toBe(fixture.compatibilityBundleSha256)
      expect(compatibilityBundle.toString('utf8')).not.toMatch(
        /migrate\(|migration\/workspace|db\/schema/,
      )
      if (gitObjectExists(repositoryRoot, `${fixture.runtimeTag}^{commit}`)) {
        const taggedBaseline = execFileSync(
          'git',
          ['show', `${fixture.runtimeTag}:drizzle/0000_pglite_operational_baseline.sql`],
          { cwd: repositoryRoot },
        )
        expect(digest(taggedBaseline)).toBe(fixture.baselineSha256)
        expect(execFileSync(
          'git',
          ['rev-parse', `${fixture.runtimeTag}^{tree}`],
          { cwd: repositoryRoot, encoding: 'utf8' },
        ).trim()).toBe(fixture.sourceTreeSha256)
        for (const [sourceFile, expectedDigest] of Object.entries(
          compatibilityManifest.sourceFilesSha256,
        )) {
          expect(digest(execFileSync(
            'git',
            ['show', `${fixture.runtimeTag}:${sourceFile}`],
            { cwd: repositoryRoot },
          ))).toBe(expectedDigest)
        }
      }
    },
  )

  it('exports immutable backup/final snapshots and authenticated migration receipts', async () => {
    const scenario = await createScenario('completed')
    const { session, sourceRoot } = scenario

    expect(session.transfer.phase).toBe('prepared')
    expect(session.backup.manifest).toMatchObject({
      fenceToken: 'fence-completed',
      schemaVersion: 'workspace:1/drizzle:7',
      secretEnvelopeCount: 1,
      workspaceId: migrationWorkspaceId,
    })
    expect(() => fs.writeFileSync(
      path.join(session.backup.workspaceDirectory, '.valedictorian/manifest.json'),
      'mutable',
    )).toThrow()
    await session.stageSnapshot()
    fs.writeFileSync(
      path.join(resolveWorkspaceLayout(sourceRoot).notesPath, 'after-backup.md'),
      '# Included only in the fenced final snapshot\n',
    )
    await session.fenceSource()
    await session.verifyFinalSnapshot()
    await session.activateTarget(4)

    const finalSnapshot = session.finalSnapshot
    expect(finalSnapshot?.manifest.fenceToken).toBe('fence-completed')
    expect(finalSnapshot?.manifest.logicalRecordCounts.captures).toBe(1)
    expect(finalSnapshot?.manifest.files.some(
      (file) => file.path.endsWith('notes/after-backup.md'),
    )).toBe(true)
    expect(session.receipt('snapshots.verify').receipt.evidenceDigests)
      .toContain(finalSnapshot?.manifest.snapshotId)

    const oldRuntimeInspection = (await session.verifyRollbackBackup()).inspection
    expect(oldRuntimeInspection.logicalRecordCounts.captures).toBe(1)
    await session.retireSource()

    expect(session.transfer).toMatchObject({
      authorityEpoch: 5,
      phase: 'source_retired',
      sourceState: 'retired',
      targetState: 'active',
    })
    expect(session.receipts.map((entry) => entry.receipt.operation)).toEqual([
      'transfers.prepare',
      'snapshots.stage',
      'transfers.fenceSource',
      'snapshots.finalize',
      'snapshots.verify',
      'transfers.activateTarget',
      'transfers.verifyRollbackBackup',
      'transfers.retireSource',
    ])
    const recovered = await openScenario(scenario)
    expect(recovered.transfer).toEqual(session.transfer)
    expect(recovered.receipts).toHaveLength(8)
    const journal = fs.readFileSync(path.join(
      scenario.evidenceRoot,
      'transfers',
      scenario.transferId,
      'journal.json',
    ), 'utf8')
    expect(journal).not.toContain(fixturePlaintextSecret)
    expect(journal).not.toContain(fixtureEncryptedEnvelope)
    expect(JSON.stringify(session.receipts)).not.toContain(fixtureEncryptedEnvelope)
  }, 30_000)

  it('recovers a staged candidate copied before journal persistence', async () => {
    const scenario = await createScenario('stage-retry')
    await restoreWorkspaceSnapshot(scenario.session.backup, scenario.targetRoot)

    const recovered = await openScenario(scenario)
    await recovered.stageSnapshot()

    expect(recovered.transfer.phase).toBe('snapshot_staged')
    expect(recovered.receipt('snapshots.stage').receipt.evidenceDigests)
      .toContain(recovered.backup.manifest.snapshotId)

    const foreign = await createScenario('foreign-target')
    fs.mkdirSync(foreign.targetRoot)
    const sentinel = path.join(foreign.targetRoot, 'sentinel.txt')
    fs.writeFileSync(sentinel, 'preserve')
    await expect(foreign.session.stageSnapshot()).rejects.toMatchObject({
      failure: { code: 'snapshot_integrity_failed' },
    })
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('preserve')
  }, 15_000)

  it('bounds verifier execution and rejects Node preload injection', async () => {
    const scenario = await createScenario('bounded-verifier')
    await scenario.session.stageSnapshot()
    await scenario.session.fenceSource()
    await scenario.session.verifyFinalSnapshot()
    await scenario.session.activateTarget(4)
    const failingRequire = path.join(scenario.root, 'fail-verifier.cjs')
    const preloadMarker = path.join(scenario.root, 'preload-executed.txt')
    fs.writeFileSync(
      failingRequire,
      `require('node:fs').writeFileSync(${JSON.stringify(preloadMarker)}, 'executed')\n`
        + 'process.exit(7)\n',
    )
    const previousNodeOptions = process.env.NODE_OPTIONS

    try {
      process.env.NODE_OPTIONS = `--require=${failingRequire}`
      await scenario.session.verifyRollbackBackup()
    } finally {
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS
      else process.env.NODE_OPTIONS = previousNodeOptions
    }

    expect(ALPHA55_VERIFIER_TIMEOUT_MS).toBe(30_000)
    expect(fs.existsSync(preloadMarker)).toBe(false)
    expect(scenario.session.transfer.phase).toBe('activated')
    expect(scenario.sourceFence.fenced).toBe(true)
    expect(scenario.session.receipts.map((entry) => entry.receipt.operation))
      .toContain('transfers.verifyRollbackBackup')
    expect(scenario.session.receipt('transfers.verifyRollbackBackup')).toBeDefined()
  }, 20_000)

  it('rejects unsafe snapshot export and restore containment', async () => {
    const scenario = await createScenario('path-safety')
    await expect(createImmutableWorkspaceSnapshot({
      authorityEpoch: 4,
      authorityId: 'source-authority',
      createdAt: timestamp,
      exportRoot: scenario.sourceRoot,
      inspect: scenario.inspect,
      workspaceRoot: scenario.sourceRoot,
    })).rejects.toThrow('Snapshot exports must live outside the workspace.')
    await expect(restoreWorkspaceSnapshot(
      scenario.session.backup,
      path.join(scenario.session.backup.directory, 'nested-target'),
    )).rejects.toThrow('Refusing an unsafe workspace snapshot restore target.')
    await expect(restoreWorkspaceSnapshot(
      scenario.session.backup,
      path.dirname(scenario.session.backup.directory),
    )).rejects.toThrow('Refusing an unsafe workspace snapshot restore target.')

    const existingTarget = path.join(scenario.root, 'existing-target')
    fs.mkdirSync(existingTarget)
    await expect(LocalWorkspaceMigrationSession.create({
      authorities: scenario.authorities,
      authorityEpoch: 4,
      evidenceRoot: path.join(scenario.root, 'other-evidence'),
      inspect: scenario.inspect,
      sourceAuthorityId: 'source-authority',
      sourceFence: scenario.sourceFence,
      sourceRoot: scenario.sourceRoot,
      targetAuthorityId: 'target-authority',
      targetRoot: existingTarget,
      transferId: 'transfer-existing-target',
      workspaceId: migrationWorkspaceId,
    })).rejects.toThrow('Migration target workspace must not exist before preparation.')
  }, 15_000)

  it.each(interruptionPhases)(
    'recovers authenticated state after interruption at %s',
    async (phase) => {
      const scenario = await createScenario(`interrupted-${phase}`)
      await advanceTo(scenario, phase)
      const sourceBeforeRecovery = treeDigest(scenario.sourceRoot)
      const recovered = await openScenario(scenario)

      expect(recovered.transfer.phase).toBe(phase)
      if (isAbortable(phase)) {
        const unfenceCalls = scenario.sourceFence.unfenceCalls
        await recovered.abort()
        expect(recovered.transfer).toMatchObject({
          phase: 'aborted',
          sourceState: 'active',
          targetState: 'retired',
        })
        expect(fs.existsSync(scenario.targetRoot)).toBe(false)
        expect(treeDigest(scenario.sourceRoot)).toBe(sourceBeforeRecovery)
        if (phase === 'source_fenced' || phase === 'final_snapshot_verified') {
          expect(scenario.sourceFence.fenced).toBe(false)
          expect(scenario.sourceFence.unfenceCalls).toBe(unfenceCalls + 1)
        }
        expect((await openScenario(scenario)).transfer.phase).toBe('aborted')
      } else if (phase === 'activated') {
        const unfenceCalls = scenario.sourceFence.unfenceCalls
        await expect(recovered.abort()).rejects.toThrowError(WorkspaceProtocolError)
        expect(scenario.sourceFence.fenced).toBe(true)
        expect(scenario.sourceFence.unfenceCalls).toBe(unfenceCalls)
        await verifyDowngradeAndRetire(recovered, scenario.root)
        expect(recovered.transfer.phase).toBe('source_retired')
      } else {
        expect(recovered.transfer.phase).toBe(phase)
      }
    },
    15_000,
  )

  it('rejects tampered snapshot content and authenticated receipts', async () => {
    const scenario = await createScenario('tamper')
    const manifestPath = path.join(scenario.session.backup.directory, 'manifest.json')
    fs.chmodSync(manifestPath, 0o600)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      logicalRecordCounts: { captures: number }
    }
    manifest.logicalRecordCounts.captures += 1
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await expect(openScenario(scenario)).rejects.toMatchObject({
      failure: { code: 'snapshot_integrity_failed' },
    })

    const timestampTamper = await createScenario('timestamp-tamper')
    const timestampManifestPath = path.join(
      timestampTamper.session.backup.directory,
      'manifest.json',
    )
    fs.chmodSync(timestampManifestPath, 0o600)
    const timestampManifest = JSON.parse(
      fs.readFileSync(timestampManifestPath, 'utf8'),
    ) as { createdAt: string }
    timestampManifest.createdAt = '2030-01-01T00:00:00.000Z'
    fs.writeFileSync(timestampManifestPath, `${JSON.stringify(timestampManifest, null, 2)}\n`)
    await expect(openScenario(timestampTamper)).rejects.toMatchObject({
      failure: { code: 'snapshot_integrity_failed' },
    })

    const directoryTamper = await createScenario('directory-tamper')
    const emptyDirectory = path.join(
      directoryTamper.session.backup.workspaceDirectory,
      path.relative(
        directoryTamper.sourceRoot,
        path.join(resolveWorkspaceLayout(directoryTamper.sourceRoot).notesPath, 'empty-proof'),
      ),
    )
    fs.chmodSync(path.dirname(emptyDirectory), 0o700)
    fs.rmdirSync(emptyDirectory)
    await expect(openScenario(directoryTamper)).rejects.toMatchObject({
      failure: { code: 'snapshot_integrity_failed' },
    })

    const fresh = await createScenario('receipt-tamper')
    const journalPath = path.join(
      fresh.evidenceRoot,
      'transfers',
      fresh.transferId,
      'journal.json',
    )
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      document: {
        receipts: Array<{ authentication: { signature: string } }>
      }
    }
    journal.document.receipts[0]!.authentication.signature = Buffer.alloc(64).toString('base64')
    const resigned = authenticateWorkspaceDocument(
      journal.document,
      fresh.authorities['source-authority']!,
    )
    fs.writeFileSync(journalPath, `${JSON.stringify(resigned, null, 2)}\n`)
    await expect(openScenario(fresh)).rejects.toThrow(
      'Workspace migration receipt authentication failed.',
    )

    for (const field of ['phase', 'sourceState'] as const) {
      const tampered = await createScenario(`checkpoint-${field}`)
      const tamperedPath = path.join(
        tampered.evidenceRoot,
        'transfers',
        tampered.transferId,
        'journal.json',
      )
      const envelope = JSON.parse(fs.readFileSync(tamperedPath, 'utf8')) as {
        document: { transfer: Record<string, unknown> }
      }
      envelope.document.transfer[field] = 'tampered'
      fs.writeFileSync(tamperedPath, `${JSON.stringify(envelope, null, 2)}\n`)
      await expect(openScenario(tampered)).rejects.toThrow(
        'Workspace migration checkpoint authentication failed.',
      )
    }
  }, 30_000)
})

interface Scenario {
  authorities: Record<string, WorkspaceReceiptAuthority>
  evidenceRoot: string
  inspect: (workspaceRoot: string) => Promise<WorkspaceSnapshotInspection>
  interruption: TestInterruption
  root: string
  session: LocalWorkspaceMigrationSession
  sourceFence: TestSourceFence
  sourceRoot: string
  targetRoot: string
  transferId: string
}

async function createScenario(name: string): Promise<Scenario> {
  const root = ownedTemporaryRoot()
  const sourceRoot = path.join(root, 'source')
  const targetRoot = path.join(root, 'target')
  const evidenceRoot = path.join(root, 'evidence')
  const transferId = `transfer-${name}`
  const authorities = createAuthorities()
  const interruption = createInterruption()
  const sourceFence = createSourceFence()
  const sourceInspection = await seedWorkspace(sourceRoot)
  const inspect = async (workspaceRoot: string) => {
    if (path.resolve(workspaceRoot) === path.resolve(sourceRoot)) {
      return sourceInspection
    }
    return inspectWorkspace(workspaceRoot)
  }
  const session = await LocalWorkspaceMigrationSession.create({
    authorities,
    authorityEpoch: 4,
    evidenceRoot,
    inspect,
    interrupt: (point) => interruption.hook(point),
    now: () => timestamp,
    sourceFence,
    sourceAuthorityId: 'source-authority',
    sourceRoot,
    targetAuthorityId: 'target-authority',
    targetRoot,
    transferId,
    workspaceId: migrationWorkspaceId,
  })
  return {
    authorities,
    evidenceRoot,
    inspect,
    interruption,
    root,
    session,
    sourceFence,
    sourceRoot,
    targetRoot,
    transferId,
  }
}

function openScenario(scenario: Scenario): Promise<LocalWorkspaceMigrationSession> {
  return LocalWorkspaceMigrationSession.open({
    authorities: scenario.authorities,
    evidenceRoot: scenario.evidenceRoot,
    inspect: scenario.inspect,
    interrupt: (point) => scenario.interruption.hook(point),
    now: () => timestamp,
    sourceFence: scenario.sourceFence,
    sourceRoot: scenario.sourceRoot,
    targetRoot: scenario.targetRoot,
    transferId: scenario.transferId,
  })
}

async function advanceTo(scenario: Scenario, phase: typeof interruptionPhases[number]) {
  const { session } = scenario
  if (phase === 'aborted') {
    await session.abort()
    return
  }
  if (phase === 'prepared') return
  await session.stageSnapshot()
  if (phase === 'snapshot_staged') return
  await session.fenceSource()
  if (phase === 'source_fenced') return
  await session.verifyFinalSnapshot()
  if (phase === 'final_snapshot_verified') return
  await session.activateTarget(4)
  if (phase === 'activated') return
  await verifyDowngradeAndRetire(session, scenario.root)
}

async function verifyDowngradeAndRetire(
  session: LocalWorkspaceMigrationSession,
  _root: string,
): Promise<void> {
  await session.verifyRollbackBackup()
  await session.retireSource()
}

function isAbortable(phase: WorkspaceTransferPhase): phase is typeof abortablePhases[number] {
  return (abortablePhases as readonly WorkspaceTransferPhase[]).includes(phase)
}

function ownedTemporaryRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(
    path.join(os.tmpdir(), 'valedictorian-migration-recovery-'),
  ))
  temporaryRoots.add(root)
  return root
}

function createAuthorities(): Record<string, WorkspaceReceiptAuthority> {
  return Object.fromEntries(
    ['source-authority', 'target-authority'].map((authorityId) => {
      const keys = generateKeyPairSync('ed25519')
      return [authorityId, {
        authorityId,
        keyId: `${authorityId}-key-1`,
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
      }]
    }),
  )
}

interface TestSourceFence extends WorkspaceSourceFencePort {
  readonly fenced: boolean
  readonly unfenceCalls: number
}

interface TestInterruption {
  arm(point: WorkspaceMigrationSessionInterruptionPoint): void
  hook(point: WorkspaceMigrationSessionInterruptionPoint): void
}

function createInterruption(): TestInterruption {
  let armed: WorkspaceMigrationSessionInterruptionPoint | null = null
  return {
    arm(point) {
      armed = point
    },
    hook(point) {
      if (point !== armed) return
      armed = null
      throw new Error(`Injected interruption at ${point}.`)
    },
  }
}

function createSourceFence(): TestSourceFence {
  let fenceToken: string | null = null
  let fenced = false
  let unfenceCalls = 0
  return {
    get fenced() {
      return fenced
    },
    get unfenceCalls() {
      return unfenceCalls
    },
    async fenceAndDrain({ expectedFenceToken, transferId }) {
      fenceToken ??= transferId.replace(/^transfer-/, 'fence-')
      if (expectedFenceToken && expectedFenceToken !== fenceToken) {
        throw new Error('Fence token mismatch.')
      }
      fenced = true
      return { fenceToken }
    },
    async unfence(input) {
      if (!fenced) return
      if (input.fenceToken && input.fenceToken !== fenceToken) throw new Error('Invalid unfence.')
      fenced = false
      unfenceCalls += 1
    },
  }
}

async function seedWorkspace(workspaceRoot: string): Promise<WorkspaceSnapshotInspection> {
  const workspace = initializeWorkspace(workspaceRoot, {
    createId: () => migrationWorkspaceId,
    now: new Date(timestamp),
  })
  fs.writeFileSync(path.join(workspace.notesPath, 'migration-proof.md'), '# Proof\n')
  fs.mkdirSync(path.join(workspace.notesPath, 'empty-proof'))
  const client = await createPgliteClient({ dataDir: workspace.pgliteDataPath })
  try {
    const database = await migratePgliteDatabase(client)
    const capture = await createPgliteCaptureService(database, {
      newId: () => 'capture-base',
      now: () => new Date(timestamp),
    }).accept({
      actor: { type: 'system' },
      evidence: [{ kind: 'title', label: 'Role title', value: 'Migration Engineer' }],
      evidenceMode: 'reported',
      payload: { index: 0 },
      provenance: {
        adapterId: 'migration-fixture',
        adapterKind: 'import',
        adapterVersion: '1.0.0',
        observedAt: timestamp,
        providerRecordId: 'capture-base',
        providerSchema: 'migration-fixture@1',
      },
      workspaceId: migrationWorkspaceId,
    })
    if (!capture.ok) throw new Error(`Unable to seed migration Capture: ${capture.code}`)
    await createPgliteSecretService(
      database,
      {
        decrypt: () => fixturePlaintextSecret,
        encrypt: (value) => {
          if (value !== fixturePlaintextSecret) throw new Error('Unexpected fixture secret value.')
          return fixtureEncryptedEnvelope
        },
        isAvailable: () => true,
      },
      createWorkspaceSecretScope(migrationWorkspaceId),
    ).upsert({
      key: 'jobright-api',
      kind: 'token',
      label: 'Jobright API',
      value: fixturePlaintextSecret,
    })
    return await inspectDatabase(database, {
      id: workspace.id,
      workspaceVersion: 1,
    })
  } finally {
    await client.close()
    await settlePgliteClose()
  }
}

async function inspectWorkspace(workspaceRoot: string): Promise<WorkspaceSnapshotInspection> {
  const layout = resolveWorkspaceLayout(workspaceRoot)
  const manifest = JSON.parse(fs.readFileSync(layout.manifestPath, 'utf8')) as {
    id: string
    workspaceVersion: number
  }
  let client
  try {
    client = await createPgliteClient({ dataDir: layout.pgliteDataPath })
  } catch (error) {
    throw new Error(`Unable to inspect restored PGlite workspace at ${workspaceRoot}.`, {
      cause: error,
    })
  }
  try {
    const database = await migratePgliteDatabase(client)
    return await inspectDatabase(database, manifest)
  } catch (error) {
    throw new Error(`Unable to query restored PGlite workspace at ${workspaceRoot}.`, {
      cause: error,
    })
  } finally {
    await client.close()
    await settlePgliteClose()
  }
}

async function inspectDatabase(
  database: Awaited<ReturnType<typeof migratePgliteDatabase>>,
  manifest: { id: string; workspaceVersion: number },
): Promise<WorkspaceSnapshotInspection> {
  const [workspaceRows, captureRows, secretRows] = await Promise.all([
    database.query.workspaces.findMany({ columns: { id: true } }),
    database.query.captures.findMany({ columns: { id: true } }),
    database.query.workspaceSecrets.findMany({
      columns: { encryptedValue: true, key: true, kind: true },
    }),
  ])
  const logicalRecordCounts = {
    captures: captureRows.length,
    workspaceSecrets: secretRows.length,
    workspaces: workspaceRows.length,
  }
  const envelopes = secretRows
    .map((row) => ({ ...row }))
    .sort((left, right) => left.key.localeCompare(right.key))
  const secretEnvelopeDigest = sha256(canonicalJson(envelopes))
  return {
    logicalRecordCounts,
    requiredCapabilities: [
      'workspace.authority.transfer',
      'workspace.secrets.byokTransfer',
      'workspace.snapshot.export',
      'workspace.snapshot.import',
    ],
    revisionToken: sha256(canonicalJson({
      logicalRecordCounts,
      secretEnvelopeDigest,
      workspaceId: manifest.id,
    })),
    schemaVersion: `workspace:${manifest.workspaceVersion}/drizzle:7`,
    secretEnvelopeCount: envelopes.length,
    secretEnvelopeDigest,
    workspaceId: manifest.id,
  }
}

function treeDigest(root: string): string {
  const files: Array<{ path: string; sha256: string }> = []
  visit(root, '')
  return sha256(canonicalJson(files.sort((left, right) => left.path.localeCompare(right.path))))

  function visit(directory: string, relativeDirectory: string): void {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name)
      const relative = path.posix.join(relativeDirectory, name)
      if (fs.statSync(absolute).isDirectory()) visit(absolute, relative)
      else files.push({ path: relative, sha256: sha256(fs.readFileSync(absolute)) })
    }
  }
}

function digest(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function gitObjectExists(repositoryRoot: string, object: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', object], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function settlePgliteClose(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25))
}

function makeTreeWritable(root: string): void {
  if (!fs.existsSync(root)) return
  const stat = fs.lstatSync(root)
  if (!stat.isDirectory()) {
    fs.chmodSync(root, 0o600)
    return
  }
  fs.chmodSync(root, 0o700)
  for (const name of fs.readdirSync(root)) makeTreeWritable(path.join(root, name))
}
