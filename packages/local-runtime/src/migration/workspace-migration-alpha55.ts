import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PGLITE_PACKAGE_NAME,
  PGLITE_PACKAGE_VERSION,
  resolvePgliteRuntimeAssetPaths,
  resolvePgliteRuntimeDirectory,
} from '../pglite.js'
import { canonicalJson, sha256 } from './workspace-migration-canonical.js'
import {
  restoreWorkspaceSnapshot,
  supportedLocalWorkspaceMigrationFixtures,
  type WorkspaceSnapshotArtifact,
  type WorkspaceSnapshotInspection,
} from './workspace-migration-snapshot.js'

export type SupportedLocalWorkspaceMigrationFixture =
  (typeof supportedLocalWorkspaceMigrationFixtures)[number]

export interface WorkspaceOldRuntimeVerification {
  evidenceDigest: string
  fixture: SupportedLocalWorkspaceMigrationFixture
  inspection: WorkspaceSnapshotInspection
}

export const ALPHA55_VERIFIER_TIMEOUT_MS = 30_000

interface Alpha55VerifierManifest {
  baselineSha256: string
  bundleSha256: string
  drizzleJournalSha256: string
  drizzleVersion: string
  pgliteRuntimeSha256: Record<string, string>
  pgliteVersion: string
  runtimeTag: string
  sourceFilesSha256: Record<string, string>
  sourceTreeSha256: string
  version: number
  workspaceVersion: number
}

export async function verifyAlpha55ImmutableBackup(input: {
  backup: WorkspaceSnapshotArtifact
  restoreRoot: string
}): Promise<WorkspaceOldRuntimeVerification> {
  const fixture = supportedLocalWorkspaceMigrationFixtures[0]
  if (!fixture) throw new Error('The alpha.55 compatibility fixture is unavailable.')
  const compatibility = assertAlpha55CompatibilityIdentity(fixture)
  if (input.backup.manifest.schemaVersion !== 'workspace:1/drizzle:7') {
    throw new Error('Immutable backup is not compatible with the alpha.55 workspace schema.')
  }
  await restoreWorkspaceSnapshot(input.backup, input.restoreRoot, { replace: true })
  const output = execFileSync(
    process.execPath,
    [compatibility.bundlePath, input.restoreRoot],
    {
      encoding: 'utf8',
      env: alpha55VerifierEnvironment(),
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: ALPHA55_VERIFIER_TIMEOUT_MS,
      windowsHide: true,
    },
  )
  const inspection = JSON.parse(output) as WorkspaceSnapshotInspection
  return Object.freeze({
    evidenceDigest: sha256(canonicalJson({
      fixture,
      inspection,
      snapshotId: input.backup.manifest.snapshotId,
    })),
    fixture,
    inspection,
  })
}

export function assertAlpha55CompatibilityIdentity(
  fixture: SupportedLocalWorkspaceMigrationFixture,
): { bundlePath: string; manifest: Alpha55VerifierManifest } {
  const expectedFixture = supportedLocalWorkspaceMigrationFixtures[0]
  const migrationsFolder = resolveCompatibilityMigrationsFolder()
  const compatibilityRoot = path.join(migrationsFolder, 'compatibility')
  const bundlePath = path.join(compatibilityRoot, 'alpha55-verifier.mjs')
  const manifestPath = path.join(compatibilityRoot, 'alpha55-verifier.json')
  const manifestBytes = fs.readFileSync(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as Alpha55VerifierManifest
  const require = createRequire(import.meta.url)
  const drizzlePackage = JSON.parse(fs.readFileSync(
    path.join(path.dirname(require.resolve('drizzle-orm')), 'package.json'),
    'utf8',
  )) as { version?: string }
  const runtimePaths = resolvePgliteRuntimeAssetPaths(resolvePgliteRuntimeDirectory())
  const runtimeDigests = Object.fromEntries(
    Object.entries(runtimePaths)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, file]) => [name, digestFile(file)]),
  )
  if (
    !expectedFixture
    || canonicalJson(fixture) !== canonicalJson(expectedFixture)
    || digestText(manifestBytes) !== fixture.compatibilityManifestSha256
    || digestFile(bundlePath) !== fixture.compatibilityBundleSha256
    || manifest.bundleSha256 !== fixture.compatibilityBundleSha256
    || manifest.runtimeTag !== fixture.runtimeTag
    || manifest.sourceTreeSha256 !== fixture.sourceTreeSha256
    || manifest.workspaceVersion !== fixture.workspaceVersion
    || manifest.baselineSha256 !== fixture.baselineSha256
    || manifest.drizzleJournalSha256 !== fixture.drizzleJournalSha256
    || manifest.pgliteVersion !== PGLITE_PACKAGE_VERSION
    || manifest.pgliteVersion !== '0.5.4'
    || manifest.drizzleVersion !== '0.45.2'
    || drizzlePackage.version !== manifest.drizzleVersion
    || digestText(`${PGLITE_PACKAGE_NAME}@${PGLITE_PACKAGE_VERSION}`)
      !== fixture.pgliteIdentitySha256
    || canonicalJson(runtimeDigests) !== canonicalJson(manifest.pgliteRuntimeSha256)
    || digestFile(path.join(migrationsFolder, '0000_pglite_operational_baseline.sql'))
      !== manifest.baselineSha256
    || digestFile(path.join(migrationsFolder, 'meta/_journal.json'))
      !== manifest.drizzleJournalSha256
  ) {
    throw new Error('The alpha.55 compatibility bundle does not match its frozen fixture.')
  }
  return { bundlePath, manifest }
}

function resolveCompatibilityMigrationsFolder(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    ...(resourcesPath ? [path.join(resourcesPath, 'drizzle')] : []),
    path.resolve(moduleDirectory, '../../drizzle'),
    path.resolve(moduleDirectory, '../drizzle'),
  ]
  const resolved = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'compatibility/alpha55-verifier.json')))
  if (!resolved) throw new Error('Unable to resolve the alpha.55 compatibility bundle.')
  return resolved
}

function digestFile(file: string): string {
  return digestText(fs.readFileSync(file))
}

function digestText(value: string | Buffer): string {
  return sha256(value).replace('sha256:', '')
}

function alpha55VerifierEnvironment(): NodeJS.ProcessEnv {
  const allowedNames = [
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
    'WINDIR',
  ] as const
  return Object.fromEntries(
    allowedNames.flatMap((name) => (
      process.env[name] === undefined ? [] : [[name, process.env[name]]]
    )),
  )
}
