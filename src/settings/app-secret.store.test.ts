import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFileAppSecretStore } from './app-secret.store'

const testCodec = {
  decrypt: (value: string) => Buffer.from(value.replace(/^encrypted:/, ''), 'base64').toString(),
  encrypt: (value: string) => `encrypted:${Buffer.from(value).toString('base64')}`,
}

function createTempSecretsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-secrets-')), 'secrets.json')
}

describe('file app secret store', () => {
  it('persists encrypted values and resolves them by opaque reference', async () => {
    const secretsPath = createTempSecretsPath()
    const store = createFileAppSecretStore(secretsPath, testCodec)

    await store.set('app-secret:api-token', 'top-secret-token')

    expect(fs.readFileSync(secretsPath, 'utf8')).not.toContain('top-secret-token')
    await expect(store.get('app-secret:api-token')).resolves.toBe('top-secret-token')
    expect(fs.statSync(secretsPath).mode & 0o777).toBe(0o600)
  })

  it('deletes only the selected secret', async () => {
    const store = createFileAppSecretStore(createTempSecretsPath(), testCodec)
    await store.set('first', 'one')
    await store.set('second', 'two')

    await store.delete('first')

    await expect(store.get('first')).resolves.toBeNull()
    await expect(store.get('second')).resolves.toBe('two')
  })

  it('fails closed when the encrypted store document is invalid', async () => {
    const secretsPath = createTempSecretsPath()
    fs.writeFileSync(secretsPath, '{"version":2,"secrets":{}}', 'utf8')

    await expect(createFileAppSecretStore(secretsPath, testCodec).get('token'))
      .rejects.toThrow('App secret store is invalid')
  })
})
