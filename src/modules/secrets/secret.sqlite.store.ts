import { eq } from 'drizzle-orm'
import type {
  ProfileSecretKind,
  ProfileSecretSummary,
} from 'sparxie'
import { profileSecrets } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import type { SecretCodec } from './secret.codec'
import type { WorkspaceSecretScope } from './secret.scope'
import type { SecretStore, SecretValue, ValidatedUpsertSecretInput } from './secret.store'

export type { SecretCodec }

export function createSqliteSecretStore(
  database: DrizzleDatabase,
  secretCodec: SecretCodec,
  scope: WorkspaceSecretScope,
): SecretStore {
  return {
    scope,
    async delete(key) {
      database.delete(profileSecrets).where(eq(profileSecrets.key, key)).run()
    },
    async list() {
      return database
        .select()
        .from(profileSecrets)
        .all()
        .filter((row) => !row.deletedAt)
        .map(mapSecretSummary)
    },
    async resolve(key) {
      const row = database
        .select()
        .from(profileSecrets)
        .where(eq(profileSecrets.key, key))
        .get()

      if (!row || row.deletedAt) {
        return null
      }

      return {
        ...mapSecretSummary(row),
        value: secretCodec.decrypt(row.encryptedValue),
      } satisfies SecretValue
    },
    async upsert(input: ValidatedUpsertSecretInput) {
      const now = new Date().toISOString()
      const encryptedValue = secretCodec.encrypt(input.value)
      const existing = database
        .select()
        .from(profileSecrets)
        .where(eq(profileSecrets.key, input.key))
        .get()

      if (existing) {
        database
          .update(profileSecrets)
          .set({
            deletedAt: null,
            encryptedValue,
            kind: input.kind,
            label: input.label,
            updatedAt: now,
          })
          .where(eq(profileSecrets.key, input.key))
          .run()
      } else {
        database
          .insert(profileSecrets)
          .values({
            createdAt: now,
            deletedAt: null,
            encryptedValue,
            key: input.key,
            kind: input.kind,
            label: input.label,
            updatedAt: now,
          })
          .run()
      }

      const row = database
        .select()
        .from(profileSecrets)
        .where(eq(profileSecrets.key, input.key))
        .get()
      if (!row) {
        throw new Error(`Profile secret not found after save: ${input.key}`)
      }

      return mapSecretSummary(row)
    },
  }
}

function mapSecretSummary(row: typeof profileSecrets.$inferSelect): ProfileSecretSummary {
  return {
    key: row.key,
    kind: row.kind as ProfileSecretKind,
    label: row.label,
    updatedAt: row.updatedAt,
  }
}
