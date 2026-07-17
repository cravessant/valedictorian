export interface SecretCodec {
  decrypt: (value: string) => string
  encrypt: (value: string) => string
  /** Optional compatibility hook for capability advertisement. */
  isAvailable?: () => boolean
}

export function isSecretCodecAvailable(codec: Pick<SecretCodec, 'isAvailable'> | null | undefined) {
  return codec?.isAvailable?.() === true
}
