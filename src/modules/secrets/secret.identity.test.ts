import { describe, expect, it } from 'vitest'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { createPgliteSecretService } from '@sparxie/valedictorian-local-runtime/testing/modules/secrets/secret.composition'
import {
  createWorkspaceSecretScope,
  type SecretCodec,
} from '@sparxie/valedictorian-local-runtime/protected-secrets'
import {
  identitySecretKind,
  identitySsnLast4SecretKey,
  identitySsnLast4SecretReference,
  identitySsnLast4SecretReferenceUri,
} from '@sparxie/valedictorian-local-runtime/testing/modules/secrets/secret.identity'

const IDENTITY_CANARY = 'identity-ssn-canary-5125'
const resettableOwner = useResettablePgliteTestOwner()

const testCodec: SecretCodec = {
  decrypt(value) {
    return value.replace(/^enc:/, '')
  },
  encrypt(value) {
    return `enc:${value}`
  },
}

function createServiceFixture() {
  return createPgliteSecretService(
    resettableOwner().database,
    testCodec,
    createWorkspaceSecretScope('ws-identity'),
  )
}

describe.sequential('identity SSN last4 secret representation', () => {
  it('reserves the stable key, reference URI, and identity kind', () => {
    expect(identitySsnLast4SecretKey).toBe('identity_ssn_last4')
    expect(identitySsnLast4SecretReferenceUri).toBe('secret://identity_ssn_last4')
    expect(identitySsnLast4SecretReference).toEqual({
      $valedictorianRef: 'secret://identity_ssn_last4',
    })
    expect(identitySecretKind).toBe('identity')
  })

  it('blocks ordinary create, replace, and delete while trusted upsert returns no summary', async () => {
    const service = createServiceFixture()
    await expect(service.hasTrustedIdentitySsnLast4()).resolves.toBe(false)

    await service.upsert({
      key: 'jobright',
      kind: 'password',
      label: 'Jobright',
      value: 'visible-secret',
    })

    await expect(
      service.upsert({
        key: identitySsnLast4SecretKey,
        kind: identitySecretKind,
        label: 'SSN last four',
        value: IDENTITY_CANARY,
      }),
    ).rejects.toMatchObject({
      message: 'Identity secrets cannot be managed through ordinary secret administration',
    })

    await expect(
      service.upsert({
        key: identitySsnLast4SecretKey,
        kind: 'password',
        label: 'SSN last four',
        value: IDENTITY_CANARY,
      }),
    ).rejects.toMatchObject({
      message: 'Identity secrets cannot be managed through ordinary secret administration',
    })

    await expect(service.delete(identitySsnLast4SecretKey)).rejects.toMatchObject({
      message: 'Identity secrets cannot be managed through ordinary secret administration',
    })

    await expect(service.upsertTrustedIdentitySsnLast4('5125')).resolves.toBeUndefined()
    await expect(service.hasTrustedIdentitySsnLast4()).resolves.toBe(true)

    expect(await service.list()).toEqual([
      expect.objectContaining({ key: 'jobright', kind: 'password' }),
    ])
    expect(await service.listResult()).toEqual({
      items: [expect.objectContaining({ key: 'jobright', kind: 'password' })],
    })
    expect(JSON.stringify(await service.list())).not.toContain(identitySsnLast4SecretKey)
    expect(JSON.stringify(await service.list())).not.toContain(IDENTITY_CANARY)
    expect(JSON.stringify(await service.list())).not.toContain('5125')

    await expect(service.resolve(identitySsnLast4SecretKey)).resolves.toEqual({
      key: identitySsnLast4SecretKey,
      kind: 'identity',
      label: 'SSN last four',
      updatedAt: expect.any(String),
      value: '5125',
    })

    await expect(service.delete(identitySsnLast4SecretKey)).rejects.toMatchObject({
      message: 'Identity secrets cannot be managed through ordinary secret administration',
    })
    await expect(service.resolve(identitySsnLast4SecretKey)).resolves.toMatchObject({
      value: '5125',
    })
  })

  it('rejects trusted SSN last4 values that are not exactly four ASCII digits', async () => {
    const service = createServiceFixture()
    const rejected = [
      '123-45-6789',
      ' 5125',
      '5125 ',
      '51a5',
      '512',
      '51255',
      IDENTITY_CANARY,
    ]

    for (const value of rejected) {
      let caught: unknown
      await expect(service.upsertTrustedIdentitySsnLast4(value)).rejects.toThrow()
      try {
        await service.upsertTrustedIdentitySsnLast4(value)
      } catch (error) {
        caught = error
      }
      expect(caught).toMatchObject({
        message: 'Trusted identity SSN last4 must be exactly four ASCII digits',
      })
      expect(JSON.stringify(caught)).not.toContain(value)
      expect(String(caught)).not.toContain(value)
      expect(await service.resolve(identitySsnLast4SecretKey)).toBeNull()
    }

    await expect(service.upsertTrustedIdentitySsnLast4('5125')).resolves.toBeUndefined()
    await expect(service.resolve(identitySsnLast4SecretKey)).resolves.toMatchObject({
      value: '5125',
    })
  })
})
