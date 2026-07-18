import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { profileDocumentSchemaVersion, type ProfileDocument } from 'sparxie'
import type { SecretCodec } from '../secrets/secret.codec'
import type { LegacySqliteDatabase } from './profile.legacy-sqlite'
import { isSecretCodecAvailable } from '../secrets/secret.codec'
import { identitySsnLast4SecretKey } from '../secrets/secret.identity'
import type { SecretService } from '../secrets/secret.service'
import {
  defaultProfileJsonFileOperations,
  readOptionalText,
  writeProfileJsonAtomically,
} from './profile.json.atomic'
import {
  parseProfileJsonDocument,
  serializeProfileJsonDocument,
} from './profile.json.document'
import { computeProfileRevision } from './profile.revision'
import {
  createVerifiedProfileMigrationBackup,
  computeProfileMigrationBackupSha256,
  profileMigrationBackupFileName,
  profileMigrationBackupHasIdentityMaterial,
  verifyProfileMigrationBackup,
} from './profile.migration.backup'
import {
  legacyProfileSourceHasEncryptedMaterial,
  readLegacyProfileSource,
} from './profile.migration.source'

export const profileMigrationMarkerFileName = 'profile-json-v1.completed.json'
const profileMigrationName = 'profile-json-v1'
const profileMigrationVersion = 1

export type ProfileMigrationErrorCode =
  | 'profile_migration_source_invalid'
  | 'profile_migration_destination_invalid'
  | 'profile_migration_destination_conflict'
  | 'profile_migration_identity_conflict'
  | 'profile_migration_secure_storage_unavailable'
  | 'profile_migration_backup_unavailable'
  | 'profile_migration_write_unavailable'
  | 'profile_migration_verification_failed'
  | 'profile_migration_cleanup_failed'
  | 'profile_migration_marker_invalid'

const errorMessages: Record<ProfileMigrationErrorCode, string> = {
  profile_migration_source_invalid: 'The legacy profile source is invalid and requires user resolution.',
  profile_migration_destination_invalid: 'The profile JSON destination is invalid and was not overwritten.',
  profile_migration_destination_conflict: 'The legacy profile and profile JSON destination conflict.',
  profile_migration_identity_conflict: 'The legacy identity value conflicts with protected identity storage.',
  profile_migration_secure_storage_unavailable: 'Protected identity storage is unavailable; profile migration can be retried.',
  profile_migration_backup_unavailable: 'A recoverable profile source backup could not be verified; profile migration can be retried.',
  profile_migration_write_unavailable: 'The profile migration destination is not writable; profile migration can be retried.',
  profile_migration_verification_failed: 'Profile migration verification failed and can be retried.',
  profile_migration_cleanup_failed: 'Profile migration completed, but legacy profile cleanup failed and can be retried.',
  profile_migration_marker_invalid: 'The profile migration completion marker is invalid and requires user resolution.',
}

const retryableCodes = new Set<ProfileMigrationErrorCode>([
  'profile_migration_secure_storage_unavailable',
  'profile_migration_backup_unavailable',
  'profile_migration_write_unavailable',
  'profile_migration_verification_failed',
  'profile_migration_cleanup_failed',
])

export class ProfileMigrationError extends Error {
  readonly code: ProfileMigrationErrorCode
  readonly retryable: boolean

  constructor(code: ProfileMigrationErrorCode) {
    super(errorMessages[code])
    this.name = 'ProfileMigrationError'
    this.code = code
    this.retryable = retryableCodes.has(code)
  }
}

interface ProfileMigrationMarker {
  backup: string
  backupSha256: string
  completedAt: string
  destinationRevision: string
  destinationSchemaVersion: number
  identityMaterialPresent: boolean
  migration: string
  version: number
}

export interface ProfileMigrationResult {
  status: 'migrated' | 'already_completed'
}

