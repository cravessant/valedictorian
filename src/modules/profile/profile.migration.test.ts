import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultUserProfile, profileDocumentSchemaVersion } from 'sparxie'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
} from '../../db/pglite'
import { resolveWorkspaceLayout } from '../../workspace/workspace.paths'
import { createPgliteSecretService } from '../secrets/secret.composition'
import type { SecretCodec } from '../secrets/secret.codec'
import { identitySsnLast4SecretKey } from '../secrets/secret.identity'
import { createWorkspaceSecretScope } from '../secrets/secret.scope'
import type { SecretService } from '../secrets/secret.service'
import {
  createFileLegacyProfileSqliteDatabase,
  resolveLegacyProfileSqlitePath,
} from './profile.legacy-sqlite.fixture'
import type { LegacySqliteDatabase } from './profile.legacy-sqlite'
import {
  parseProfileJsonDocument,
  serializeProfileJsonDocument,
} from './profile.json.document'
import { computeProfileRevision } from './profile.revision'
import {
  migrateLegacyProfileToJson,
  profileMigrationMarkerFileName,
} from './profile.migration'

const syntheticCodec: SecretCodec = {
  decrypt: (value) => value.slice('fixture:'.length),
  encrypt: (value) => `fixture:${value}`,
  isAvailable: () => true,
}

interface LegacyMigrationFixture {
  codec: SecretCodec
  layout: ReturnType<typeof resolveWorkspaceLayout>
  legacySqlitePath: string
  pgliteClient: PgliteClient
  secretService: SecretService
  sqlite: LegacySqliteDatabase
  cleanup: () => Promise<void>
}

