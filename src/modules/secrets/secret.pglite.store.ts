import { eq } from 'drizzle-orm'
import type {
  ProfileSecretKind,
  ProfileSecretSummary,
} from 'sparxie'
import { workspaceSecrets } from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'
import type { SecretCodec } from './secret.codec'
import type { WorkspaceSecretScope } from './secret.scope'
import type { SecretStore, SecretValue, ValidatedUpsertSecretInput } from './secret.store'

export type { SecretCodec }

export function createPgliteSecretStore(
  database: PgliteDatabase,
  secretCodec: SecretCodec,
  scope: WorkspaceSecretScope,
): SecretStore {
  return {
    scope,
    async delete(key) {
      const now = new Date().toISOString()
      await database
        .update(workspaceSecrets)
        .set({
          deletedAt: now,
          updatedAt: now,
        })
        .where(eq(workspaceSecrets.key, key))
    },
    async list() {
      const rows = await database.select().from(workspaceSecrets)
      return rows.filter((row) => !row.deletedAt).map(mapSecretSummary)
    },
    async resolve(key) {
      const rows = await database
        .select()
        .from(workspaceSecrets)
        .where(eq(workspaceSecrets.key, key))
        .limit(1)
      const row = rows[0]

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
      const [row] = await database
        .insert(workspaceSecrets)
        .values({
          createdAt: now,
          deletedAt: null,
          encryptedValue,
          key: input.key,
          kind: input.kind,
          label: input.label,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: workspaceSecrets.key,
          set: {
            deletedAt: null,
            encryptedValue,
            kind: input.kind,
            label: input.label,
            updatedAt: now,
          },
        })
        .returning()

      if (!row) {
        throw new Error(`Workspace secret not found after save: ${input.key}`)
      }

      return mapSecretSummary(row)
    },
  }
}

function mapSecretSummary(row: typeof workspaceSecrets.$inferSelect): ProfileSecretSummary {
  return {
    key: row.key,
    kind: row.kind as ProfileSecretKind,
    label: row.label,
    updatedAt: row.updatedAt,
  }
}