export async function migrateLegacyProfileToJson(options: {
  cleanupLegacyTables?: (database: LegacySqliteDatabase) => void
  database: LegacySqliteDatabase
  now?: () => Date
  profilePath: string
  secretCodec: SecretCodec
  secretService: Pick<SecretService, 'resolve' | 'upsertTrustedIdentitySsnLast4'>
  databasePath: string
}): Promise<ProfileMigrationResult> {
  const now = options.now ?? (() => new Date())
  const migrationDirectory = path.join(path.dirname(options.profilePath), 'profile-migration')
  const markerPath = path.join(migrationDirectory, profileMigrationMarkerFileName)
  const marker = inspectMarker(markerPath)

  if (marker) {
    await verifyCompletedMigration(marker, options)
    runLegacyProfileCleanup(options)
    return { status: 'already_completed' }
  }

  const existingDestination = inspectDestination(options.profilePath)
  let source: ReturnType<typeof readLegacyProfileSource>
  try {
    if (
      !isSecretCodecAvailable(options.secretCodec)
      && legacyProfileSourceHasEncryptedMaterial(options.database)
    ) {
      throw new ProfileMigrationError('profile_migration_secure_storage_unavailable')
    }
    source = readLegacyProfileSource(options.database, options.secretCodec)
  } catch (error) {
    if (error instanceof ProfileMigrationError) throw error
    throw new ProfileMigrationError('profile_migration_source_invalid')
  }

  const candidate: ProfileDocument = {
    profile: source.profile,
    revision: computeProfileRevision(source.profile),
    schemaVersion: profileDocumentSchemaVersion,
  }
  if (existingDestination && existingDestination.revision !== candidate.revision) {
    throw new ProfileMigrationError('profile_migration_destination_conflict')
  }

  await preflightIdentity(source.identitySsnLast4, options)
  preflightWriteability(options.profilePath, migrationDirectory)
  preflightBackupCapacity(options.databasePath, migrationDirectory)

  let backupSha256: string
  try {
    const backupPath = createVerifiedProfileMigrationBackup({
      database: options.database,
      migrationDirectory,
    })
    verifyBackupMatchesSource(backupPath, source, options.secretCodec)
    backupSha256 = computeProfileMigrationBackupSha256(backupPath)
  } catch {
    throw new ProfileMigrationError('profile_migration_backup_unavailable')
  }

  if (!existingDestination) {
    try {
      writeProfileJsonAtomically({
        contents: serializeProfileJsonDocument(candidate),
        profilePath: options.profilePath,
      })
    } catch {
      throw new ProfileMigrationError('profile_migration_write_unavailable')
    }
  }
  verifyDestination(options.profilePath, candidate)

  if (source.identitySsnLast4) {
    try {
      await options.secretService.upsertTrustedIdentitySsnLast4(source.identitySsnLast4)
      const stored = await options.secretService.resolve(identitySsnLast4SecretKey)
      if (!stored || stored.value !== source.identitySsnLast4) {
        throw new Error('identity verification mismatch')
      }
    } catch (error) {
      if (error instanceof ProfileMigrationError) throw error
      throw new ProfileMigrationError('profile_migration_verification_failed')
    }
  }

  const completedMarker: ProfileMigrationMarker = {
    backup: profileMigrationBackupFileName,
    backupSha256,
    completedAt: now().toISOString(),
    destinationRevision: candidate.revision,
    destinationSchemaVersion: candidate.schemaVersion,
    identityMaterialPresent: source.identitySsnLast4 !== null,
    migration: profileMigrationName,
    version: profileMigrationVersion,
  }
  try {
    writeProfileJsonAtomically({
      contents: `${JSON.stringify(completedMarker, null, 2)}\n`,
      profilePath: markerPath,
    })
  } catch {
    throw new ProfileMigrationError('profile_migration_write_unavailable')
  }
  const verifiedMarker = inspectMarker(markerPath)
  if (!verifiedMarker || verifiedMarker.destinationRevision !== candidate.revision) {
    throw new ProfileMigrationError('profile_migration_verification_failed')
  }

  runLegacyProfileCleanup(options)
  return { status: 'migrated' }
}

