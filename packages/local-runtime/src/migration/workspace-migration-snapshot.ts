import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { WorkspaceProtocolError } from '@sparxie/valedictorian-workspace-server'
import {
  defaultAtomicDocumentFileOperations,
  writeAtomicDocument,
} from '../atomic-document.js'
import { canonicalJson, sha256 } from './workspace-migration-canonical.js'
import {
  canonicalizeWorkspacePath,
  workspacePathsOverlap,
} from './workspace-migration-paths.js'

export const supportedLocalWorkspaceMigrationFixtures = Object.freeze([
  Object.freeze({
    baselineSha256: 'c918d88b8b4d97b2e97e222c7ed3c1fa68de4a6ea26027fd6d480dc90992669d',
    compatibilityBundleSha256: '2c1a423b0509802a8029863f821a79cb87aacaa0528ca27e76d5cff2c96fd52e',
    compatibilityManifestSha256: 'd3b6d5a9b487545d42f611f8cbc10ee72c0e9c09de274876ce46f87afd49c5da',
    drizzleJournalSha256: 'b687eb1eb87e0fb742882558206d675fc689c9ac2afebfc05106dad43eaac708',
    drizzleJournalVersion: '7',
    pgliteIdentitySha256: 'c8675c9952e3f8ad24e04e67cdf392dca4bd9daeeffdddf497065cd084fd9d25',
    runtimeTag: 'v0.1.0-alpha.55',
    sourceTreeSha256: 'ecc38e31999fd90b954af642db6129187077e84f',
    workspaceVersion: 1,
  }),
])

export interface WorkspaceSnapshotInspection {
  logicalRecordCounts: Readonly<Record<string, number>>
  requiredCapabilities: readonly string[]
  revisionToken: string
  schemaVersion: string
  secretEnvelopeCount: number
  secretEnvelopeDigest: string
  workspaceId: string
}

export interface WorkspaceSnapshotFile {
  path: string
  sha256: string
  size: number
}

export interface WorkspaceSnapshotManifest extends WorkspaceSnapshotInspection {
  authorityEpoch: number
  authorityId: string
  createdAt: string
  directories: readonly string[]
  fenceToken: string | null
  files: readonly WorkspaceSnapshotFile[]
  snapshotId: string
}

export interface WorkspaceSnapshotArtifact {
  directory: string
  manifest: WorkspaceSnapshotManifest
  workspaceDirectory: string
}

interface WorkspaceRestoreTransaction {
  nonce: string
  phase: 'copying' | 'prepared' | 'old_moved' | 'swapped'
  previousPath: string
  replace: boolean
  snapshotId: string
  targetExisted: boolean
  targetRoot: string
  temporaryPath: string
  version: 2
}

export interface WorkspaceRestoreTransactionPaths {
  marker: string
  previous: string
  temporary: string
}

export type WorkspaceSnapshotInspector = (
  workspaceRoot: string,
) => Promise<WorkspaceSnapshotInspection>

export type WorkspaceMigrationInterruptionPoint =
  | 'snapshot.written'
  | 'snapshot.committed'
  | 'restore.copied'
  | 'restore.old_moved'
  | 'restore.swapped'

export type WorkspaceMigrationInterruptionHook = (
  point: WorkspaceMigrationInterruptionPoint,
) => Promise<void> | void

