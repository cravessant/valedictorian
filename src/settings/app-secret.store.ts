import fs from 'node:fs'
import path from 'node:path'

export interface AppSecretCodec {
  decrypt: (value: string) => string
  encrypt: (value: string) => string
}

export interface AppSecretStore {
  delete: (reference: string) => Promise<void>
  get: (reference: string) => Promise<string | null>
  set: (reference: string, value: string) => Promise<void>
}

interface AppSecretDocument {
  secrets: Record<string, string>
  version: 1
}

export function createFileAppSecretStore(
  secretsPath: string,
  codec: AppSecretCodec,
): AppSecretStore {
  return {
    async delete(reference) {
      const document = readSecretDocument(secretsPath)

      if (!(reference in document.secrets)) {
        return
      }

      delete document.secrets[reference]
      writeSecretDocument(secretsPath, document)
    },
    async get(reference) {
      const encryptedValue = readSecretDocument(secretsPath).secrets[reference]
      return encryptedValue === undefined ? null : codec.decrypt(encryptedValue)
    },
    async set(reference, value) {
      const document = readSecretDocument(secretsPath)
      document.secrets[reference] = codec.encrypt(value)
      writeSecretDocument(secretsPath, document)
    },
  }
}

function readSecretDocument(secretsPath: string): AppSecretDocument {
  if (!fs.existsSync(secretsPath)) {
    return { secrets: {}, version: 1 }
  }

  const value = JSON.parse(fs.readFileSync(secretsPath, 'utf8')) as unknown

  if (!isSecretDocument(value)) {
    throw new Error('App secret store is invalid')
  }

  return { secrets: { ...value.secrets }, version: 1 }
}

function isSecretDocument(value: unknown): value is AppSecretDocument {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return candidate.version === 1
    && Boolean(candidate.secrets)
    && typeof candidate.secrets === 'object'
    && Object.values(candidate.secrets as Record<string, unknown>)
      .every((secret) => typeof secret === 'string')
}

function writeSecretDocument(secretsPath: string, document: AppSecretDocument) {
  fs.mkdirSync(path.dirname(secretsPath), { recursive: true })
  const temporaryPath = `${secretsPath}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  fs.renameSync(temporaryPath, secretsPath)
  fs.chmodSync(secretsPath, 0o600)
}