function inspectDestination(profilePath: string): ProfileDocument | null {
  let text: string | null
  try {
    text = readOptionalText(profilePath)
  } catch {
    throw new ProfileMigrationError('profile_migration_write_unavailable')
  }
  if (text === null) return null
  try {
    return parseProfileJsonDocument(text, profilePath).document
  } catch {
    throw new ProfileMigrationError('profile_migration_destination_invalid')
  }
}

function inspectMarker(markerPath: string): ProfileMigrationMarker | null {
  let text: string | null
  try {
    text = readOptionalText(markerPath)
  } catch {
    throw new ProfileMigrationError('profile_migration_marker_invalid')
  }
  if (text === null) return null

  try {
    assertNoDuplicateJsonObjectKeys(text)
    const value = JSON.parse(text) as Record<string, unknown>
    const keys = Object.keys(value).sort()
    const expectedKeys = [
      'backup',
      'backupSha256',
      'completedAt',
      'destinationRevision',
      'destinationSchemaVersion',
      'identityMaterialPresent',
      'migration',
      'version',
    ].sort()
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) throw new Error('invalid keys')
    if (value.migration !== profileMigrationName || value.version !== profileMigrationVersion) throw new Error('invalid version')
    if (value.destinationSchemaVersion !== profileDocumentSchemaVersion) throw new Error('invalid schema')
    if (typeof value.destinationRevision !== 'string' || value.destinationRevision.length === 0) throw new Error('invalid revision')
    if (typeof value.completedAt !== 'string' || !Number.isFinite(Date.parse(value.completedAt))) throw new Error('invalid completion time')
    if (typeof value.identityMaterialPresent !== 'boolean') throw new Error('invalid identity flag')
    if (value.backup !== profileMigrationBackupFileName) throw new Error('invalid backup')
    if (typeof value.backupSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.backupSha256)) throw new Error('invalid backup checksum')
    return value as unknown as ProfileMigrationMarker
  } catch {
    throw new ProfileMigrationError('profile_migration_marker_invalid')
  }
}

async function preflightIdentity(
  identitySsnLast4: string | null,
  options: {
    secretCodec: SecretCodec
    secretService: Pick<SecretService, 'resolve'>
  },
) {
  if (identitySsnLast4 === null) return
  if (!/^[0-9]{4}$/.test(identitySsnLast4)) {
    throw new ProfileMigrationError('profile_migration_source_invalid')
  }
  if (!isSecretCodecAvailable(options.secretCodec)) {
    throw new ProfileMigrationError('profile_migration_secure_storage_unavailable')
  }
  let existing: Awaited<ReturnType<typeof options.secretService.resolve>>
  try {
    existing = await options.secretService.resolve(identitySsnLast4SecretKey)
  } catch {
    throw new ProfileMigrationError('profile_migration_secure_storage_unavailable')
  }
  if (existing && existing.value !== identitySsnLast4) {
    throw new ProfileMigrationError('profile_migration_identity_conflict')
  }
}

function preflightWriteability(
  profilePath: string,
  migrationDirectory: string,
) {
  try {
    fs.mkdirSync(path.dirname(profilePath), { recursive: true })
    fs.mkdirSync(migrationDirectory, { recursive: true })
    fs.accessSync(path.dirname(profilePath), fs.constants.W_OK)
    fs.accessSync(migrationDirectory, fs.constants.W_OK)
  } catch {
    throw new ProfileMigrationError('profile_migration_write_unavailable')
  }
}

function preflightBackupCapacity(databasePath: string, migrationDirectory: string) {
  try {
    const sourceSize = fs.statSync(databasePath).size
    const filesystem = fs.statfsSync(migrationDirectory)
    const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize)
    if (!Number.isSafeInteger(availableBytes) || availableBytes < sourceSize) {
      throw new Error('Insufficient capacity for a recoverable profile migration backup')
    }
  } catch {
    throw new ProfileMigrationError('profile_migration_backup_unavailable')
  }
}

function assertNoDuplicateJsonObjectKeys(text: string) {
  const keys = new Set<string>()
  for (const match of text.matchAll(/"((?:\\.|[^"\\])*)"\s*:/g)) {
    const key = JSON.parse(`"${match[1]}"`) as string
    if (keys.has(key)) throw new Error('duplicate marker key')
    keys.add(key)
  }
}