export async function createImmutableWorkspaceSnapshot(input: {
  authorityEpoch: number
  authorityId: string
  createdAt: string
  exportRoot: string
  fenceToken?: string | null
  inspect: WorkspaceSnapshotInspector
  interrupt?: WorkspaceMigrationInterruptionHook
  workspaceRoot: string
}): Promise<WorkspaceSnapshotArtifact> {
  const workspaceRoot = fs.realpathSync(input.workspaceRoot)
  const exportRoot = canonicalizeWorkspacePath(input.exportRoot)
  assertExportOutsideWorkspace(workspaceRoot, exportRoot)
  const inspection = normalizeInspection(await input.inspect(workspaceRoot))
  const inventory = listWorkspaceInventory(workspaceRoot)
  const identity = {
    ...inspection,
    authorityEpoch: input.authorityEpoch,
    authorityId: required(input.authorityId, 'authorityId'),
    createdAt: required(input.createdAt, 'createdAt'),
    directories: inventory.directories,
    fenceToken: input.fenceToken ?? null,
    files: inventory.files,
  }
  const snapshotId = sha256(canonicalJson(identity))
  const manifest: WorkspaceSnapshotManifest = Object.freeze({
    ...identity,
    snapshotId,
  })
  const artifact = resolveWorkspaceSnapshotArtifact(exportRoot, snapshotId, manifest)
  if (fs.existsSync(artifact.directory)) {
    await verifyWorkspaceSnapshot(artifact)
    return artifact
  }

  fs.mkdirSync(exportRoot, { recursive: true })
  const temporaryDirectory = path.join(
    exportRoot,
    `.${snapshotDirectoryName(snapshotId)}.${randomUUID()}.tmp`,
  )
  fs.mkdirSync(temporaryDirectory, { mode: 0o700 })
  try {
    const temporaryWorkspace = path.join(temporaryDirectory, 'workspace')
    copyWorkspace(workspaceRoot, temporaryWorkspace, inventory)
    fs.writeFileSync(
      path.join(temporaryDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o400 },
    )
    makeSnapshotReadOnly(temporaryDirectory)
    fsyncWorkspaceTree(temporaryDirectory)
    await input.interrupt?.('snapshot.written')
    fs.renameSync(temporaryDirectory, artifact.directory)
    defaultAtomicDocumentFileOperations.fsyncDirectory(exportRoot)
  } catch (error) {
    if (fs.existsSync(temporaryDirectory)) makeWorkspaceWritable(temporaryDirectory)
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
    if (fs.existsSync(artifact.directory)) {
      await verifyWorkspaceSnapshot(artifact)
      return artifact
    }
    throw error
  }
  await verifyWorkspaceSnapshot(artifact)
  await input.interrupt?.('snapshot.committed')
  return artifact
}

export function resolveWorkspaceSnapshotArtifact(
  exportRoot: string,
  snapshotId: string,
  manifest?: WorkspaceSnapshotManifest,
): WorkspaceSnapshotArtifact {
  const directory = path.join(
    canonicalizeWorkspacePath(exportRoot),
    snapshotDirectoryName(snapshotId),
  )
  const resolvedManifest = manifest ?? readManifest(directory)
  return {
    directory,
    manifest: resolvedManifest,
    workspaceDirectory: path.join(directory, 'workspace'),
  }
}

export async function verifyWorkspaceSnapshot(
  artifact: WorkspaceSnapshotArtifact,
): Promise<void> {
  const manifest = readManifest(artifact.directory)
  const inventory = listWorkspaceInventory(artifact.workspaceDirectory)
  const identity = snapshotIdentity(manifest)
  if (
    canonicalJson(inventory.directories) !== canonicalJson(manifest.directories)
    || canonicalJson(inventory.files) !== canonicalJson(manifest.files)
    || sha256(canonicalJson(identity)) !== manifest.snapshotId
    || manifest.snapshotId !== artifact.manifest.snapshotId
  ) {
    throw new WorkspaceProtocolError(
      'snapshot_integrity_failed',
      'Workspace snapshot content does not match its immutable manifest.',
    )
  }
}

