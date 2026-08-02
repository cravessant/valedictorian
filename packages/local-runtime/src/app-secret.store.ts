import fs from 'node:fs'
import type { ApplicationSecretScope } from './secret.scope.js'
import type { AppSecretCodec, AppSecretStore } from './app-secret.js'
import {
  defaultAtomicDocumentFileOperations,
  writeAtomicDocument,
  type AtomicDocumentFileOperations,
} from './atomic-document.js'

export type { AppSecretCodec, AppSecretStore }

export interface FileAppSecretStoreOptions {
  fileOps?: AtomicDocumentFileOperations
}

interface AppSecretDocument {
  secrets: Record<string, string>
  version: 1
}

export function createFileAppSecretStore(
  secretsPath: string,
  codec: AppSecretCodec,
  scope: ApplicationSecretScope,
  options: FileAppSecretStoreOptions = {},
): AppSecretStore {
  const fileOps = options.fileOps ?? defaultAtomicDocumentFileOperations
  return {
    scope,
    async delete(reference) {
      const document = readSecretDocument(secretsPath)

      if (!(reference in document.secrets)) {
        return
      }

      delete document.secrets[reference]
      writeSecretDocument(secretsPath, document, fileOps)
    },
    async get(reference) {
      const encryptedValue = readSecretDocument(secretsPath).secrets[reference]
      return encryptedValue === undefined ? null : codec.decrypt(encryptedValue)
    },
    async has(reference) {
      return reference in readSecretDocument(secretsPath).secrets
    },
    async set(reference, value) {
      const document = readSecretDocument(secretsPath)
      document.secrets[reference] = codec.encrypt(value)
      writeSecretDocument(secretsPath, document, fileOps)
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

function writeSecretDocument(
  secretsPath: string,
  document: AppSecretDocument,
  fileOps: AtomicDocumentFileOperations,
) {
  writeAtomicDocument(
    secretsPath,
    `${JSON.stringify(document, null, 2)}\n`,
    fileOps,
  )
}
