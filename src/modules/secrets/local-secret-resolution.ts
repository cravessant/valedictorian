import {
  localSecretResolutionErrorBodies,
  localSecretResolutionErrorStatusByCode,
  type LocalSecretResolutionErrorBody,
  type LocalSecretResolutionErrorCode,
  type LocalSecretResolutionInput,
  type LocalSecretResolutionResult,
} from 'sparxie'

export class LocalSecretResolutionCapabilityError extends Error {
  readonly body: LocalSecretResolutionErrorBody
  readonly code: LocalSecretResolutionErrorCode
  readonly statusCode: number

  constructor(code: LocalSecretResolutionErrorCode) {
    const body = localSecretResolutionErrorBodies[code]
    super(body.message)
    this.name = 'LocalSecretResolutionCapabilityError'
    this.body = body
    this.code = code
    this.statusCode = localSecretResolutionErrorStatusByCode[code]
  }
}

export async function rejectUnsupportedLocalSecretResolution(
  _input: LocalSecretResolutionInput,
): Promise<LocalSecretResolutionResult> {
  throw new LocalSecretResolutionCapabilityError('local_secret_resolution_unsupported')
}