export async function restoreWorkspaceSnapshot(
  artifact: WorkspaceSnapshotArtifact,
  targetRoot: string,
  options: {
    interrupt?: WorkspaceMigrationInterruptionHook
    replace?: boolean
  } = {},
): Promise<void> {
  await verifyWorkspaceSnapshot(artifact)
  assertNotTerminalSymlink(targetRoot, 'restore target')
  const target = canonicalizeWorkspacePath(targetRoot)
  assertSafeRestoreTarget(target, artifact.directory)
  const replace = options.replace === true
  const parent = path.dirname(target)
  fs.mkdirSync(parent, { recursive: true })
  if (recoverWorkspaceRestoreTransaction(artifact, target, replace)) return
  const targetExisted = pathEntryExists(target)
  if (targetExisted && !replace) {
    throw new WorkspaceProtocolError(
      'snapshot_invalid',
      'Workspace snapshot target already exists.',
    )
  }
  const nonce = randomUUID()
  const transaction = resolveWorkspaceRestoreTransactionPaths(target, nonce)
  assertTransactionEntriesAreNotSymlinks(transaction)
  if (pathEntryExists(transaction.previous) || pathEntryExists(transaction.temporary)) {
    throw new WorkspaceProtocolError(
      'snapshot_invalid',
      'Workspace restore transaction paths already exist.',
    )
  }
  let marker: WorkspaceRestoreTransaction = {
    nonce,
    phase: 'copying',
    previousPath: transaction.previous,
    replace,
    snapshotId: artifact.manifest.snapshotId,
    targetExisted,
    targetRoot: target,
    temporaryPath: transaction.temporary,
    version: 2,
  }
  createRestoreTransaction(transaction.marker, marker)
  try {
    fs.mkdirSync(transaction.temporary, { mode: 0o700 })
    copyWorkspace(artifact.workspaceDirectory, transaction.temporary, {
      directories: artifact.manifest.directories,
      files: artifact.manifest.files,
    })
    makeWorkspaceWritable(transaction.temporary)
    assertWorkspaceInventoryMatches(artifact.manifest, transaction.temporary)
    fsyncWorkspaceTree(transaction.temporary)
    marker = { ...marker, phase: 'prepared' }
    writeRestoreTransaction(transaction.marker, marker)
    await options.interrupt?.('restore.copied')
    if (targetExisted) {
      fs.renameSync(target, transaction.previous)
      defaultAtomicDocumentFileOperations.fsyncDirectory(parent)
      marker = { ...marker, phase: 'old_moved' }
      writeRestoreTransaction(transaction.marker, marker)
      await options.interrupt?.('restore.old_moved')
    }
    fs.renameSync(transaction.temporary, target)
    defaultAtomicDocumentFileOperations.fsyncDirectory(parent)
    marker = { ...marker, phase: 'swapped' }
    writeRestoreTransaction(transaction.marker, marker)
    await options.interrupt?.('restore.swapped')
    assertWorkspaceInventoryMatches(artifact.manifest, target)
    completeWorkspaceRestoreTransaction(transaction, parent)
  } catch (error) {
    rollbackCurrentRestoreAttempt(artifact, target, marker, transaction)
    throw error
  }
}

export function resolveWorkspaceRestoreTransactionPaths(
  targetRoot: string,
  nonce: string,
): WorkspaceRestoreTransactionPaths {
  if (!isRestoreNonce(nonce)) throw new TypeError('Restore transaction nonce is invalid.')
  const target = path.resolve(targetRoot)
  const parent = path.dirname(target)
  const prefix = `.${path.basename(targetRoot)}.restore`
  return {
    marker: path.join(parent, `${prefix}.json`),
    previous: path.join(parent, `${prefix}.${nonce}.previous`),
    temporary: path.join(parent, `${prefix}.${nonce}.tmp`),
  }
}

export async function reconcileWorkspaceSnapshot(
  artifact: WorkspaceSnapshotArtifact,
  targetRoot: string,
  inspect: WorkspaceSnapshotInspector,
): Promise<WorkspaceSnapshotInspection> {
  assertWorkspaceInventoryMatches(artifact.manifest, canonicalizeWorkspacePath(targetRoot))
  const inspection = normalizeInspection(await inspect(targetRoot))
  const expected = snapshotInspection(artifact.manifest)
  if (canonicalJson(inspection) !== canonicalJson(expected)) {
    throw new WorkspaceProtocolError(
      'snapshot_integrity_failed',
      'Restored workspace identities, counts, or secret envelopes do not reconcile.',
    )
  }
  return inspection
}

function normalizeInspection(
  inspection: WorkspaceSnapshotInspection,
): WorkspaceSnapshotInspection {
  const logicalRecordCounts = Object.fromEntries(
    Object.entries(inspection.logicalRecordCounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => {
        if (!Number.isSafeInteger(count) || count < 0) {
          throw new TypeError(`Logical record count ${name} must be a non-negative integer.`)
        }
        return [required(name, 'logicalRecordCount name'), count]
      }),
  )
  if (!Number.isSafeInteger(inspection.secretEnvelopeCount) || inspection.secretEnvelopeCount < 0) {
    throw new TypeError('secretEnvelopeCount must be a non-negative integer.')
  }
  return Object.freeze({
    logicalRecordCounts: Object.freeze(logicalRecordCounts),
    requiredCapabilities: Object.freeze(
      [...inspection.requiredCapabilities].map((value) => required(value, 'capability')).sort(),
    ),
    revisionToken: required(inspection.revisionToken, 'revisionToken'),
    schemaVersion: required(inspection.schemaVersion, 'schemaVersion'),
    secretEnvelopeCount: inspection.secretEnvelopeCount,
    secretEnvelopeDigest: required(inspection.secretEnvelopeDigest, 'secretEnvelopeDigest'),
    workspaceId: required(inspection.workspaceId, 'workspaceId'),
  })
}

