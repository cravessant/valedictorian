import {
  ConnectorOptionQueryHttpError,
  ConnectorRetirementConflictError,
  ConnectorScheduleHttpError,
  LocalSecretResolutionHttpError,
  ProfileDocumentHttpError,
  ValedictorianHttpError,
  ValedictorianProtocolError,
  ValedictorianTransportError,
  localSecretResolutionErrorBodySchema,
  localSecretResolutionErrorKindByCode,
  localSecretResolutionErrorStatusByCode,
  profileDocumentErrorBodySchema,
  profileDocumentErrorKindByCode,
  profileDocumentErrorStatusByCode,
  valedictorianFailureKindMessages,
  type ValedictorianFailureKind,
  type ValedictorianRetryAfter,
} from 'sparxie'

export type CliFailureExitCode = 1 | 2 | 3 | 4 | 5 | 6

export type CliFailureErrorObject = {
  readonly code: string
  readonly kind: ValedictorianFailureKind | 'usage'
  readonly status?: number
  readonly message?: string
  readonly path?: ReadonlyArray<string | number>
  readonly line?: number
  readonly column?: number
  readonly requestId?: string
  readonly retryAfter?: ValedictorianRetryAfter
}

export type ClassifiedCliFailure = {
  readonly exitCode: CliFailureExitCode
  readonly error: CliFailureErrorObject
  readonly guidance: string
}

export class CliUsageError extends Error {
  readonly kind = 'usage' as const

  constructor(message: string) {
    super(message)
    this.name = 'CliUsageError'
  }
}

export class CliOwnedFailure extends Error {
  readonly code: string
  readonly kind: ValedictorianFailureKind
  readonly status?: number

  constructor({
    code,
    kind,
    message,
    status,
  }: {
    code: string
    kind: ValedictorianFailureKind
    message: string
    status?: number
  }) {
    super(message)
    this.name = 'CliOwnedFailure'
    this.code = code
    this.kind = kind
    if (status !== undefined) this.status = status
  }
}

const kindExitCodes: Record<ValedictorianFailureKind, CliFailureExitCode> = {
  validation: 2,
  authentication: 3,
  authorization: 3,
  not_found: 4,
  conflict: 4,
  rate_limit: 5,
  unavailable: 5,
  integrity: 6,
  internal: 1,
}

const recoveryByKind: Record<ValedictorianFailureKind | 'usage', string> = {
  usage: 'Check the command options and arguments, then retry.',
  validation: 'Correct the request inputs and retry.',
  authentication: 'Provide valid credentials and retry.',
  authorization: 'Use an account with permission for this workspace, then retry.',
  not_found: 'Confirm the resource identifier and retry.',
  conflict: 'Refresh the latest state, then retry the mutation.',
  rate_limit: 'Wait before retrying the request.',
  unavailable: 'Retry after the service or local dependency recovers.',
  integrity: 'Retry after confirming the CLI and API versions are compatible.',
  internal: 'Retry the command. If it persists, report the failure without sharing secrets.',
}

export function classifyCliFailure(error: unknown): ClassifiedCliFailure {
  if (error instanceof CliUsageError) {
    return buildFailure({
      code: 'usage_error',
      kind: 'validation',
      message: error.message,
      guidanceKind: 'usage',
    })
  }

  if (error instanceof CliOwnedFailure) {
    return buildFailure({
      code: error.code,
      kind: error.kind,
      message: error.message,
      status: error.status,
    })
  }

  if (error instanceof ValedictorianTransportError) {
    return buildFailure({
      code: 'transport_error',
      kind: 'unavailable',
    })
  }

  if (error instanceof ValedictorianProtocolError) {
    return buildFailure({
      code: 'protocol_error',
      kind: 'integrity',
    })
  }

  const profile = asProfileDocumentFailure(error)
  if (profile) return profile

  const secret = asLocalSecretFailure(error)
  if (secret) return secret

  if (error instanceof ConnectorScheduleHttpError) {
    return fromTypedHttp(error, error.body.code, error.kind, error.body.message)
  }

  if (error instanceof ConnectorOptionQueryHttpError) {
    return fromTypedHttp(error, error.body.code, error.kind, error.body.message)
  }

  if (error instanceof ConnectorRetirementConflictError) {
    return fromTypedHttp(
      error,
      'connector_retirement_active_work_conflict',
      error.kind,
      error.conflict.message,
    )
  }

  if (error instanceof ValedictorianHttpError) {
    return classifyGenericHttpError(error)
  }

  return buildFailure({
    code: 'internal_error',
    kind: 'internal',
  })
}

