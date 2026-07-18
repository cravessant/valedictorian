import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve('.')
const drizzleDir = path.join(repoRoot, 'drizzle')
const dbDir = path.join(repoRoot, 'src', 'db')
const profileDir = path.join(repoRoot, 'src', 'modules', 'profile')

const forbiddenOperationalMigrationAssets = [
  'src/db/data-migrations.ts',
  'src/db/sqlite.legacy-schema.ts',
  'src/db/sqlite.schema-test-helpers.ts',
  'src/db/sqlite.schema-migration.test.ts',
  'src/db/sqlite.data-migration-guards.test.ts',
  'src/db/sqlite.lifecycle-rename.test.ts',
  'src/db/sqlite.scope-owner-invariants.test.ts',
  'src/db/sqlite.scope-continuity-migration.test.ts',
  'src/db/sqlite.connector-contract-migration.test.ts',
  'src/db/sqlite.connector-schedule-migration.test.ts',
  'src/db/sqlite.earliest-backfill-migration.test.ts',
  'src/db/sqlite.installed-migration.test.ts',
  'src/db/sqlite.raw-source-lineage-migration.test.ts',
  'src/modules/profile/profile.legacy-sqlite.fixture.ts',
  'src/modules/profile/profile.legacy-sqlite.ts',
  'src/modules/profile/profile.migration.backup.test.ts',
  'src/modules/profile/profile.migration.backup.ts',
  'src/modules/profile/profile.migration.source.test.ts',
  'src/modules/profile/profile.migration.source.ts',
  'src/modules/profile/profile.migration.test.ts',
  'src/modules/profile/profile.migration.ts',
] as const

const requiredProfileUpgradePolicy = [
  'UPGRADING.md',
  'src/modules/profile/profile.upgrade-policy.test.ts',
  'src/modules/profile/profile.upgrade-policy.ts',
] as const

describe('operational migration cutover boundary', () => {
  it('keeps the PostgreSQL baseline first while allowing later journaled migrations', () => {
    const sqlMigrations = fs
      .readdirSync(drizzleDir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
    expect(sqlMigrations[0]).toBe('0000_pglite_operational_baseline.sql')

    const journal = JSON.parse(
      fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8'),
    ) as { dialect: string; entries: Array<{ tag: string }> }
    expect(journal.dialect).toBe('postgresql')
    expect(journal.entries[0]?.tag).toBe('0000_pglite_operational_baseline')
    expect(journal.entries.map((entry) => `${entry.tag}.sql`).sort()).toEqual(sqlMigrations)

    for (const relativePath of forbiddenOperationalMigrationAssets) {
      expect(fs.existsSync(path.join(repoRoot, relativePath)), relativePath).toBe(false)
    }

    const leftoverOperationalMigrationTests = fs
      .readdirSync(dbDir)
      .filter(
        (name) =>
          name.startsWith('sqlite.') &&
          (name.includes('migration') ||
            name.includes('lifecycle-rename') ||
            name.includes('scope-owner') ||
            name.includes('scope-continuity') ||
            name.includes('schema-test-helpers') ||
            name.includes('data-migration')),
      )
      .sort()
    expect(leftoverOperationalMigrationTests).toEqual([])

    for (const relativePath of requiredProfileUpgradePolicy) {
      expect(fs.existsSync(path.join(repoRoot, relativePath)), relativePath).toBe(true)
    }

    const profileEvidence = fs
      .readdirSync(profileDir)
      .filter((name) => name.startsWith('profile.migration'))
      .sort()
    expect(profileEvidence).toEqual([])
  })
})
