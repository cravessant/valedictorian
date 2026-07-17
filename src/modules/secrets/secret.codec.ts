export interface SecretCodec {
  decrypt: (value: string) => string
  encrypt: (value: string) => string
}
