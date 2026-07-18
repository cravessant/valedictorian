import assert from 'node:assert/strict'
import test from 'node:test'
import {
  auditPgliteCutoverFiles,
  pgliteCutoverAllowedLegacyEvidenceFiles,
} from './pglite-cutover-policy.mjs'

test('rejects operational SQLite dependencies, scripts, imports, paths, and migration assets', () => {
  const violations = auditPgliteCutoverFiles(new Map([
    ['package.json', JSON.stringify({
      dependencies: { 'better-sqlite3': '1.0.0', bindings: '1.0.0' },
      devDependencies: { '@types/better-sqlite3': '1.0.0', 'prebuild-install': '1.0.0' },
      scripts: { test: 'pnpm rebuild better-sqlite3 && vitest run' },
    })],
    ['electron-builder.json5', '{ "asarUnpack": ["better-sqlite3"] }'],
    ['src/db/sqlite.ts', "import Database from 'better-sqlite3'\n"],
    ['src/runtime/bridge.ts', "import { createFileDatabase } from '../db/sqlite'\n"],
    ['src/workspace/paths.ts', "const sqlitePath = process.env.VALEDICTORIAN_SQLITE_PATH\n"],
    ['drizzle/0001_legacy.sql', 'create table legacy(id text);\n'],
  ]))

  assert.ok(violations.some((value) => value.includes('package.json: dependency better-sqlite3')))
  assert.ok(violations.some((value) => value.includes('package.json: script test')))
  assert.ok(violations.some((value) => value.includes('electron-builder.json5')))
  assert.ok(violations.some((value) => value.includes('src/db/sqlite.ts: forbidden file')))
  assert.ok(violations.some((value) => value.includes('src/runtime/bridge.ts')))
  assert.ok(violations.some((value) => value.includes('VALEDICTORIAN_SQLITE_PATH')))
  assert.ok(violations.some((value) => value.includes('drizzle/0001_legacy.sql')))
})

test('allows only the documented legacy profile evidence name after reader removal', () => {
  const allowedFiles = new Map(
    [...pgliteCutoverAllowedLegacyEvidenceFiles].map((filePath) => [
      filePath,
      'The immutable valedictorian.sqlite profile migration evidence is never read.\n',
    ]),
  )

  assert.deepEqual(auditPgliteCutoverFiles(allowedFiles), [])
  assert.deepEqual(
    auditPgliteCutoverFiles(new Map([
      ['src/runtime/legacy.ts', "const legacy = 'valedictorian.sqlite'\n"],
    ])),
    ['src/runtime/legacy.ts: legacy SQLite file name is restricted to the staged profile upgrade policy'],
  )
})

test('accepts a PGlite-only manifest and fresh PostgreSQL baseline', () => {
  const violations = auditPgliteCutoverFiles(new Map([
    ['package.json', JSON.stringify({
      dependencies: { '@electric-sql/pglite': '0.5.4' },
      scripts: { test: 'vitest run', 'db:migrate': 'tsx scripts/migrate.ts' },
    })],
    ['pnpm-lock.yaml', `lockfileVersion: '9.0'

packages:
  drizzle-orm@0.45.2:
    peerDependencies:
      better-sqlite3: '>=7'
    peerDependenciesMeta:
      better-sqlite3:
        optional: true
`],
    ['electron-builder.json5', '{ "extraResources": [{ "to": "pglite-runtime" }] }'],
    ['src/db/pglite.ts', "import { PGlite } from '@electric-sql/pglite'\n"],
    ['drizzle/0000_pglite_operational_baseline.sql', 'create table applications(id text);\n'],
  ]))

  assert.deepEqual(violations, [])
})

test('rejects forbidden packages resolved in the lockfile while allowing optional peer metadata', () => {
  const lockfile = `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      better-sqlite3:
        specifier: 12.10.0
        version: 12.10.0

packages:
  drizzle-orm@0.45.2:
    peerDependencies:
      better-sqlite3: '>=7'
  better-sqlite3@12.10.0: {}
`

  assert.deepEqual(auditPgliteCutoverFiles(new Map([['pnpm-lock.yaml', lockfile]])), [
    'pnpm-lock.yaml: resolved package better-sqlite3 is forbidden',
  ])
})
