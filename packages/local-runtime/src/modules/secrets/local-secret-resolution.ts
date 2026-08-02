import {
  localSecretResolutionErrorBodies,
  localSecretResolutionErrorCodes,
  localSecretResolutionErrorStatusByCode,
  localSecretResolutionInputSchema,
  parseSecretReferenceUri,
  type LocalSecretResolutionErrorBody,
  type LocalSecretResolutionErrorCode,
  type LocalSecretResolutionInput,
  type LocalSecretResolutionResult,
} from '@sparxie/sdk'
import type { SecretValue } from './secret.store.js'

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

/** Nominal marker for schema-invalid resolution input; public body is fixed and value-free. */
export class LocalSecretResolutionInvalidRequestError extends Error {
  readonly body = { message: 'Invalid local secret resolution request' } as const
  readonly statusCode = 400

  constructor() {
    super('Invalid local secret resolution request')
    this.name = 'LocalSecretResolutionInvalidRequestError'
  }
}

export function toLocalSecretResolutionHttpFailure(error: unknown): {
  statusCode: number
  body: LocalSecretResolutionErrorBody | { message: string }
} {
  const sharedCode = readRecognizedSharedCode(error)
  if (sharedCode) {
    return {
      statusCode: localSecretResolutionErrorStatusByCode[sharedCode],
      body: localSecretResolutionErrorBodies[sharedCode],
    }
  }

  if (error instanceof LocalSecretResolutionInvalidRequestError) {
    return {
      statusCode: 400,
      body: { message: 'Invalid local secret resolution request' },
    }
  }

  return {
    statusCode: 500,
    body: { message: 'Local secret resolution failed' },
  }
}

export interface LocalSecretResolutionPolicy {
  enabled: boolean
  isSecureStorageAvailable: () => boolean
}

export interface LocalSecretResolutionService {
  resolve(input: unknown): Promise<LocalSecretResolutionResult>
}

export function createLocalSecretResolutionService({
  policy,
  resolveSecret,
}: {
  policy: LocalSecretResolutionPolicy
  resolveSecret: (key: string) => Promise<SecretValue | null>
}): LocalSecretResolutionService {
  return {
    async resolve(input) {
      if (!policy.enabled) {
        throw new LocalSecretResolutionCapabilityError('local_secret_resolution_unsupported')
      }

      if (!policy.isSecureStorageAvailable()) {
        throw new LocalSecretResolutionCapabilityError('secure_storage_unavailable')
      }

      let parsed: LocalSecretResolutionInput
      try {
        parsed = localSecretResolutionInputSchema.parse(input)
      } catch {
        throw new LocalSecretResolutionInvalidRequestError()
      }

      const key = parseSecretReferenceUri(parsed.reference.$valedictorianRef)

      let secret: SecretValue | null
      try {
        secret = await resolveSecret(key)
      } catch (error) {
        if (isSecureStorageUnavailableError(error)) {
          throw new LocalSecretResolutionCapabilityError('secure_storage_unavailable')
        }
        throw createValueFreeFailure('Local secret resolution failed')
      }

      if (!secret) {
        throw new LocalSecretResolutionCapabilityError('secret_not_found')
      }

      return {
        value: secret.value,
        handling: {
          cache: 'no-store',
          sensitivity: 'secret',
        },
      }
    },
  }
}

export async function rejectUnsupportedLocalSecretResolution(
  _input: LocalSecretResolutionInput,
): Promise<LocalSecretResolutionResult> {
  throw new LocalSecretResolutionCapabilityError('local_secret_resolution_unsupported')
}

export function createValueFreeFailure(message: string, statusCode = 500) {
  return Object.assign(new Error(message), {
    statusCode,
    body: { message },
  })
}

function readRecognizedSharedCode(error: unknown): LocalSecretResolutionErrorCode | null {
  if (error instanceof LocalSecretResolutionCapabilityError) {
    return error.code
  }

  if (
    error
    && typeof error === 'object'
    && 'body' in error
    && error.body
    && typeof error.body === 'object'
    && 'code' in error.body
    && typeof (error.body as { code?: unknown }).code === 'string'
    && (localSecretResolutionErrorCodes as readonly string[]).includes(
      (error.body as { code: string }).code,
    )
  ) {
    return (error.body as { code: LocalSecretResolutionErrorCode }).code
  }

  return null
}

function isSecureStorageUnavailableError(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'secure_storage_unavailable',
  )
}
