import {
  profileDocumentErrorBodies,
  profileDocumentErrorStatusByCode,
  type ProfileDocumentErrorBody,
  type ProfileDocumentErrorCode,
} from 'sparxie'

export class ProfileCapabilityError extends Error {
  readonly body: ProfileDocumentErrorBody
  readonly code: ProfileDocumentErrorCode
  readonly statusCode: number

  constructor(body: ProfileDocumentErrorBody) {
    super(body.message)
    this.name = 'ProfileCapabilityError'
    this.body = body
    this.code = body.code
    this.statusCode = profileDocumentErrorStatusByCode[body.code]
  }
}

export function profileDocumentError(
  code: Exclude<ProfileDocumentErrorCode, 'invalid_profile_document'>,
): ProfileCapabilityError {
  return new ProfileCapabilityError(profileDocumentErrorBodies[code])
}

export function invalidProfileDocumentError(
  path: ReadonlyArray<string | number>,
  location?: { line?: number; column?: number },
): ProfileCapabilityError {
  return new ProfileCapabilityError({
    code: 'invalid_profile_document',
    message: profileDocumentErrorBodies.invalid_profile_document.message,
    path,
    ...(location?.line === undefined ? {} : { line: location.line }),
    ...(location?.column === undefined ? {} : { column: location.column }),
  })
}

export function issuePath(
  path: readonly PropertyKey[] | undefined,
): ReadonlyArray<string | number> {
  return (path ?? ['profile']).flatMap((segment) =>
    typeof segment === 'string' || typeof segment === 'number' ? [segment] : [],
  )
}
