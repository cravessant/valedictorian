import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import type { LegacySqliteDatabase } from './profile.legacy-sqlite'

export const profileMigrationBackupFileName = 'legacy-profile-source-v1.sqlite'

export function createVerifiedProfileMigrationBackup(options: {
  beforePublish?: () => void
  database: LegacySqliteDatabase
  migrationDirectory: string
}): string {
  const backupPath = path.join(options.migrationDirectory, profileMigrationBackupFileName)
  fs.mkdirSync(options.migrationDirectory, { recursive: true })

  if (fs.existsSync(backupPath)) {
    verifyProfileMigrationBackup(backupPath)
    return backupPath
  }

  const temporaryPath = path.join(
    options.migrationDirectory,
    `.${profileMigrationBackupFileName}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    options.database.prepare('vacuum into ?').run(temporaryPath)
    verifyProfileMigrationBackup(temporaryPath)
    options.beforePublish?.()
    try {
      fs.linkSync(temporaryPath, backupPath)
      fsyncDirectory(options.migrationDirectory)
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error
    }
    verifyProfileMigrationBackup(backupPath)
    return backupPath
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
}

export function verifyProfileMigrationBackup(backupPath: string): void {
  const backup = new Database(backupPath, { fileMustExist: true, readonly: true })
  try {
    const integrity = backup.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error('Profile migration backup integrity check failed')
    for (const tableName of [
      'user_profile',
      'profile_education',
      'profile_answers',
      'profile_sensitive_details',
    ]) {
      const row = backup.prepare(
        "select 1 as present from sqlite_master where type = 'table' and name = ?",
      ).get(tableName)
      if (!row) throw new Error('Profile migration backup is incomplete')
    }
  } finally {
    backup.close()
  }
}

export function computeProfileMigrationBackupSha256(backupPath: string): string {
  const hash = createHash('sha256')
  const file = fs.openSync(backupPath, 'r')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    let bytesRead = 0
    do {
      bytesRead = fs.readSync(file, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(file)
  }
  return hash.digest('hex')
}

export function profileMigrationBackupHasIdentityMaterial(backupPath: string): boolean {
  const backup = new Database(backupPath, { fileMustExist: true, readonly: true })
  try {
    const row = backup.prepare(`
      select exists(
        select 1 from profile_sensitive_details
        where deleted_at is null and ssn_last_4_encrypted is not null
      ) as present
    `).get() as { present: number }
    return row.present === 1
  } finally {
    backup.close()
  }
}

function fsyncDirectory(directoryPath: string) {
  const directory = fs.openSync(directoryPath, 'r')
  try {
    fs.fsyncSync(directory)
  } finally {
    fs.closeSync(directory)
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'EEXIST',
  )
}
