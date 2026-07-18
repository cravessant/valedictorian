import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const forbiddenDependencyNames = new Set([
  '@types/better-sqlite3',
  'better-sqlite3',
  'bindings',
  'file-uri-to-path',
  'prebuild-install',
])

const forbiddenSourcePatterns = [
  ['better-sqlite3', /better-sqlite3/],
  ['SQLite database helper', /createFileDatabase|createInMemoryDatabase/],
  ['SQLite migration helper', /\bmigrateDatabase\s*\(/],
  ['old operational database path helper', /resolveDatabaseFilePath/],
  ['old operational database environment name VALEDICTORIAN_SQLITE_PATH', /VALEDICTORIAN_SQLITE_PATH/],
  ['old operational database path property sqlitePath', /\bsqlitePath\b/],
]

const policyImplementationFiles = new Set([
  'scripts/inspect-pglite-runtime-assets.mjs',
  'scripts/inspect-pglite-runtime-assets.test.ts',
  'scripts/pglite-cutover-policy.mjs',
  'scripts/pglite-cutover-policy.test.mjs',
  'electron/profile-runtime-composition.test.ts',
  'src/test/build-config.test.ts',
  'src/workspace/workspace.paths.test.ts',
])

export const pgliteCutoverAllowedLegacyEvidenceFiles = new Set([
  'UPGRADING.md',
  'electron/profile-runtime-composition.test.ts',
  'scripts/pglite-cutover-policy.mjs',
  'scripts/pglite-cutover-policy.test.mjs',
  'src/modules/profile/profile.upgrade-policy.test.ts',
  'src/modules/profile/profile.upgrade-policy.ts',
])

export function auditPgliteCutoverFiles(files) {
  const violations = []
  for (const [filePath, contents] of files) {
    if (isForbiddenFile(filePath)) violations.push(`${filePath}: forbidden file`)
    if (filePath === 'package.json') auditManifest(contents, violations)
    if (filePath === 'pnpm-lock.yaml') auditLockfile(contents, violations)
    if (
      filePath !== 'package.json'
      && filePath !== 'pnpm-lock.yaml'
      && !policyImplementationFiles.has(filePath)
    ) {
      for (const [label, pattern] of forbiddenSourcePatterns) {
        if (pattern.test(contents)) violations.push(`${filePath}: ${label} is forbidden`)
      }
    }
    if (
      contents.includes('valedictorian.sqlite')
      && !pgliteCutoverAllowedLegacyEvidenceFiles.has(filePath)
    ) {
      violations.push(
        `${filePath}: legacy SQLite file name is restricted to the staged profile upgrade policy`,
      )
    }
  }
  return [...new Set(violations)].sort()
}

function auditLockfile(contents, violations) {
  const packagesOffset = contents.indexOf('\npackages:\n')
  const importers = packagesOffset === -1 ? contents : contents.slice(0, packagesOffset)
  for (const dependencyName of forbiddenDependencyNames) {
    const escapedName = dependencyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const importerPattern = new RegExp(`^ {6}['"]?${escapedName}['"]?:`, 'm')
    const packagePattern = new RegExp(`^ {2}['"]?${escapedName}@`, 'm')
    if (importerPattern.test(importers) || packagePattern.test(contents)) {
      violations.push(`pnpm-lock.yaml: resolved package ${dependencyName} is forbidden`)
    }
  }
}

function isForbiddenFile(filePath) {
  if (filePath === 'src/db/sqlite.ts') return true
  if (filePath.startsWith('src/db/sqlite.')) return true
  if (/^drizzle\/.*\.sql$/.test(filePath)) {
    return filePath !== 'drizzle/0000_pglite_operational_baseline.sql'
  }
  return false
}

function auditManifest(contents, violations) {
  let manifest
  try {
    manifest = JSON.parse(contents)
  } catch {
    violations.push('package.json: invalid JSON')
    return
  }
  for (const sectionName of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const section = manifest[sectionName] ?? {}
    for (const dependencyName of Object.keys(section)) {
      if (forbiddenDependencyNames.has(dependencyName)) {
        violations.push(`package.json: dependency ${dependencyName} is forbidden`)
      }
    }
  }
  for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
    if (/better-sqlite3|install-app-deps|rebuild:native|rebuild:node/.test(String(command))) {
      violations.push(`package.json: script ${scriptName} retains a native database command`)
    }
  }
}

export function collectPgliteCutoverFiles(repoRoot) {
  const files = new Map()
  visit(repoRoot, repoRoot, files)
  return files
}

function visit(repoRoot, currentPath, files) {
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue
    if (['node_modules', 'dist', 'dist-electron', 'release', 'coverage'].includes(entry.name)) {
      continue
    }
    const absolutePath = path.join(currentPath, entry.name)
    if (entry.isDirectory()) {
      visit(repoRoot, absolutePath, files)
      continue
    }
    const relativePath = path.relative(repoRoot, absolutePath).replaceAll(path.sep, '/')
    if (!shouldAuditFile(relativePath)) continue
    files.set(relativePath, fs.readFileSync(absolutePath, 'utf8'))
  }
}

function shouldAuditFile(filePath) {
  if (['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(filePath)) return true
  if (filePath === 'electron-builder.json5' || filePath === 'vite.config.ts') return true
  return /\.(?:[cm]?[jt]sx?|json|json5|md|sql|ya?ml)$/.test(filePath)
}

function run() {
  const repoRoot = path.resolve(process.argv[2] ?? '.')
  const violations = auditPgliteCutoverFiles(collectPgliteCutoverFiles(repoRoot))
  if (violations.length === 0) {
    process.stdout.write('PGlite cutover policy OK\n')
    return
  }
  for (const violation of violations) process.stderr.write(`${violation}\n`)
  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) run()
