import { describe, expect, it } from 'vitest'
import {
  createDrizzleDatabase,
  createInMemoryDatabase,
  migrateDatabase,
} from '../../db/sqlite'
import type { SecretCodec } from './secret.codec'
import { createWorkspaceSecretScope } from './secret.scope'
import { defineSecretStoreContract } from './secret.store.contract'
import type { NormalizedSecretKey, ValidatedUpsertSecretInput } from './secret.store'
import { createSqliteSecretStore } from './secret.sqlite.store'

const testWorkspaceScope = createWorkspaceSecretScope('test-workspace')

const testCodec: SecretCodec = {
  decrypt(value) {
    return value.replace(/^enc:/, '')
  },
  encrypt(value) {
    if (value === 'trigger-unavailable') {
      throw Object.assign(new Error('Secure storage is unavailable'), {
        code: 'secure_storage_unavailable',
      })
    }
    return `enc:${value}`
  },
}

defineSecretStoreContract(() => {
  const sqlite = createInMemoryDatabase()
  migrateDatabase(sqlite)
  const database = createDrizzleDatabase(sqlite)
  const store = createSqliteSecretStore(database, testCodec, testWorkspaceScope)

  return {
    store,
    async seedCipherFailure() {
      await expect(
        store.upsert({
          key: 'broken' as NormalizedSecretKey,
          kind: 'token',
          label: 'Broken',
          value: 'trigger-unavailable',
        }),
      ).rejects.toMatchObject({ code: 'secure_storage_unavailable' })
    },
  }
})

describe('SQLite SecretStore adapter', () => {
  it('keeps ciphertext out of summaries', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const store = createSqliteSecretStore(createDrizzleDatabase(sqlite), testCodec, testWorkspaceScope)

    const summary = await store.upsert({
      key: 'password' as NormalizedSecretKey,
      kind: 'password',
      label: 'Password',
      value: 'secret',
    })

    expect(JSON.stringify(summary)).not.toContain('secret')
    expect(JSON.stringify(summary)).not.toContain('enc:')
  })

  it('persists noncanonical values when cast across the validated boundary (no adapter normalization)', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const store = createSqliteSecretStore(createDrizzleDatabase(sqlite), testCodec, testWorkspaceScope)

    // Hostile escape hatch: prove the adapter does not normalize; do not bless this as valid input.
    const noncanonical = {
      key: ' Greenhouse Password ',
      kind: 'password',
      label: ' Greenhouse password ',
      value: 'secret',
    } as unknown as ValidatedUpsertSecretInput

    const summary = await store.upsert(noncanonical)
    expect(summary).toMatchObject({
      key: ' Greenhouse Password ',
      kind: 'password',
      label: ' Greenhouse password ',
    })
    await expect(
      store.resolve(' Greenhouse Password ' as NormalizedSecretKey),
    ).resolves.toMatchObject({
      key: ' Greenhouse Password ',
      label: ' Greenhouse password ',
      value: 'secret',
    })
    await expect(
      store.resolve('greenhouse_password' as NormalizedSecretKey),
    ).resolves.toBeNull()
  })
})
