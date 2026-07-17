import type { SecretCodec } from '../src/modules/secrets/secret.codec'

const safeStoragePrefix = 'electron-safe-storage:'
const safeStorageVersionPrefix = `${safeStoragePrefix}v1:`

export interface ElectronSafeStorage {
  decryptString(value: Buffer): string
  encryptString(value: string): Buffer
  isEncryptionAvailable(): boolean
}

export type ElectronSecretCodecErrorCode =
  | 'secure_storage_encryption_failed'
  | 'secure_storage_invalid_ciphertext'
  | 'secure_storage_unavailable'
  | 'secure_storage_unsupported_version'

export class ElectronSecretCodecError extends Error {
  readonly code: ElectronSecretCodecErrorCode

  constructor(code: ElectronSecretCodecErrorCode, message: string) {
    super(message)
    this.name = 'ElectronSecretCodecError'
    this.code = code
  }
}

export function createElectronSecretCodec(safeStorage: ElectronSafeStorage): SecretCodec {
  return {
    decrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw secureStorageUnavailableError()
      }

      if (value.startsWith(safeStoragePrefix) && !value.startsWith(safeStorageVersionPrefix)) {
        throw new ElectronSecretCodecError(
          'secure_storage_unsupported_version',
          'Secure storage ciphertext version is unsupported',
        )
      }

      const ciphertext = value.startsWith(safeStorageVersionPrefix)
        ? value.slice(safeStorageVersionPrefix.length)
        : value

      const encryptedBuffer = decodeCiphertext(ciphertext)

      try {
        return safeStorage.decryptString(encryptedBuffer)
      } catch {
        throw invalidCiphertextError()
      }
    },
    encrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw secureStorageUnavailableError()
      }

      try {
        const encrypted = safeStorage.encryptString(value)

        if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
          throw new Error('Invalid safe storage result')
        }

        return `${safeStorageVersionPrefix}${encrypted.toString('base64')}`
      } catch {
        throw new ElectronSecretCodecError(
          'secure_storage_encryption_failed',
          'Secure storage encryption failed',
        )
      }
    },
  }
}

function secureStorageUnavailableError() {
  return new ElectronSecretCodecError(
    'secure_storage_unavailable',
    'Secure storage is unavailable',
  )
}

function decodeCiphertext(ciphertext: string) {
  if (!ciphertext || ciphertext.length % 4 !== 0 || !base64Pattern.test(ciphertext)) {
    throw invalidCiphertextError()
  }

  const decoded = Buffer.from(ciphertext, 'base64')

  if (decoded.toString('base64') !== ciphertext) {
    throw invalidCiphertextError()
  }

  return decoded
}

function invalidCiphertextError() {
  return new ElectronSecretCodecError(
    'secure_storage_invalid_ciphertext',
    'Secure storage ciphertext is invalid',
  )
}

const base64Pattern = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/
