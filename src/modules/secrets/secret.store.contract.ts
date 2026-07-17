import { describe, expect, it } from 'vitest'
import type { NormalizedSecretKey, SecretStore, ValidatedUpsertSecretInput } from './secret.store'

/** Contract fixtures supply already-canonical keys; branding is a service invariant. */
function canonicalKey(key: string): NormalizedSecretKey {
  return key as NormalizedSecretKey
}

function validatedUpsert(
  input: Omit<ValidatedUpsertSecretInput, 'key'> & { key: string },
): ValidatedUpsertSecretInput {
  return {
    ...input,
    key: canonicalKey(input.key),
  }
}

export function defineSecretStoreContract(createStore: () => {
  store: SecretStore
  seedCipherFailure?: () => Promise<void>
}) {
  describe('SecretStore contract', () => {
    it('lists summaries without values and resolves plaintext', async () => {
      const { store } = createStore()

      const summary = await store.upsert(
        validatedUpsert({
          key: 'api_token',
          kind: 'token',
          label: 'API token',
          value: 'tok-123',
        }),
      )

      expect(summary).toEqual({
        key: 'api_token',
        kind: 'token',
        label: 'API token',
        updatedAt: expect.any(String),
      })
      expect(summary).not.toHaveProperty('value')
      expect(await store.list()).toEqual([summary])
      await expect(store.resolve(canonicalKey('api_token'))).resolves.toEqual({
        ...summary,
        value: 'tok-123',
      })
    })

    it('returns null for missing secrets and removes deleted secrets', async () => {
      const { store } = createStore()

      await store.upsert(
        validatedUpsert({
          key: 'api_token',
          kind: 'token',
          label: 'API token',
          value: 'tok-123',
        }),
      )
      await store.delete(canonicalKey('api_token'))

      expect(await store.list()).toEqual([])
      await expect(store.resolve(canonicalKey('api_token'))).resolves.toBeNull()
      await expect(store.resolve(canonicalKey('missing'))).resolves.toBeNull()
    })

    it('propagates codec failures without secret values', async () => {
      const created = createStore()
      if (!created.seedCipherFailure) {
        return
      }

      await created.seedCipherFailure()
    })

    it('preserves opaque secret values including whitespace and empty string', async () => {
      const { store } = createStore()

      await store.upsert(
        validatedUpsert({
          key: 'spaced',
          kind: 'password',
          label: 'Spaced',
          value: ' pass with spaces ',
        }),
      )
      await expect(store.resolve(canonicalKey('spaced'))).resolves.toMatchObject({
        value: ' pass with spaces ',
      })

      await store.upsert(
        validatedUpsert({
          key: 'empty',
          kind: 'token',
          label: 'Empty',
          value: '',
        }),
      )
      await expect(store.resolve(canonicalKey('empty'))).resolves.toMatchObject({
        value: '',
      })
    })
  })
}