describe('profile JSON migration', () => {
  const cleanupPaths: string[] = []
  const openFixtures: LegacyMigrationFixture[] = []

  afterEach(async () => {
    for (const fixture of openFixtures.splice(0)) {
      await fixture.cleanup()
    }
    for (const cleanupPath of cleanupPaths.splice(0)) {
      fs.rmSync(cleanupPath, { force: true, recursive: true })
    }
  })

  it('backs up, verifies, marks, and cleans up only after separating identity material', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    const result = await migrateLegacyProfileToJson({
      database: fixture.sqlite,
      now: () => new Date('2026-07-17T18:00:00.000Z'),
      profilePath: fixture.layout.profilePath,
      secretCodec: syntheticCodec,
      secretService: fixture.secretService,
      databasePath: fixture.legacySqlitePath,
    })

    expect(result.status).toBe('migrated')
    const documentText = fs.readFileSync(fixture.layout.profilePath, 'utf8')
    const document = parseProfileJsonDocument(documentText, fixture.layout.profilePath).document
    expect(document.profile).toMatchObject({
      dateOfBirth: '1990-02-03',
      email: 'ada@example.test',
      fullName: 'Ada Example',
      gender: 'Woman',
    })
    expect(documentText.toLowerCase()).not.toContain('ssn')
    expect(await fixture.secretService.resolve(identitySsnLast4SecretKey)).toMatchObject({
      kind: 'identity',
      value: '0000',
    })

    const migrationDirectory = path.join(fixture.layout.dataPath, 'profile-migration')
    const markerText = fs.readFileSync(path.join(migrationDirectory, profileMigrationMarkerFileName), 'utf8')
    const marker = JSON.parse(markerText) as Record<string, unknown>
    expect(marker).toEqual({
      backup: expect.stringMatching(/\.sqlite$/),
      backupSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      completedAt: '2026-07-17T18:00:00.000Z',
      destinationRevision: document.revision,
      destinationSchemaVersion: 1,
      identityMaterialPresent: true,
      migration: 'profile-json-v1',
      version: 1,
    })
    expect(markerText).not.toContain('Ada Example')

    const backupPath = path.join(migrationDirectory, marker.backup as string)
    const backup = new Database(backupPath, { readonly: true })
    expect(backup.prepare('select count(*) as count from user_profile').get()).toEqual({ count: 1 })
    backup.close()

    const activeTables = fixture.sqlite.prepare(`
      select name from sqlite_master where type = 'table' order by name
    `).all().map((row) => (row as { name: string }).name)
    expect(activeTables).not.toContain('user_profile')
    expect(activeTables).not.toContain('profile_education')
    expect(activeTables).not.toContain('profile_answers')
    expect(activeTables).not.toContain('profile_sensitive_details')
    expect(activeTables).not.toContain('profile_secrets')

    await expect(migrateLegacyProfileToJson({
      database: fixture.sqlite,
      now: () => new Date('2026-07-18T18:00:00.000Z'),
      profilePath: fixture.layout.profilePath,
      secretCodec: syntheticCodec,
      secretService: fixture.secretService,
      databasePath: fixture.legacySqlitePath,
    })).resolves.toMatchObject({ status: 'already_completed' })
  })

  it('preserves the source and invalid destination without creating backup, identity, or marker', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    fs.writeFileSync(fixture.layout.profilePath, '{ invalid', 'utf8')
    const original = fs.readFileSync(fixture.layout.profilePath, 'utf8')

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_destination_invalid',
      retryable: false,
    })

    expect(fs.readFileSync(fixture.layout.profilePath, 'utf8')).toBe(original)
    expect(tableExists(fixture.sqlite, 'user_profile')).toBe(true)
    expect(await fixture.secretService.resolve(identitySsnLast4SecretKey)).toBeNull()
    expect(fs.existsSync(path.join(fixture.layout.dataPath, 'profile-migration'))).toBe(false)
  })

  it('rejects a divergent valid destination before backup or canonical mutation', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    const divergentProfile = { ...defaultUserProfile, email: 'different@example.test' }
    fs.writeFileSync(fixture.layout.profilePath, serializeProfileJsonDocument({
      profile: divergentProfile,
      revision: computeProfileRevision(divergentProfile),
      schemaVersion: profileDocumentSchemaVersion,
    }))

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_destination_conflict',
      retryable: false,
    })

    expect(tableExists(fixture.sqlite, 'profile_sensitive_details')).toBe(true)
    expect(await fixture.secretService.resolve(identitySsnLast4SecretKey)).toBeNull()
    expect(fs.existsSync(path.join(fixture.layout.dataPath, 'profile-migration'))).toBe(false)
  })

  it('fails without mutation when protected storage is unavailable', async () => {
    const unavailableCodec: SecretCodec = {
      decrypt() {
        throw new Error('protected storage unavailable')
      },
      encrypt() {
        throw new Error('protected storage unavailable')
      },
      isAvailable: () => false,
    }
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    fixture.codec = unavailableCodec

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_secure_storage_unavailable',
      retryable: true,
    })

    expect(fs.existsSync(fixture.layout.profilePath)).toBe(false)
    expect(tableExists(fixture.sqlite, 'user_profile')).toBe(true)
    expect(fs.existsSync(path.join(fixture.layout.dataPath, 'profile-migration'))).toBe(false)
  })

  it('classifies corrupt ciphertext from an available codec as an invalid source', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    fixture.codec = {
      decrypt() {
        throw new Error('corrupt ciphertext')
      },
      encrypt: syntheticCodec.encrypt,
      isAvailable: () => true,
    }

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_source_invalid',
      retryable: false,
    })
    expect(fs.existsSync(fixture.layout.profilePath)).toBe(false)
    expect(tableExists(fixture.sqlite, 'profile_sensitive_details')).toBe(true)
  })

  it.each([
    {
      label: 'nullable profile preference',
      mutate: (database: LegacySqliteDatabase) => {
        database.prepare(`update user_profile set willing_to_relocate = 2`).run()
      },
    },
    {
      label: 'non-nullable answer inclusion flag',
      mutate: (database: LegacySqliteDatabase) => {
        database.prepare(`
          insert into profile_answers (
            key, label, question_pattern, answer, include_in_agent_context, created_at, updated_at
          ) values ('invalid', 'Invalid', 'Invalid?', 'Invalid', -1, ?, ?)
        `).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      },
    },
  ])('rejects malformed $label booleans before mutation', async ({ mutate }) => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    mutate(fixture.sqlite)

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_source_invalid',
      retryable: false,
    })
    expect(fs.existsSync(fixture.layout.profilePath)).toBe(false)
    expect(tableExists(fixture.sqlite, 'user_profile')).toBe(true)
    expect(fs.existsSync(path.join(fixture.layout.dataPath, 'profile-migration'))).toBe(false)
  })

  it('fails before mutation when verified backup capacity is insufficient', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    const migrationDirectory = path.join(fixture.layout.dataPath, 'profile-migration')
    fs.mkdirSync(migrationDirectory, { recursive: true })
    const filesystem = fs.statfsSync(migrationDirectory)
    const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize)
    // Mirror production preflight: unsafe/overflow availableBytes fail for any size;
    // otherwise the sparse probe must be just larger than reported free bytes.
    const insufficientSourceSize = Number.isSafeInteger(availableBytes)
      ? availableBytes + 1
      : 1
    const capacityProbe = path.join(fixture.layout.dataPath, 'capacity-probe.sqlite')
    fs.closeSync(fs.openSync(capacityProbe, 'w'))
    fs.truncateSync(capacityProbe, insufficientSourceSize)

    await expect(migrateLegacyProfileToJson({
      database: fixture.sqlite,
      now: () => new Date('2026-07-17T18:00:00.000Z'),
      profilePath: fixture.layout.profilePath,
      secretCodec: fixture.codec,
      secretService: fixture.secretService,
      databasePath: capacityProbe,
    })).rejects.toMatchObject({
      code: 'profile_migration_backup_unavailable',
      retryable: true,
    })
    expect(fs.existsSync(fixture.layout.profilePath)).toBe(false)
    expect(tableExists(fixture.sqlite, 'user_profile')).toBe(true)
  })

  it('requires user resolution when trusted identity storage conflicts', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    await fixture.secretService.upsertTrustedIdentitySsnLast4('1111')

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_identity_conflict',
      retryable: false,
    })

    expect(fs.existsSync(fixture.layout.profilePath)).toBe(false)
    expect(tableExists(fixture.sqlite, 'profile_sensitive_details')).toBe(true)
    expect(fs.existsSync(path.join(fixture.layout.dataPath, 'profile-migration'))).toBe(false)
  })

  it('resumes when the verified JSON and trusted identity destinations already match', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    const source = (await import('./profile.migration.source')).readLegacyProfileSource(
      fixture.sqlite,
      syntheticCodec,
    )
    fs.writeFileSync(fixture.layout.profilePath, serializeProfileJsonDocument({
      profile: source.profile,
      revision: computeProfileRevision(source.profile),
      schemaVersion: profileDocumentSchemaVersion,
    }))
    await fixture.secretService.upsertTrustedIdentitySsnLast4(source.identitySsnLast4!)

    await expect(runMigration(fixture)).resolves.toMatchObject({ status: 'migrated' })
    expect(tableExists(fixture.sqlite, 'user_profile')).toBe(false)
    expect(fs.existsSync(path.join(
      fixture.layout.dataPath,
      'profile-migration',
      profileMigrationMarkerFileName,
    ))).toBe(true)
  })

  it('rejects a completed marker when its recoverable source backup is missing', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    await runMigration(fixture)
    const migrationDirectory = path.join(fixture.layout.dataPath, 'profile-migration')
    fs.unlinkSync(path.join(migrationDirectory, 'legacy-profile-source-v1.sqlite'))

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_marker_invalid',
      retryable: false,
    })
  })

  it('rejects a stale but valid backup that does not match the current legacy source', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    const stale = await createLegacyFixture(cleanupPaths, openFixtures)
    stale.sqlite.prepare(`update user_profile set full_name = 'Stale Person'`).run()
    const migrationDirectory = path.join(fixture.layout.dataPath, 'profile-migration')
    fs.mkdirSync(migrationDirectory, { recursive: true })
    stale.sqlite.prepare('vacuum into ?').run(
      path.join(migrationDirectory, 'legacy-profile-source-v1.sqlite'),
    )

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_backup_unavailable',
      retryable: true,
    })
    expect(fs.existsSync(fixture.layout.profilePath)).toBe(false)
    expect(tableExists(fixture.sqlite, 'user_profile')).toBe(true)
  })

  it('rejects invalid legacy self-ID values as an invalid source without mutation', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    fixture.sqlite.prepare(`
      update profile_sensitive_details set gender_encrypted = 'fixture:Unsupported value'
    `).run()

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_source_invalid',
      retryable: false,
    })
    expect(fs.existsSync(fixture.layout.profilePath)).toBe(false)
    expect(tableExists(fixture.sqlite, 'profile_sensitive_details')).toBe(true)
    expect(fs.existsSync(path.join(fixture.layout.dataPath, 'profile-migration'))).toBe(false)
  })

  it('rejects a completed marker rerun when protected identity no longer exactly matches', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    await runMigration(fixture)
    await fixture.pgliteClient.query(
      `update workspace_secrets set encrypted_value = $1 where kind = 'identity'`,
      ['fixture:1111'],
    )

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_marker_invalid',
      retryable: false,
    })
  })

  it('rejects a completion marker with duplicate JSON keys', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    await runMigration(fixture)
    const markerPath = path.join(
      fixture.layout.dataPath,
      'profile-migration',
      profileMigrationMarkerFileName,
    )
    const marker = fs.readFileSync(markerPath, 'utf8')
    fs.writeFileSync(markerPath, marker.replace('"version": 1', '"version": 1,\n  "version": 1'))

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_marker_invalid',
      retryable: false,
    })
  })

  it('reports post-marker legacy cleanup failures as typed retryable outcomes', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)

    await expect(migrateLegacyProfileToJson({
      cleanupLegacyTables() {
        throw new Error('synthetic cleanup failure')
      },
      database: fixture.sqlite,
      now: () => new Date('2026-07-17T18:00:00.000Z'),
      profilePath: fixture.layout.profilePath,
      secretCodec: fixture.codec,
      secretService: fixture.secretService,
      databasePath: fixture.legacySqlitePath,
    })).rejects.toMatchObject({
      code: 'profile_migration_cleanup_failed',
      retryable: true,
    })
    expect(fs.existsSync(path.join(
      fixture.layout.dataPath,
      'profile-migration',
      profileMigrationMarkerFileName,
    ))).toBe(true)
    expect(tableExists(fixture.sqlite, 'user_profile')).toBe(true)
    await expect(runMigration(fixture)).resolves.toMatchObject({ status: 'already_completed' })
  })

  it('reruns an identity-free completed migration without protected storage', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    fixture.sqlite.prepare(`
      update profile_sensitive_details set ssn_last_4_encrypted = null
    `).run()
    await runMigration(fixture)
    const unavailableCodec: SecretCodec = {
      decrypt() {
        throw new Error('protected storage unavailable')
      },
      encrypt() {
        throw new Error('protected storage unavailable')
      },
      isAvailable: () => false,
    }

    await expect(migrateLegacyProfileToJson({
      database: fixture.sqlite,
      profilePath: fixture.layout.profilePath,
      secretCodec: unavailableCodec,
      secretService: fixture.secretService,
      databasePath: fixture.legacySqlitePath,
    })).resolves.toMatchObject({ status: 'already_completed' })
  })

  it('reports protected storage unavailability as retryable on an identity marker rerun', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    await runMigration(fixture)
    const unavailableCodec: SecretCodec = {
      decrypt() {
        throw new Error('protected storage unavailable')
      },
      encrypt() {
        throw new Error('protected storage unavailable')
      },
      isAvailable: () => false,
    }

    await expect(migrateLegacyProfileToJson({
      database: fixture.sqlite,
      profilePath: fixture.layout.profilePath,
      secretCodec: unavailableCodec,
      secretService: fixture.secretService,
      databasePath: fixture.legacySqlitePath,
    })).rejects.toMatchObject({
      code: 'profile_migration_secure_storage_unavailable',
      retryable: true,
    })
  })

  it('rejects a marker whose identity flag disagrees with raw backup material', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    await runMigration(fixture)
    const markerPath = path.join(
      fixture.layout.dataPath,
      'profile-migration',
      profileMigrationMarkerFileName,
    )
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as Record<string, unknown>
    fs.writeFileSync(markerPath, `${JSON.stringify({
      ...marker,
      identityMaterialPresent: false,
    }, null, 2)}\n`)

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_marker_invalid',
      retryable: false,
    })
  })

  it('binds the historical marker revision to the backup candidate while allowing current edits', async () => {
    const fixture = await createLegacyFixture(cleanupPaths, openFixtures)
    await runMigration(fixture)
    const current = parseProfileJsonDocument(
      fs.readFileSync(fixture.layout.profilePath, 'utf8'),
      fixture.layout.profilePath,
    ).document
    const editedProfile = { ...current.profile, email: 'post-migration-edit@example.test' }
    fs.writeFileSync(fixture.layout.profilePath, serializeProfileJsonDocument({
      profile: editedProfile,
      revision: computeProfileRevision(editedProfile),
      schemaVersion: profileDocumentSchemaVersion,
    }))
    await expect(runMigration(fixture)).resolves.toMatchObject({ status: 'already_completed' })

    const markerPath = path.join(
      fixture.layout.dataPath,
      'profile-migration',
      profileMigrationMarkerFileName,
    )
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as Record<string, unknown>
    fs.writeFileSync(markerPath, `${JSON.stringify({
      ...marker,
      destinationRevision: 'forged-unrelated-revision',
    }, null, 2)}\n`)

    await expect(runMigration(fixture)).rejects.toMatchObject({
      code: 'profile_migration_marker_invalid',
      retryable: false,
    })
  })
})

