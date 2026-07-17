import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileDatabase, migrateDatabase } from '../../db/sqlite'
import {
  computeProfileMigrationBackupSha256,
  createVerifiedProfileMigrationBackup,
  profileMigrationBackupFileName,
  verifyProfileMigrationBackup,
} from './profile.migration.backup'

describe('profile migration backup publication', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    for (const cleanupPath of cleanupPaths.splice(0)) {
      fs.rmSync(cleanupPath, { force: true, recursive: true })
    }
  })

  it('cleans only its temporary backup after interruption and retries atomically past stale temps', () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-backup-publication-'))
    cleanupPaths.push(rootPath)
    const migrationDirectory = path.join(rootPath, 'profile-migration')
    fs.mkdirSync(migrationDirectory, { recursive: true })
    const staleTempName = `.${profileMigrationBackupFileName}.interrupted.tmp`
    fs.writeFileSync(path.join(migrationDirectory, staleTempName), 'incomplete')
    const database = createFileDatabase(path.join(rootPath, 'workspace.sqlite'))
    migrateDatabase(database)

    expect(() => createVerifiedProfileMigrationBackup({
      beforePublish() {
        throw new Error('synthetic interruption')
      },
      database,
      migrationDirectory,
    })).toThrow('synthetic interruption')
    expect(fs.existsSync(path.join(migrationDirectory, profileMigrationBackupFileName))).toBe(false)
    expect(fs.readdirSync(migrationDirectory)).toEqual([staleTempName])

    const backupPath = createVerifiedProfileMigrationBackup({ database, migrationDirectory })
    expect(backupPath).toBe(path.join(migrationDirectory, profileMigrationBackupFileName))
    expect(() => verifyProfileMigrationBackup(backupPath)).not.toThrow()
    expect(fs.existsSync(path.join(migrationDirectory, staleTempName))).toBe(true)
    database.close()
  })

  it('never overwrites an existing verified final backup', () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-backup-immutable-'))
    cleanupPaths.push(rootPath)
    const migrationDirectory = path.join(rootPath, 'profile-migration')
    const database = createFileDatabase(path.join(rootPath, 'workspace.sqlite'))
    migrateDatabase(database)
    const backupPath = createVerifiedProfileMigrationBackup({ database, migrationDirectory })
    const originalChecksum = computeProfileMigrationBackupSha256(backupPath)
    database.prepare(`
      insert into user_profile (id, full_name, created_at, updated_at)
      values ('default', 'Later Source', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run()

    expect(createVerifiedProfileMigrationBackup({ database, migrationDirectory })).toBe(backupPath)
    expect(computeProfileMigrationBackupSha256(backupPath)).toBe(originalChecksum)
    database.close()
  })
})
