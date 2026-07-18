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

export interface SecretStoreContractFixture {
  store: SecretStore
  seedCipherFailure?: () => Promise<void>
  cleanup?: () => Promise<void>
}

/**
 * Adapter-neutral SecretStore contract. Factories may be sync or async so PGlite
 * can migrate and close caller-owned clients without baking dialect details here.
 */
export function defineSecretStoreContract(
  createStore: () => SecretStoreContractFixture | Promise<SecretStoreContractFixture>,
) {
  describe('SecretStore contract', () => {
    it('lists summaries without values and resolves plaintext', async () => {
      const created = await createStore()
      try {
        const { store } = created

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
      } finally {
        await created.cleanup?.()
      }
    })

    it('returns null for missing secrets and removes deleted secrets', async () => {
      const created = await createStore()
      try {
        const { store } = created

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
      } finally {
        await created.cleanup?.()
      }
    })

    it('propagates codec failures without secret values', async () => {
      const created = await createStore()
      try {
        if (!created.seedCipherFailure) {
          return
        }

        await created.seedCipherFailure()
      } finally {
        await created.cleanup?.()
      }
    })

    it('preserves opaque secret values including whitespace and empty string', async () => {
      const created = await createStore()
      try {
        const { store } = created

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
      } finally {
        await created.cleanup?.()
      }
    })
  })
}
