import { describe, expect, it } from 'vitest'
import { rejectUnsupportedLocalSecretResolution } from './local-secret-resolution'

describe('local secret resolution capability', () => {
  it('fails closed with canonical unsupported outcome', async () => {
    await expect(
      rejectUnsupportedLocalSecretResolution({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
    ).rejects.toMatchObject({
      code: 'local_secret_resolution_unsupported',
      statusCode: 409,
      body: {
        code: 'local_secret_resolution_unsupported',
        message: 'Local secret resolution is unsupported.',
      },
    })
  })
})
