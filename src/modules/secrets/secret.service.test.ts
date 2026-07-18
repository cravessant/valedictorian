import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createPgliteClient, migratePgliteDatabase } from '../../db/pglite'
import { workspaceSecrets } from '../../db/schema'
import { createPgliteSecretService } from './secret.composition'
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

async function createServiceFixture() {
  const client = await createPgliteClient()
  const database = await migratePgliteDatabase(client)
  return {
    client,
    database,
    service: createPgliteSecretService(database, testCodec, testWorkspaceScope),
    async cleanup() {
      await client.close()
    },
  }
}

describe('SecretService', () => {
  it('lists summaries without values after normalized upsert', async () => {
    const fixture = await createServiceFixture()
    const { database, service } = fixture
    try {
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

      const [row] = await database.select().from(workspaceSecrets).limit(1)
      expect(row?.encryptedValue).toBe('enc:correct horse battery staple')
      expect(row?.key).toBe('greenhouse_password')
    } finally {
      await fixture.cleanup()
    }
  })

  it('resolves plaintext immediately and returns null when missing', async () => {
    const fixture = await createServiceFixture()
    const { service } = fixture
    try {
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
    } finally {
      await fixture.cleanup()
    }
  })

  it('deletes secrets and propagates codec failures value-free', async () => {
    const fixture = await createServiceFixture()
    const { service } = fixture
    try {
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
    } finally {
      await fixture.cleanup()
    }
  })

  it('preserves secret plaintext byte-for-byte including whitespace and empty string', async () => {
    const fixture = await createServiceFixture()
    const { database, service } = fixture
    try {
      const spaced = await service.upsert({
        key: 'spaced',
        kind: 'password',
        label: 'Spaced',
        value: ' pass with spaces ',
      })
      const [spacedRow] = await database
        .select()
        .from(workspaceSecrets)
        .where(eq(workspaceSecrets.key, 'spaced'))
        .limit(1)
      expect(spacedRow?.encryptedValue).toBe('enc: pass with spaces ')
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
      const [emptyRow] = await database
        .select()
        .from(workspaceSecrets)
        .where(eq(workspaceSecrets.key, 'empty'))
        .limit(1)
      expect(emptyRow?.encryptedValue).toBe('enc:')
      await expect(service.resolve('empty')).resolves.toEqual({
        ...empty,
        value: '',
      })
    } finally {
      await fixture.cleanup()
    }
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
