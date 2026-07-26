import { expect, it } from 'vitest'
import { auditPgliteCutoverFiles } from './pglite-cutover-policy.mjs'

it('rejects operational SQLite dependencies, scripts, imports, paths, and migration assets', () => {
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
    ['drizzle/0001_legacy_sqlite.sql', 'PRAGMA foreign_keys = OFF;\n'],
  ]))

  expect(violations.some((value) => value.includes('package.json: dependency better-sqlite3'))).toBe(true)
  expect(violations.some((value) => value.includes('package.json: script test'))).toBe(true)
  expect(violations.some((value) => value.includes('electron-builder.json5'))).toBe(true)
  expect(violations.some((value) => value.includes('src/db/sqlite.ts: forbidden file'))).toBe(true)
  expect(violations.some((value) => value.includes('src/runtime/bridge.ts'))).toBe(true)
  expect(violations.some((value) => value.includes('VALEDICTORIAN_SQLITE_PATH'))).toBe(true)
  expect(violations.some((value) => value.includes('drizzle/0001_legacy_sqlite.sql'))).toBe(true)
})

it('forbids the legacy SQLite file name everywhere except this policy itself', () => {
  expect(auditPgliteCutoverFiles(new Map([
    ['scripts/pglite-cutover-policy.mjs', "contents.includes('valedictorian.sqlite')\n"],
    ['scripts/pglite-cutover-policy.test.mjs', "'valedictorian.sqlite'\n"],
  ]))).toEqual([])
  expect(auditPgliteCutoverFiles(new Map([
    ['UPGRADING.md', 'Open the workspace once so valedictorian.sqlite is migrated.\n'],
    ['src/runtime/legacy.ts', "const legacy = 'valedictorian.sqlite'\n"],
  ]))).toEqual([
    'UPGRADING.md: legacy SQLite file name is forbidden',
    'src/runtime/legacy.ts: legacy SQLite file name is forbidden',
  ])
})

it('accepts a PGlite-only manifest and journaled PostgreSQL migrations after the baseline', () => {
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
    ['drizzle/0001_lifecycle_corrections.sql', 'alter table applications add column opportunity_id uuid;\n'],
  ]))

  expect(violations).toEqual([])
})

it('requires the manifest PGlite version to match the packaged runtime asset contract exactly', () => {
  const violations = auditPgliteCutoverFiles(new Map([
    ['package.json', JSON.stringify({
      dependencies: { '@electric-sql/pglite': '^0.5.4' },
    })],
  ]))

  expect(violations).toEqual([
    'package.json: @electric-sql/pglite must be pinned exactly to 0.5.4',
  ])
})

it('rejects forbidden packages resolved in the lockfile while allowing optional peer metadata', () => {
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

  expect(auditPgliteCutoverFiles(new Map([['pnpm-lock.yaml', lockfile]]))).toEqual([
    'pnpm-lock.yaml: resolved package better-sqlite3 is forbidden',
  ])
})
