import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  createDrizzleDatabase,
  createInMemoryDatabase,
  migrateDatabase,
} from '../../db/sqlite'
import { profileSecrets } from '../../db/schema'
import { createSqliteSecretService } from './secret.composition'
import type { SecretCodec } from './secret.codec'
import { createWorkspaceSecretScope } from './secret.scope'
import { createSecretService } from './secret.service'
import type { SecretStore } from './secret.store'

const testWorkspaceScope = createWorkspaceSecretScope('test-workspace')

const testCodec: SecretCodec = {
  decrypt(value) {
    if (value === 'bad-cipher') {
      throw Object.assign(new Error('Secure storage is unavailable'), {
        code: 'secure_storage_unavailable',
      })
    }
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

function createService() {
  const sqlite = createInMemoryDatabase()
  migrateDatabase(sqlite)
  const database = createDrizzleDatabase(sqlite)
  return {
    database,
    service: createSqliteSecretService(database, testCodec, testWorkspaceScope),
  }
}

describe('SecretService', () => {
  it('lists summaries without values after normalized upsert', async () => {
    const { database, service } = createService()

    const summary = await service.upsert({
      key: ' Greenhouse Password ',
      kind: 'password',
      label: ' Greenhouse password ',
      value: 'correct horse battery staple',
    })

    expect(summary).toEqual({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse password',
      updatedAt: expect.any(String),
    })
    expect(summary).not.toHaveProperty('value')
    expect(await service.list()).toEqual([summary])

    const row = database.select().from(profileSecrets).get()
    expect(row?.encryptedValue).toBe('enc:correct horse battery staple')
    expect(row?.key).toBe('greenhouse_password')
  })

  it('resolves plaintext immediately and returns null when missing', async () => {
    const { service } = createService()

    await service.upsert({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse password',
      value: 'correct horse battery staple',
    })

    await expect(service.resolve('greenhouse_password')).resolves.toEqual({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse password',
      updatedAt: expect.any(String),
      value: 'correct horse battery staple',
    })
    await expect(service.resolve('missing')).resolves.toBeNull()
  })

  it('deletes secrets and propagates codec failures value-free', async () => {
    const { service } = createService()

    await service.upsert({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse password',
      value: 'secret',
    })
    await service.delete('greenhouse_password')
    expect(await service.list()).toEqual([])
    await expect(service.resolve('greenhouse_password')).resolves.toBeNull()

    await expect(
      service.upsert({
        key: 'broken',
        kind: 'token',
        label: 'Broken',
        value: 'trigger-unavailable',
      }),
    ).rejects.toMatchObject({ code: 'secure_storage_unavailable' })
  })

  it('preserves secret plaintext byte-for-byte including whitespace and empty string', async () => {
    const { database, service } = createService()

    const spaced = await service.upsert({
      key: 'spaced',
      kind: 'password',
      label: 'Spaced',
      value: ' pass with spaces ',
    })
    expect(database.select().from(profileSecrets).where(eq(profileSecrets.key, 'spaced')).get()?.encryptedValue).toBe(
      'enc: pass with spaces ',
    )
    await expect(service.resolve('spaced')).resolves.toEqual({
      ...spaced,
      value: ' pass with spaces ',
    })

    const empty = await service.upsert({
      key: 'empty',
      kind: 'token',
      label: 'Empty',
      value: '',
    })
    expect(database.select().from(profileSecrets).where(eq(profileSecrets.key, 'empty')).get()?.encryptedValue).toBe(
      'enc:',
    )
    await expect(service.resolve('empty')).resolves.toEqual({
      ...empty,
      value: '',
    })
  })

  it('passes branded normalized key/kind/label and byte-exact value to the store port', async () => {
    const seen: Array<unknown> = []
    const fakeStore: SecretStore = {
      scope: testWorkspaceScope,
      async delete(key) {
        seen.push({ op: 'delete', key })
      },
      async list() {
        return []
      },
      async resolve(key) {
        seen.push({ op: 'resolve', key })
        return null
      },
      async upsert(input) {
        seen.push({ op: 'upsert', ...input })
        return {
          key: input.key,
          kind: input.kind,
          label: input.label,
          updatedAt: '2026-01-01T00:00:00.000Z',
        }
      },
    }
    const service = createSecretService(fakeStore)

    await service.upsert({
      key: ' Greenhouse Password ',
      kind: 'password',
      label: ' Greenhouse password ',
      value: ' pass with spaces ',
    })
    await service.resolve(' Greenhouse Password ')
    await service.delete(' Greenhouse Password ')

    expect(seen).toEqual([
      {
        op: 'upsert',
        key: 'greenhouse_password',
        kind: 'password',
        label: 'Greenhouse password',
        value: ' pass with spaces ',
      },
      { op: 'resolve', key: 'greenhouse_password' },
      { op: 'delete', key: 'greenhouse_password' },
    ])
  })
})