export function presentCliFailure(
  error: unknown,
  options: { asJson: boolean; operation?: string },
): { exitCode: CliFailureExitCode; text: string } {
  const classified = classifyCliFailure(error)

  if (options.asJson) {
    return {
      exitCode: classified.exitCode,
      text: `${JSON.stringify({ error: toJsonError(classified.error) }, null, 2)}\n`,
    }
  }

  const operation = options.operation?.trim()
  const headline = operation
    ? `Failed ${operation}: ${humanSummary(classified.error)}`
    : humanSummary(classified.error)
  const detail = humanDetail(classified.error)
  const lines = [headline]
  if (detail) lines.push(detail)
  lines.push(`Recovery: ${classified.guidance}`)
  return {
    exitCode: classified.exitCode,
    text: `${lines.join('\n')}\n`,
  }
}

export function mapStricliExitCode(exitCode: number): number {
  if (exitCode >= 0) return exitCode
  if (exitCode === -4 || exitCode === -5) return 2
  return 1
}

export function isStricliUsageExitCode(exitCode: number): boolean {
  return exitCode === -4 || exitCode === -5
}

export function argvRequestsJson(argv: readonly string[]): boolean {
  for (const token of argv) {
    if (token === '--') return false
    if (token === '--json') return true
  }
  return false
}

function asProfileDocumentFailure(error: unknown): ClassifiedCliFailure | null {
  if (error instanceof ProfileDocumentHttpError) {
    return fromProfileBody(error.body, error.status, error.kind)
  }

  if (!(error instanceof ValedictorianHttpError)) return null
  const parsed = profileDocumentErrorBodySchema.safeParse(error.body)
  if (!parsed.success) return null
  if (profileDocumentErrorStatusByCode[parsed.data.code] !== error.status) return null
  return fromProfileBody(
    parsed.data,
    error.status,
    profileDocumentErrorKindByCode[parsed.data.code],
  )
}

function asLocalSecretFailure(error: unknown): ClassifiedCliFailure | null {
  if (error instanceof LocalSecretResolutionHttpError) {
    return fromTypedHttp(error, error.body.code, error.kind, error.body.message)
  }

  if (!(error instanceof ValedictorianHttpError)) return null
  const parsed = localSecretResolutionErrorBodySchema.safeParse(error.body)
  if (!parsed.success) return null
  if (localSecretResolutionErrorStatusByCode[parsed.data.code] !== error.status) return null
  return fromTypedHttp(
    error,
    parsed.data.code,
    localSecretResolutionErrorKindByCode[parsed.data.code],
    parsed.data.message,
  )
}

function fromProfileBody(
  body: {
    code: string
    message: string
    path?: ReadonlyArray<string | number>
    line?: number
    column?: number
  },
  status: number,
  kind: ValedictorianFailureKind,
): ClassifiedCliFailure {
  return buildFailure({
    code: body.code,
    kind,
    status,
    message: body.message,
    path: body.path,
    line: body.line,
    column: body.column,
  })
}

function fromTypedHttp(
  error: ValedictorianHttpError,
  code: string,
  kind: ValedictorianFailureKind,
  message?: string,
): ClassifiedCliFailure {
  return buildFailure({
    code,
    kind,
    status: error.status,
    ...(message !== undefined ? { message } : {}),
    requestId: error.requestId,
    retryAfter: error.retryAfter,
  })
}

