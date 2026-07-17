import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFileAppSecretStore } from './app-secret.store'
import { createApplicationSecretScope } from '../modules/secrets/secret.scope'
import {
  defaultAtomicDocumentFileOperations,
  type AtomicDocumentFileOperations,
} from './atomic-document'

const testCodec = {
  decrypt: (value: string) => Buffer.from(value.replace(/^encrypted:/, ''), 'base64').toString(),
  encrypt: (value: string) => `encrypted:${Buffer.from(value).toString('base64')}`,
}

const TOKEN_CANARY = 'canary-secret-store-token-4e2a'

function createTempSecretsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-secrets-')), 'secrets.json')
}

function createRecordingFileOps(events: string[]): AtomicDocumentFileOperations {
  return {
    chmodSync(filePath, mode) {
      events.push('chmod')
      defaultAtomicDocumentFileOperations.chmodSync(filePath, mode)
    },
    closeSync(fd) {
      events.push('close:file')
      defaultAtomicDocumentFileOperations.closeSync(fd)
    },
    fsyncDirectory(directoryPath) {
      events.push('fsyncDirectory')
      defaultAtomicDocumentFileOperations.fsyncDirectory(directoryPath)
    },
    fsyncSync(fd) {
      events.push('fsync:file')
      defaultAtomicDocumentFileOperations.fsyncSync(fd)
    },
    mkdirSync(directoryPath, options) {
      events.push('mkdir')
      defaultAtomicDocumentFileOperations.mkdirSync(directoryPath, options)
    },
    openSync(filePath, flags, mode) {
      events.push(`open:${flags}`)
      return defaultAtomicDocumentFileOperations.openSync(filePath, flags, mode)
    },
    renameSync(from, to) {
      events.push('rename')
      defaultAtomicDocumentFileOperations.renameSync(from, to)
    },
    unlinkSync(filePath) {
      events.push('unlink')
      defaultAtomicDocumentFileOperations.unlinkSync(filePath)
    },
    writeSync(fd, data, offset, length) {
      events.push('write')
      return defaultAtomicDocumentFileOperations.writeSync(fd, data, offset, length)
    },
  }
}

describe('file app secret store', () => {
  it('persists encrypted values and resolves them by opaque reference', async () => {
    const secretsPath = createTempSecretsPath()
    const store = createFileAppSecretStore(secretsPath, testCodec, createApplicationSecretScope())

    await store.set('app-secret:api-token', 'top-secret-token')

    expect(fs.readFileSync(secretsPath, 'utf8')).not.toContain('top-secret-token')
    await expect(store.get('app-secret:api-token')).resolves.toBe('top-secret-token')
    expect(fs.statSync(secretsPath).mode & 0o777).toBe(0o600)
  })

  it('deletes only the selected secret', async () => {
    const store = createFileAppSecretStore(createTempSecretsPath(), testCodec, createApplicationSecretScope())
    await store.set('first', 'one')
    await store.set('second', 'two')

    await store.delete('first')

    await expect(store.get('first')).resolves.toBeNull()
    await expect(store.get('second')).resolves.toBe('two')
  })

  it('fails closed when the encrypted store document is invalid', async () => {
    const secretsPath = createTempSecretsPath()
    fs.writeFileSync(secretsPath, '{"version":2,"secrets":{}}', 'utf8')

    await expect(createFileAppSecretStore(secretsPath, testCodec, createApplicationSecretScope()).get('token'))
      .rejects.toThrow('App secret store is invalid')
  })

  it('reports encrypted presence without decrypting ciphertext', async () => {
    const secretsPath = createTempSecretsPath()
    const decryptCalls: string[] = []
    const codec = {
      decrypt(value: string) {
        decryptCalls.push(value)
        return testCodec.decrypt(value)
      },
      encrypt: testCodec.encrypt,
    }
    const store = createFileAppSecretStore(secretsPath, codec, createApplicationSecretScope())

    await expect(store.has('app-secret:api-token')).resolves.toBe(false)
    await store.set('app-secret:api-token', 'top-secret-token')
    await expect(store.has('app-secret:api-token')).resolves.toBe(true)
    expect(decryptCalls).toEqual([])
  })

  it('does not resolve set until ciphertext is write-all fsynced, renamed, and directory-fsynced', async () => {
    const secretsPath = createTempSecretsPath()
    const events: string[] = []
    const store = createFileAppSecretStore(
      secretsPath,
      testCodec,
      createApplicationSecretScope(),
      { fileOps: createRecordingFileOps(events) },
    )

    await store.set('app-secret:api-token', TOKEN_CANARY)

    expect(events.indexOf('open:wx')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('write')).toBeGreaterThan(events.indexOf('open:wx'))
    expect(events.indexOf('fsync:file')).toBeGreaterThan(events.indexOf('write'))
    expect(events.indexOf('close:file')).toBeGreaterThan(events.indexOf('fsync:file'))
    expect(events.indexOf('rename')).toBeGreaterThan(events.indexOf('close:file'))
    expect(events.indexOf('fsyncDirectory')).toBeGreaterThan(events.indexOf('rename'))
    await expect(store.get('app-secret:api-token')).resolves.toBe(TOKEN_CANARY)
    expect(fs.readFileSync(secretsPath, 'utf8')).not.toContain(TOKEN_CANARY)
  })

  it('preserves the prior secret document when a durable set fails before rename', async () => {
    const secretsPath = createTempSecretsPath()
    const store = createFileAppSecretStore(secretsPath, testCodec, createApplicationSecretScope())
    await store.set('app-secret:api-token', 'prior-token')
    const prior = fs.readFileSync(secretsPath, 'utf8')

    const failingStore = createFileAppSecretStore(
      secretsPath,
      testCodec,
      createApplicationSecretScope(),
      {
        fileOps: {
          ...defaultAtomicDocumentFileOperations,
          fsyncSync() {
            throw Object.assign(new Error('fsync failed'), { code: 'EIO' })
          },
        },
      },
    )

    await expect(failingStore.set('app-secret:api-token', TOKEN_CANARY)).rejects.toThrow(/fsync failed/i)
    expect(fs.readFileSync(secretsPath, 'utf8')).toBe(prior)
    expect(fs.readdirSync(path.dirname(secretsPath)).filter((entry) => entry.includes('.tmp'))).toEqual([])
  })
})