function seedLegacyProfile(database: LegacySqliteDatabase) {
  const at = '2026-01-01T00:00:00.000Z'
  database.prepare(`
    insert into user_profile (id, full_name, email, created_at, updated_at)
    values ('default', ' Ada Example ', ' ada@example.test ', ?, ?)
  `).run(at, at)
  database.prepare(`
    insert into profile_sensitive_details (
      id, date_of_birth_encrypted, gender_encrypted, ssn_last_4_encrypted,
      created_at, updated_at
    ) values ('default', ?, ?, ?, ?, ?)
  `).run(
    syntheticCodec.encrypt('1990-02-03'),
    syntheticCodec.encrypt('Woman'),
    syntheticCodec.encrypt('0000'),
    at,
    at,
  )
}

async function createLegacyFixture(
  cleanupPaths: string[],
  openFixtures: LegacyMigrationFixture[],
  codec: SecretCodec = syntheticCodec,
): Promise<LegacyMigrationFixture> {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-migration-case-'))
  cleanupPaths.push(rootPath)
  const layout = resolveWorkspaceLayout(rootPath)
  fs.mkdirSync(layout.dataPath, { recursive: true })
  fs.mkdirSync(layout.pgliteDataPath, { recursive: true })
  const legacySqlitePath = resolveLegacyProfileSqlitePath(layout.dataPath)
  const sqlite = createFileLegacyProfileSqliteDatabase(legacySqlitePath)
  seedLegacyProfile(sqlite)

  const pgliteClient = await createPgliteClient()
  const pgliteDatabase = await migratePgliteDatabase(pgliteClient)
  const secretService = createPgliteSecretService(
    pgliteDatabase,
    codec,
    createWorkspaceSecretScope('workspace-migration'),
  )

  const fixture: LegacyMigrationFixture = {
    codec,
    layout,
    legacySqlitePath,
    pgliteClient,
    secretService,
    sqlite,
    async cleanup() {
      sqlite.close()
      await pgliteClient.close()
    },
  }
  openFixtures.push(fixture)
  return fixture
}

function runMigration(fixture: LegacyMigrationFixture) {
  return migrateLegacyProfileToJson({
    database: fixture.sqlite,
    now: () => new Date('2026-07-17T18:00:00.000Z'),
    profilePath: fixture.layout.profilePath,
    secretCodec: fixture.codec,
    secretService: fixture.secretService,
    databasePath: fixture.legacySqlitePath,
  })
}

function tableExists(database: LegacySqliteDatabase, tableName: string) {
  return Boolean(database.prepare(
    "select 1 from sqlite_master where type = 'table' and name = ?",
  ).get(tableName))
}