function verifyDestination(profilePath: string, expected: ProfileDocument) {
  try {
    const text = defaultProfileJsonFileOperations.readFileSync(profilePath, 'utf8')
    const actual = parseProfileJsonDocument(text, profilePath).document
    if (actual.revision !== expected.revision) throw new Error('profile mismatch')
  } catch {
    throw new ProfileMigrationError('profile_migration_verification_failed')
  }
}

async function verifyCompletedMigration(
  marker: ProfileMigrationMarker,
  options: {
    profilePath: string
    secretCodec: SecretCodec
    secretService: Pick<SecretService, 'resolve'>
  },
) {
  const destination = inspectDestination(options.profilePath)
  if (!destination) {
    throw new ProfileMigrationError('profile_migration_marker_invalid')
  }
  const backupPath = path.join(path.dirname(options.profilePath), 'profile-migration', marker.backup)
  try {
    verifyProfileMigrationBackup(backupPath)
    if (computeProfileMigrationBackupSha256(backupPath) !== marker.backupSha256) {
      throw new Error('backup checksum mismatch')
    }
    if (
      profileMigrationBackupHasIdentityMaterial(backupPath)
      !== marker.identityMaterialPresent
    ) {
      throw new Error('backup identity-material flag mismatch')
    }
  } catch {
    throw new ProfileMigrationError('profile_migration_marker_invalid')
  }
  const secureStorageAvailable = isSecretCodecAvailable(options.secretCodec)
  let backupSource: ReturnType<typeof readLegacyProfileSource> | null = null
  if (secureStorageAvailable) {
    try {
      const backup = new Database(backupPath, { fileMustExist: true, readonly: true })
      try {
        backupSource = readLegacyProfileSource(backup, options.secretCodec)
      } finally {
        backup.close()
      }
    } catch {
      throw new ProfileMigrationError('profile_migration_marker_invalid')
    }
    if (computeProfileRevision(backupSource.profile) !== marker.destinationRevision) {
      throw new ProfileMigrationError('profile_migration_marker_invalid')
    }
  } else if (marker.identityMaterialPresent) {
    throw new ProfileMigrationError('profile_migration_secure_storage_unavailable')
  }
  if (marker.identityMaterialPresent) {
    let identity: Awaited<ReturnType<typeof options.secretService.resolve>>
    try {
      identity = await options.secretService.resolve(identitySsnLast4SecretKey)
    } catch {
      throw new ProfileMigrationError('profile_migration_secure_storage_unavailable')
    }
    if (!identity || identity.value !== backupSource?.identitySsnLast4) {
      throw new ProfileMigrationError('profile_migration_marker_invalid')
    }
  }
}

function verifyBackupMatchesSource(
  backupPath: string,
  expected: ReturnType<typeof readLegacyProfileSource>,
  secretCodec: SecretCodec,
) {
  const backup = new Database(backupPath, { fileMustExist: true, readonly: true })
  try {
    const actual = readLegacyProfileSource(backup, secretCodec)
    if (
      computeProfileRevision(actual.profile) !== computeProfileRevision(expected.profile)
      || actual.identitySsnLast4 !== expected.identitySsnLast4
    ) {
      throw new Error('Profile migration backup does not match the source')
    }
  } finally {
    backup.close()
  }
}

function cleanupLegacyProfileTables(database: LegacySqliteDatabase) {
  database.transaction(() => {
    database.exec(`
      drop table if exists profile_answers;
      drop table if exists profile_education;
      drop table if exists profile_sensitive_details;
      drop table if exists user_profile;
    `)
  })()
}

function runLegacyProfileCleanup(options: {
  cleanupLegacyTables?: (database: LegacySqliteDatabase) => void
  database: LegacySqliteDatabase
}) {
  try {
    (options.cleanupLegacyTables ?? cleanupLegacyProfileTables)(options.database)
  } catch {
    throw new ProfileMigrationError('profile_migration_cleanup_failed')
  }
}
