import http from 'node:http'

export class LocalHttpValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalHttpValidationError'
  }
}

export class LocalHttpBodyTooLargeError extends Error {
  readonly statusCode = 413

  constructor(message: string) {
    super(message)
    this.name = 'LocalHttpBodyTooLargeError'
  }
}

export function localHttpValidationError(message: string, cause?: unknown) {
  return Object.assign(
    new LocalHttpValidationError(message),
    cause === undefined ? {} : { cause },
  )
}

export function parseLocalHttpInput<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (error instanceof LocalHttpValidationError) throw error
    throw localHttpValidationError('Invalid request input', error)
  }
}

export function readJsonBody(
  request: http.IncomingMessage,
  options: { maxBytes?: number; maxBytesMessage?: string } = {},
) {
  return new Promise<unknown>((resolve, reject) => {
    const declaredLength = Number(request.headers['content-length'])

    if (
      options.maxBytes !== undefined &&
      Number.isFinite(declaredLength) &&
      declaredLength > options.maxBytes
    ) {
      reject(bodyLimitError(options.maxBytesMessage))
      return
    }

    const chunks: Buffer[] = []
    let receivedBytes = 0
    let finished = false

    request.on('data', (chunk: Buffer) => {
      if (finished) {
        return
      }
      receivedBytes += chunk.byteLength

      if (options.maxBytes !== undefined && receivedBytes > options.maxBytes) {
        finished = true
        chunks.length = 0
        reject(bodyLimitError(options.maxBytesMessage))
        return
      }
      chunks.push(chunk)
    })
    request.on('error', reject)
    request.on('end', () => {
      if (finished) {
        return
      }
      const text = Buffer.concat(chunks).toString('utf8')

      if (!text) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(text) as unknown)
      } catch (error) {
        reject(localHttpValidationError('Invalid JSON request body', error))
      }
    })
  })
}

function bodyLimitError(message = 'Request body exceeds the raw batch limit') {
  return new LocalHttpBodyTooLargeError(message)
}

export function readStringField(body: unknown, field: string) {
  const record = readRecord(body)

  if (typeof record[field] === 'string') {
    const trimmed = record[field].trim()

    if (trimmed) {
      return trimmed
    }

    throw localHttpValidationError(`${field} is required`)
  }

  throw localHttpValidationError(`Missing ${field}`)
}

/** Required string field preserved byte-for-byte (no trim). Empty string is valid. */
export function readRequiredOpaqueStringField(body: unknown, field: string) {
  const record = readRecord(body)

  if (!(field in record)) {
    throw localHttpValidationError(`Missing ${field}`)
  }

  const value = record[field]
  if (typeof value !== 'string') {
    throw localHttpValidationError(`Invalid ${field}`)
  }

  return value
}

export function readOptionalStringField(body: unknown, field: string) {
  const record = readRecord(body)

  if (typeof record[field] === 'string') {
    return record[field].trim()
  }

  return undefined
}

export function readOptionalNullableStringField(body: unknown, field: string) {
  const record = readRecord(body)

  if (!(field in record)) {
    return undefined
  }

  const value = record[field]

  if (value === null || typeof value === 'string') {
    return value
  }

  throw localHttpValidationError(`Invalid ${field}`)
}

export function readOptionalNumberField(body: unknown, field: string) {
  const record = readRecord(body)

  if (!(field in record)) {
    return undefined
  }

  const value = record[field]

  if (typeof value === 'number') {
    return value
  }

  throw localHttpValidationError(`Invalid ${field}`)
}

export function readNumberField(body: unknown, field: string) {
  const record = readRecord(body)

  if (typeof record[field] === 'number') {
    return record[field]
  }

  throw localHttpValidationError(`Missing ${field}`)
}

export function readOptionalBooleanField(body: unknown, field: string) {
  const record = readRecord(body)

  if (!(field in record)) {
    return undefined
  }

  const value = record[field]

  if (typeof value === 'boolean') {
    return value
  }

  throw localHttpValidationError(`Invalid ${field}`)
}

export function copyOptionalStringField(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  field: string,
) {
  if (!(field in source)) {
    return
  }

  if (typeof source[field] !== 'string') {
    throw localHttpValidationError(`Invalid ${field}`)
  }

  target[field] = source[field]
}

export function copyOptionalNullableStringField(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  field: string,
) {
  if (!(field in source)) {
    return
  }

  if (source[field] !== null && typeof source[field] !== 'string') {
    throw localHttpValidationError(`Invalid ${field}`)
  }

  target[field] = source[field]
}

export function copyOptionalBooleanField(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  field: string,
) {
  if (!(field in source)) {
    return
  }

  if (typeof source[field] !== 'boolean') {
    throw localHttpValidationError(`Invalid ${field}`)
  }

  target[field] = source[field]
}

export function validateWorkflowTimestampInput(
  input: Record<string, unknown>,
  fieldName: 'holdStartedAt' | 'lockStartedAt',
) {
  const value = input[fieldName]

  if (value === undefined || value === null) {
    return
  }

  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    Number.isNaN(new Date(value).getTime())
  ) {
    throw localHttpValidationError(`Invalid ${fieldName}: ${formatUnknownValue(value)}`)
  }
}

export function readRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}

function formatUnknownValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value)
}

export function writeJson(response: http.ServerResponse, statusCode: number, body: unknown) {
  const serializedBody = serializeJson(body)
  response.writeHead(statusCode, {
    ...localCorsHeaders,
    'content-type': 'application/json',
  })
  response.end(serializedBody)
}

export function writeNoStoreJson(response: http.ServerResponse, statusCode: number, body: unknown) {
  const serializedBody = serializeJson(body)
  response.writeHead(statusCode, {
    ...localCorsHeaders,
    'cache-control': 'no-store',
    'content-type': 'application/json',
  })
  response.end(serializedBody)
}

function serializeJson(body: unknown): string {
  const serialized = JSON.stringify(body)
  if (serialized === undefined) throw new TypeError('Response body is not JSON serializable')
  return serialized
}

export function writeEmpty(response: http.ServerResponse, statusCode: number) {
  response.writeHead(statusCode, localCorsHeaders)
  response.end()
}

export function writeNoStoreEmpty(response: http.ServerResponse, statusCode: number) {
  response.writeHead(statusCode, {
    ...localCorsHeaders,
    'cache-control': 'no-store',
  })
  response.end()
}

const localCorsHeaders = {
  'access-control-allow-headers': 'authorization, content-type, x-request-id',
  'access-control-allow-methods': 'DELETE, GET, OPTIONS, PATCH, POST, PUT',
  'access-control-allow-origin': '*',
}
