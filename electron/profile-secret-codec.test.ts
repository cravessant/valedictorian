import { describe, expect, it } from 'vitest'
import { createElectronSecretCodec, type ElectronSafeStorage } from './profile-secret-codec'

describe('Electron profile secret codec', () => {
  it('fails closed with a sanitized stable error when secure storage is unavailable', () => {
    const codec = createElectronSecretCodec(unavailableSafeStorage)
    const plaintext = 'test-sensitive-value'
    const legacyFallback = Buffer.from(plaintext, 'utf8').toString('base64')

    for (const operation of [() => codec.encrypt(plaintext), () => codec.decrypt(legacyFallback)]) {
      expect(operation).toThrowError(
        expect.objectContaining({
          code: 'secure_storage_unavailable',
          message: 'Secure storage is unavailable',
        }),
      )

      try {
        operation()
      } catch (error) {
        expect(String(error)).not.toContain(plaintext)
        expect(String(error)).not.toContain(legacyFallback)
      }
    }
  })

  it('adds version metadata and round-trips platform-encrypted values', () => {
    const codec = createElectronSecretCodec(availableSafeStorage)
    const encrypted = codec.encrypt('round-trip-value')

    expect(encrypted).toBe(
      `electron-safe-storage:v1:${Buffer.from('protected:round-trip-value').toString('base64')}`,
    )
    expect(codec.decrypt(encrypted)).toBe('round-trip-value')
  })

  it('decrypts legacy unprefixed values through platform safe storage', () => {
    const codec = createElectronSecretCodec(availableSafeStorage)
    const legacyCiphertext = Buffer.from('protected:legacy-value', 'utf8').toString('base64')

    expect(codec.decrypt(legacyCiphertext)).toBe('legacy-value')
  })

  it('rejects unknown ciphertext versions with a sanitized stable error', () => {
    const codec = createElectronSecretCodec(availableSafeStorage)
    const unknownVersion = `electron-safe-storage:v2:${Buffer.from('protected:value').toString('base64')}`

    expect(() => codec.decrypt(unknownVersion)).toThrowError(
      expect.objectContaining({
        code: 'secure_storage_unsupported_version',
        message: 'Secure storage ciphertext version is unsupported',
      }),
    )

    try {
      codec.decrypt(unknownVersion)
    } catch (error) {
      expect(String(error)).not.toContain(unknownVersion)
    }
  })

  it('rejects invalid ciphertext and never decodes unprefixed base64 as plaintext', () => {
    const codec = createElectronSecretCodec(availableSafeStorage)
    const rawBase64Value = 'raw-base64-value'
    const invalidValues = [
      'electron-safe-storage:v1:',
      'electron-safe-storage:v1:not-base64',
      Buffer.from(rawBase64Value, 'utf8').toString('base64'),
    ]

    for (const invalidValue of invalidValues) {
      expect(() => codec.decrypt(invalidValue)).toThrowError(
        expect.objectContaining({
          code: 'secure_storage_invalid_ciphertext',
          message: 'Secure storage ciphertext is invalid',
        }),
      )

      try {
        codec.decrypt(invalidValue)
      } catch (error) {
        expect(String(error)).not.toContain(invalidValue)
        expect(String(error)).not.toContain(rawBase64Value)
      }
    }
  })

  it('sanitizes platform encryption failures', () => {
    const plaintext = 'test-encryption-input'
    const codec = createElectronSecretCodec(failingEncryptionSafeStorage)

    expect(() => codec.encrypt(plaintext)).toThrowError(
      expect.objectContaining({
        code: 'secure_storage_encryption_failed',
        message: 'Secure storage encryption failed',
      }),
    )

    try {
      codec.encrypt(plaintext)
    } catch (error) {
      expect(String(error)).not.toContain(plaintext)
    }
  })
})

const unavailableSafeStorage: ElectronSafeStorage = {
  decryptString() {
    throw new Error('decryptString must not be called')
  },
  encryptString() {
    throw new Error('encryptString must not be called')
  },
  isEncryptionAvailable() {
    return false
  },
}

const availableSafeStorage: ElectronSafeStorage = {
  decryptString(value) {
    const protectedValue = value.toString('utf8')

    if (!protectedValue.startsWith('protected:')) {
      throw new Error(`invalid protected value: ${protectedValue}`)
    }

    return protectedValue.slice('protected:'.length)
  },
  encryptString(value) {
    return Buffer.from(`protected:${value}`, 'utf8')
  },
  isEncryptionAvailable() {
    return true
  },
}

const failingEncryptionSafeStorage: ElectronSafeStorage = {
  ...availableSafeStorage,
  encryptString(value) {
    throw new Error(`platform encryption failed for ${value}`)
  },
}