function classifyGenericHttpError(error: ValedictorianHttpError): ClassifiedCliFailure {
  // Generic HttpError bodies are not authoritative without a concrete typed class or
  // surface-scoped request validation. Trust only status/kind metadata here.
  if (error.kind) {
    return buildFailure({
      code: codeFromKind(error.kind),
      kind: error.kind,
      status: error.status,
      requestId: error.requestId,
      retryAfter: error.retryAfter,
    })
  }

  const kind = kindFromStatus(error.status)
  return buildFailure({
    code: codeFromKind(kind),
    kind,
    status: error.status,
    requestId: error.requestId,
    retryAfter: error.retryAfter,
  })
}

function kindFromStatus(status: number): ValedictorianFailureKind {
  if (status === 400 || status === 422) return 'validation'
  if (status === 401) return 'authentication'
  if (status === 403) return 'authorization'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limit'
  if (status === 502 || status === 503 || status === 504) return 'unavailable'
  return 'internal'
}

function codeFromKind(kind: ValedictorianFailureKind): string {
  switch (kind) {
    case 'authentication':
      return 'authentication_error'
    case 'authorization':
      return 'authorization_error'
    case 'not_found':
      return 'not_found'
    case 'conflict':
      return 'conflict'
    case 'rate_limit':
      return 'rate_limit'
    case 'unavailable':
      return 'unavailable'
    case 'validation':
      return 'validation_error'
    case 'integrity':
      return 'integrity_error'
    default:
      return 'internal_error'
  }
}

function buildFailure(input: {
  code: string
  kind: ValedictorianFailureKind
  guidanceKind?: ValedictorianFailureKind | 'usage'
  status?: number
  message?: string
  path?: ReadonlyArray<string | number>
  line?: number
  column?: number
  requestId?: string
  retryAfter?: ValedictorianRetryAfter
}): ClassifiedCliFailure {
  const error: CliFailureErrorObject = {
    code: input.code,
    kind: input.guidanceKind === 'usage' ? 'validation' : input.kind,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.message !== undefined ? { message: input.message } : {}),
    ...(input.path !== undefined ? { path: input.path } : {}),
    ...(input.line !== undefined ? { line: input.line } : {}),
    ...(input.column !== undefined ? { column: input.column } : {}),
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    ...(input.retryAfter !== undefined ? { retryAfter: input.retryAfter } : {}),
  }

  return {
    exitCode: kindExitCodes[input.kind],
    error,
    guidance: recoveryByKind[input.guidanceKind ?? input.kind],
  }
}

function toJsonError(error: CliFailureErrorObject): Record<string, unknown> {
  const output: Record<string, unknown> = {
    code: error.code,
    kind: error.kind,
  }
  if (error.status !== undefined) output.status = error.status
  if (error.message !== undefined) output.message = error.message
  if (error.path !== undefined) output.path = error.path
  if (error.line !== undefined) output.line = error.line
  if (error.column !== undefined) output.column = error.column
  if (error.requestId !== undefined) output.requestId = error.requestId
  if (error.retryAfter !== undefined) output.retryAfter = error.retryAfter
  return output
}

function humanSummary(error: CliFailureErrorObject): string {
  if (error.message) return `${error.code}: ${error.message}`
  if (error.kind === 'validation' && error.code === 'usage_error') {
    return error.message ?? 'Invalid command usage.'
  }
  return valedictorianFailureKindMessages[error.kind === 'usage' ? 'validation' : error.kind]
}

function humanDetail(error: CliFailureErrorObject): string | undefined {
  if (!error.path) return undefined
  const parts = [`path=${formatErrorPath(error.path)}`]
  if (error.line !== undefined) parts.push(`line=${error.line}`)
  if (error.column !== undefined) parts.push(`column=${error.column}`)
  return parts.join(' ')
}

function formatErrorPath(path: ReadonlyArray<string | number>): string {
  return path
    .map((segment) => {
      if (typeof segment === 'number') return `[${segment}]`
      return `[${JSON.stringify(segment)}]`
    })
    .join('')
}
