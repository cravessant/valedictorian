import {
  profileDocumentErrorBodies,
  profileDocumentErrorStatusByCode,
  type ProfileDocumentErrorBody,
  type ProfileDocumentErrorCode,
} from '@sparxie/sdk'

export type ProfileCapabilityErrorDetails = {
  filePath?: string
  path?: ReadonlyArray<string | number>
  line?: number
  column?: number
}

export class ProfileCapabilityError extends Error {
  readonly body: ProfileDocumentErrorBody
  readonly code: ProfileDocumentErrorCode
  readonly statusCode: number
  readonly filePath?: string
  readonly details?: ProfileCapabilityErrorDetails

  constructor(
    body: ProfileDocumentErrorBody,
    options?: { filePath?: string; details?: ProfileCapabilityErrorDetails },
  ) {
    super(body.message)
    this.name = 'ProfileCapabilityError'
    this.body = body
    this.code = body.code
    this.statusCode = profileDocumentErrorStatusByCode[body.code]
    const details = normalizeDetails(options)
    if (details) this.details = Object.freeze({ ...details })
    if (details?.filePath !== undefined) this.filePath = details.filePath
  }
}

export function profileDocumentError(
  code: Exclude<ProfileDocumentErrorCode, 'invalid_profile_document'>,
  options?: { filePath?: string; details?: ProfileCapabilityErrorDetails },
): ProfileCapabilityError {
  return new ProfileCapabilityError(profileDocumentErrorBodies[code], options)
}

export function invalidProfileDocumentError(
  path: ReadonlyArray<string | number>,
  location?: { line?: number; column?: number },
  filePath?: string,
): ProfileCapabilityError {
  return new ProfileCapabilityError(
    {
      code: 'invalid_profile_document',
      message: profileDocumentErrorBodies.invalid_profile_document.message,
      path,
      ...(location?.line === undefined ? {} : { line: location.line }),
      ...(location?.column === undefined ? {} : { column: location.column }),
    },
    filePath === undefined
      ? undefined
      : {
          filePath,
          details: {
            filePath,
            path,
            ...(location?.line === undefined ? {} : { line: location.line }),
            ...(location?.column === undefined ? {} : { column: location.column }),
          },
        },
  )
}

export function issuePath(
  path: readonly PropertyKey[] | undefined,
): ReadonlyArray<string | number> {
  return (path ?? ['profile']).flatMap((segment) =>
    typeof segment === 'string' || typeof segment === 'number' ? [segment] : [],
  )
}

function normalizeDetails(options?: {
  filePath?: string
  details?: ProfileCapabilityErrorDetails
}): ProfileCapabilityErrorDetails | undefined {
  if (!options) return undefined
  const merged: ProfileCapabilityErrorDetails = {
    ...options.details,
  }
  if (options.filePath !== undefined) merged.filePath = options.filePath
  if (
    merged.filePath === undefined &&
    merged.path === undefined &&
    merged.line === undefined &&
    merged.column === undefined
  ) {
    return undefined
  }
  return merged
}