function listWorkspaceInventory(root: string): {
  directories: string[]
  files: WorkspaceSnapshotFile[]
} {
  const directories: string[] = []
  const files: WorkspaceSnapshotFile[] = []
  visit(root, '')
  return {
    directories: directories.sort(),
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  }

  function visit(directory: string, relativeDirectory: string): void {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name)
      const relative = path.posix.join(relativeDirectory, name)
      const stat = fs.lstatSync(absolute)
      if (stat.isSymbolicLink()) {
        throw new WorkspaceProtocolError('snapshot_invalid', 'Workspace snapshots cannot contain symlinks.')
      }
      if (stat.isDirectory()) {
        directories.push(relative)
        visit(absolute, relative)
      } else if (stat.isFile()) {
        files.push({
          path: relative,
          sha256: sha256(fs.readFileSync(absolute)),
          size: stat.size,
        })
      } else {
        throw new WorkspaceProtocolError('snapshot_invalid', 'Workspace snapshots contain regular files only.')
      }
    }
  }
}

function copyWorkspace(
  sourceRoot: string,
  targetRoot: string,
  inventory: {
    directories: readonly string[]
    files: readonly WorkspaceSnapshotFile[]
  },
): void {
  fs.mkdirSync(targetRoot, { recursive: true })
  for (const directory of inventory.directories) {
    fs.mkdirSync(path.join(targetRoot, ...directory.split('/')), { recursive: true })
  }
  for (const file of inventory.files) {
    const source = path.join(sourceRoot, ...file.path.split('/'))
    const target = path.join(targetRoot, ...file.path.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  }
}

function makeSnapshotReadOnly(root: string): void {
  const directories: string[] = []
  visit(root)
  for (const directory of directories.reverse()) fs.chmodSync(directory, 0o500)

  function visit(directory: string): void {
    directories.push(directory)
    for (const name of fs.readdirSync(directory)) {
      const entry = path.join(directory, name)
      if (fs.statSync(entry).isDirectory()) visit(entry)
      else fs.chmodSync(entry, 0o400)
    }
  }
}

function makeWorkspaceWritable(root: string): void {
  const rootStat = fs.lstatSync(root)
  if (rootStat.isSymbolicLink()) return
  if (!rootStat.isDirectory()) {
    fs.chmodSync(root, 0o600)
    return
  }
  fs.chmodSync(root, 0o700)
  for (const name of fs.readdirSync(root)) {
    const entry = path.join(root, name)
    makeWorkspaceWritable(entry)
  }
}

function readManifest(directory: string): WorkspaceSnapshotManifest {
  return JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as WorkspaceSnapshotManifest
}

function snapshotIdentity(manifest: WorkspaceSnapshotManifest) {
  const { snapshotId: _snapshotId, ...identity } = manifest
  return identity
}

function snapshotInspection(manifest: WorkspaceSnapshotManifest): WorkspaceSnapshotInspection {
  const {
    logicalRecordCounts,
    requiredCapabilities,
    revisionToken,
    schemaVersion,
    secretEnvelopeCount,
    secretEnvelopeDigest,
    workspaceId,
  } = manifest
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

function assertWorkspaceInventoryMatches(
  manifest: Pick<WorkspaceSnapshotManifest, 'directories' | 'files'>,
  workspaceRoot: string,
): void {
  const inventory = listWorkspaceInventory(workspaceRoot)
  if (
    canonicalJson(inventory.directories) !== canonicalJson(manifest.directories)
    || canonicalJson(inventory.files) !== canonicalJson(manifest.files)
  ) {
    throw new WorkspaceProtocolError(
      'snapshot_integrity_failed',
      'Restored workspace file and directory integrity does not match the snapshot.',
    )
  }
}

function recoverWorkspaceRestoreTransaction(
  artifact: WorkspaceSnapshotArtifact,
  target: string,
  replace: boolean,
): boolean {
  const markerPath = restoreTransactionMarkerPath(target)
  assertNotTerminalSymlink(markerPath, 'restore transaction marker')
  if (!pathEntryExists(markerPath)) return false
  const marker = readRestoreTransaction(markerPath, artifact, target, replace)
  const transaction = resolveWorkspaceRestoreTransactionPaths(target, marker.nonce)
  assertTransactionEntriesAreNotSymlinks(transaction)
  const targetExists = pathEntryExists(target)
  const previousExists = pathEntryExists(transaction.previous)
  const temporaryExists = pathEntryExists(transaction.temporary)
  const targetMatches = targetExists && workspaceInventoryMatches(artifact.manifest, target)
  const temporaryMatches = temporaryExists
    && workspaceInventoryMatches(artifact.manifest, transaction.temporary)

  if (marker.phase === 'copying' || marker.phase === 'prepared') {
    if (marker.targetExisted && !targetExists && previousExists && temporaryExists) {
      rollbackWorkspaceRestoreTransaction(target, transaction, path.dirname(target))
      return false
    }
    if (
      marker.targetExisted
        ? targetExists && !previousExists
        : !targetExists && !previousExists
    ) {
      removeWorkspaceTree(transaction.temporary)
      removeRestoreMarker(transaction.marker, path.dirname(target))
      return false
    }
    if (!marker.targetExisted && targetMatches && !previousExists && !temporaryExists) {
      completeWorkspaceRestoreTransaction(transaction, path.dirname(target))
      return true
    }
    restoreTransactionConflict()
  }

  if (marker.phase === 'old_moved') {
    if (
      marker.targetExisted
      && !targetExists
      && previousExists
      && temporaryMatches
    ) {
      rollbackWorkspaceRestoreTransaction(target, transaction, path.dirname(target))
      return false
    }
    if (
      !marker.targetExisted
      && !targetExists
      && !previousExists
      && temporaryMatches
    ) {
      removeWorkspaceTree(transaction.temporary)
      removeRestoreMarker(transaction.marker, path.dirname(target))
      return false
    }
    if (
      targetMatches
      && !temporaryExists
      && previousExists === marker.targetExisted
    ) {
      completeWorkspaceRestoreTransaction(transaction, path.dirname(target))
      return true
    }
    restoreTransactionConflict()
  }

  if (
    marker.phase === 'swapped'
    && targetMatches
    && !temporaryExists
    && previousExists === marker.targetExisted
  ) {
    completeWorkspaceRestoreTransaction(transaction, path.dirname(target))
    return true
  }
  restoreTransactionConflict()
}

function rollbackWorkspaceRestoreTransaction(
  target: string,
  transaction: WorkspaceRestoreTransactionPaths,
  parent: string,
): void {
  assertNotTerminalSymlink(target, 'restore target')
  assertTransactionEntriesAreNotSymlinks(transaction)
  if (!pathEntryExists(transaction.previous) || pathEntryExists(target)) {
    restoreTransactionConflict()
  }
  fs.renameSync(transaction.previous, target)
  defaultAtomicDocumentFileOperations.fsyncDirectory(parent)
  removeWorkspaceTree(transaction.temporary)
  removeRestoreMarker(transaction.marker, parent)
}

function rollbackCurrentRestoreAttempt(
  artifact: WorkspaceSnapshotArtifact,
  target: string,
  marker: WorkspaceRestoreTransaction,
  transaction: WorkspaceRestoreTransactionPaths,
): void {
  const parent = path.dirname(target)
  assertNotTerminalSymlink(target, 'restore target')
  assertTransactionEntriesAreNotSymlinks(transaction)
  const targetExists = pathEntryExists(target)
  const previousExists = pathEntryExists(transaction.previous)
  const temporaryExists = pathEntryExists(transaction.temporary)
  if (marker.phase === 'copying' || marker.phase === 'prepared') {
    if (
      previousExists
      || targetExists !== marker.targetExisted
    ) {
      restoreTransactionConflict()
    }
    removeWorkspaceTree(transaction.temporary)
    removeRestoreMarker(transaction.marker, parent)
    return
  }
  if (marker.phase === 'old_moved') {
    if (
      !marker.targetExisted
      || targetExists
      || !previousExists
      || !temporaryExists
    ) {
      restoreTransactionConflict()
    }
    rollbackWorkspaceRestoreTransaction(target, transaction, parent)
    return
  }
  if (
    marker.phase !== 'swapped'
    || !targetExists
    || !workspaceInventoryMatches(artifact.manifest, target)
    || temporaryExists
    || previousExists !== marker.targetExisted
  ) {
    restoreTransactionConflict()
  }
  removeWorkspaceTree(target)
  if (marker.targetExisted) {
    fs.renameSync(transaction.previous, target)
    defaultAtomicDocumentFileOperations.fsyncDirectory(parent)
  }
  removeRestoreMarker(transaction.marker, parent)
}

function completeWorkspaceRestoreTransaction(
  transaction: WorkspaceRestoreTransactionPaths,
  parent: string,
): void {
  removeWorkspaceTree(transaction.previous)
  removeWorkspaceTree(transaction.temporary)
  removeRestoreMarker(transaction.marker, parent)
}

function writeRestoreTransaction(
  markerPath: string,
  transaction: WorkspaceRestoreTransaction,
): void {
  writeAtomicDocument(markerPath, `${JSON.stringify(transaction, null, 2)}\n`)
}

function createRestoreTransaction(
  markerPath: string,
  transaction: WorkspaceRestoreTransaction,
): void {
  const parent = path.dirname(markerPath)
  assertNotTerminalSymlink(markerPath, 'restore transaction marker')
  if (pathEntryExists(markerPath)) restoreTransactionConflict()
  const claim = `${markerPath}.${transaction.nonce}.claim`
  writeExclusiveRestoreClaim(claim, `${JSON.stringify(transaction, null, 2)}\n`)
  try {
    fs.linkSync(claim, markerPath)
    defaultAtomicDocumentFileOperations.fsyncDirectory(parent)
  } finally {
    if (pathEntryExists(claim)) {
      fs.unlinkSync(claim)
      defaultAtomicDocumentFileOperations.fsyncDirectory(parent)
    }
  }
}

function writeExclusiveRestoreClaim(claimPath: string, contents: string): void {
  const contentsBuffer = Buffer.from(contents, 'utf8')
  const descriptor = fs.openSync(claimPath, 'wx', 0o600)
  let complete = false
  try {
    let offset = 0
    while (offset < contentsBuffer.length) {
      const written = fs.writeSync(
        descriptor,
        contentsBuffer,
        offset,
        contentsBuffer.length - offset,
      )
      if (!Number.isInteger(written) || written <= 0) {
        throw new Error('Restore transaction claim write made no progress.')
      }
      offset += written
    }
    fs.fsyncSync(descriptor)
    complete = true
  } finally {
    fs.closeSync(descriptor)
    if (!complete && pathEntryExists(claimPath)) fs.unlinkSync(claimPath)
  }
}

function readRestoreTransaction(
  markerPath: string,
  artifact: WorkspaceSnapshotArtifact,
  target: string,
  replace: boolean,
): WorkspaceRestoreTransaction {
  let candidate: unknown
  try {
    candidate = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
  } catch {
    return restoreTransactionConflict()
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return restoreTransactionConflict()
  }
  const record = candidate as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expectedKeys = [
    'nonce',
    'phase',
    'previousPath',
    'replace',
    'snapshotId',
    'targetExisted',
    'targetRoot',
    'temporaryPath',
    'version',
  ].sort()
  if (canonicalJson(keys) !== canonicalJson(expectedKeys) || !isRestoreNonce(record.nonce)) {
    return restoreTransactionConflict()
  }
  const transaction = record as unknown as WorkspaceRestoreTransaction
  const paths = resolveWorkspaceRestoreTransactionPaths(target, transaction.nonce)
  if (
    transaction.version !== 2
    || !['copying', 'prepared', 'old_moved', 'swapped'].includes(transaction.phase)
    || typeof transaction.replace !== 'boolean'
    || typeof transaction.targetExisted !== 'boolean'
    || transaction.targetExisted && !transaction.replace
    || transaction.replace !== replace
    || transaction.snapshotId !== artifact.manifest.snapshotId
    || transaction.targetRoot !== target
    || transaction.previousPath !== paths.previous
    || transaction.temporaryPath !== paths.temporary
  ) {
    return restoreTransactionConflict()
  }
  return transaction
}

function removeRestoreMarker(markerPath: string, parent: string): void {
  if (!fs.existsSync(markerPath)) return
  assertNotTerminalSymlink(markerPath, 'restore transaction marker')
  fs.unlinkSync(markerPath)
  defaultAtomicDocumentFileOperations.fsyncDirectory(parent)
}

function removeWorkspaceTree(candidate: string): void {
  if (!fs.existsSync(candidate)) return
  assertNotTerminalSymlink(candidate, 'restore transaction path')
  makeWorkspaceWritable(candidate)
  fs.rmSync(candidate, { force: true, recursive: true })
}

function assertTransactionEntriesAreNotSymlinks(
  transaction: WorkspaceRestoreTransactionPaths,
): void {
  assertNotTerminalSymlink(transaction.marker, 'restore transaction marker')
  assertNotTerminalSymlink(transaction.previous, 'restore previous target')
  assertNotTerminalSymlink(transaction.temporary, 'restore temporary target')
}

function assertNotTerminalSymlink(candidate: string, label: string): void {
  const resolved = path.resolve(candidate)
  try {
    if (fs.lstatSync(resolved).isSymbolicLink()) {
      throw new TypeError(`Refusing a symbolic-link ${label}.`)
    }
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return
    }
    throw error
  }
}

function pathEntryExists(candidate: string): boolean {
  try {
    fs.lstatSync(candidate)
    return true
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}

function restoreTransactionMarkerPath(target: string): string {
  const parent = path.dirname(target)
  return path.join(parent, `.${path.basename(target)}.restore.json`)
}

function isRestoreNonce(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}

function restoreTransactionConflict(): never {
  throw new WorkspaceProtocolError(
    'snapshot_invalid',
    'Workspace restore transaction state is invalid or ambiguous.',
  )
}

function workspaceInventoryMatches(
  manifest: Pick<WorkspaceSnapshotManifest, 'directories' | 'files'>,
  workspaceRoot: string,
): boolean {
  try {
    const inventory = listWorkspaceInventory(workspaceRoot)
    return canonicalJson(inventory.directories) === canonicalJson(manifest.directories)
      && canonicalJson(inventory.files) === canonicalJson(manifest.files)
  } catch {
    return false
  }
}

function fsyncWorkspaceTree(root: string): void {
  const directories: string[] = []
  visit(root)
  for (const directory of directories.reverse()) {
    defaultAtomicDocumentFileOperations.fsyncDirectory(directory)
  }

  function visit(directory: string): void {
    directories.push(directory)
    for (const name of fs.readdirSync(directory)) {
      const entry = path.join(directory, name)
      if (fs.statSync(entry).isDirectory()) {
        visit(entry)
      } else {
        const descriptor = fs.openSync(entry, 'r')
        try {
          fs.fsyncSync(descriptor)
        } finally {
          fs.closeSync(descriptor)
        }
      }
    }
  }
}

function snapshotDirectoryName(snapshotId: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(snapshotId)) {
    throw new TypeError('snapshotId must be a SHA-256 identity.')
  }
  return snapshotId.replace(':', '-')
}

function assertExportOutsideWorkspace(workspaceRoot: string, exportRoot: string): void {
  if (workspacePathsOverlap(workspaceRoot, exportRoot)) {
    throw new TypeError('Snapshot exports must live outside the workspace.')
  }
}

function assertSafeRestoreTarget(targetRoot: string, artifactRoot: string): void {
  const target = canonicalizeWorkspacePath(targetRoot)
  const artifact = canonicalizeWorkspacePath(artifactRoot)
  if (
    target === path.parse(target).root
    || workspacePathsOverlap(target, artifact)
  ) {
    throw new TypeError('Refusing an unsafe workspace snapshot restore target.')
  }
}

function required(value: string, field: string): string {
  if (!value.trim()) throw new TypeError(`${field} must be a non-empty string.`)
  return value
}
