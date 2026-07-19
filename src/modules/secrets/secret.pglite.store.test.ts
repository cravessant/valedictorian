import { describe, expect, it } from 'vitest'
import {
  createPgliteTestOwner,
  useResettablePgliteTestOwner,
} from '../../test/pglite-test-owner'
import type { SecretCodec } from './secret.codec'
import { createWorkspaceSecretScope } from './secret.scope'
import { defineSecretStoreContract } from './secret.store.contract'
import type { NormalizedSecretKey, ValidatedUpsertSecretInput } from './secret.store'
import { createPgliteSecretStore } from './secret.pglite.store'

const testWorkspaceScope = createWorkspaceSecretScope('test-workspace')
const resettableOwner = useResettablePgliteTestOwner()

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
  const owner = resettableOwner()
  const store = createPgliteSecretStore(owner.database, testCodec, testWorkspaceScope)

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

describe.sequential('PGlite SecretStore adapter', () => {
  it('keeps ciphertext out of summaries and stores no plaintext in workspace_secrets', async () => {
    const owner = resettableOwner()
    const store = createPgliteSecretStore(owner.database, testCodec, testWorkspaceScope)
    const summary = await store.upsert({
      key: 'password' as NormalizedSecretKey,
      kind: 'password',
      label: 'Password',
      value: 'secret-plaintext',
    })

    expect(JSON.stringify(summary)).not.toContain('secret-plaintext')
    expect(JSON.stringify(summary)).not.toContain('enc:')

    const row = await owner.client.query<{ encrypted_value: string }>(
      `select encrypted_value from workspace_secrets where key = $1`,
      ['password'],
    )
    expect(row.rows).toEqual([{ encrypted_value: 'enc:secret-plaintext' }])
    expect(row.rows[0]?.encrypted_value).not.toBe('secret-plaintext')
  })

  it('soft-deletes and restores the same key on re-upsert', async () => {
    const owner = resettableOwner()
    const store = createPgliteSecretStore(owner.database, testCodec, testWorkspaceScope)
    await store.upsert({
      key: 'api_token' as NormalizedSecretKey,
      kind: 'token',
      label: 'API token',
      value: 'first',
    })
    await store.delete('api_token' as NormalizedSecretKey)

    const softDeleted = await owner.client.query<{ deleted_at: string | null; encrypted_value: string }>(
      `select deleted_at, encrypted_value from workspace_secrets where key = $1`,
      ['api_token'],
    )
    expect(softDeleted.rows[0]?.deleted_at).toEqual(expect.any(String))
    expect(await store.list()).toEqual([])
    await expect(store.resolve('api_token' as NormalizedSecretKey)).resolves.toBeNull()

    const restored = await store.upsert({
      key: 'api_token' as NormalizedSecretKey,
      kind: 'token',
      label: 'API token',
      value: 'second',
    })
    expect(restored.key).toBe('api_token')
    await expect(store.resolve('api_token' as NormalizedSecretKey)).resolves.toMatchObject({
      value: 'second',
    })

    const active = await owner.client.query<{ deleted_at: string | null; encrypted_value: string }>(
      `select deleted_at, encrypted_value from workspace_secrets where key = $1`,
      ['api_token'],
    )
    expect(active.rows[0]?.deleted_at).toBeNull()
    expect(active.rows[0]?.encrypted_value).toBe('enc:second')
  })

  it('isolates two workspace stores that share a logical key', async () => {
    const ownerA = await createPgliteTestOwner()
    const ownerB = await createPgliteTestOwner()
    try {
      const storeA = createPgliteSecretStore(
        ownerA.database,
        testCodec,
        createWorkspaceSecretScope('workspace-a'),
      )
      const storeB = createPgliteSecretStore(
        ownerB.database,
        testCodec,
        createWorkspaceSecretScope('workspace-b'),
      )

      await storeA.upsert({
        key: 'shared_key' as NormalizedSecretKey,
        kind: 'token',
        label: 'Shared',
        value: 'token-a',
      })
      await storeB.upsert({
        key: 'shared_key' as NormalizedSecretKey,
        kind: 'token',
        label: 'Shared',
        value: 'token-b',
      })

      await expect(storeA.resolve('shared_key' as NormalizedSecretKey)).resolves.toMatchObject({
        value: 'token-a',
      })
      await expect(storeB.resolve('shared_key' as NormalizedSecretKey)).resolves.toMatchObject({
        value: 'token-b',
      })
      expect(storeA.scope).not.toEqual(storeB.scope)
    } finally {
      await ownerA.close()
      await ownerB.close()
    }
  })

  it('persists noncanonical values when cast across the validated boundary (no adapter normalization)', async () => {
    const owner = resettableOwner()
    const store = createPgliteSecretStore(owner.database, testCodec, testWorkspaceScope)

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
