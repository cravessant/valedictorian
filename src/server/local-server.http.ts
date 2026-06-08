import http from 'node:http'

export function readJsonBody(request: http.IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []

    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('error', reject)
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')

      if (!text) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(text) as unknown)
      } catch (error) {
        reject(error)
      }
    })
  })
}

export function readStringField(body: unknown, field: string) {
  const record = readRecord(body)

  if (typeof record[field] === 'string') {
    const trimmed = record[field].trim()

    if (trimmed) {
      return trimmed
    }

    throw new Error(`${field} is required`)
  }

  throw new Error(`Missing ${field}`)
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

  throw new Error(`Invalid ${field}`)
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

  throw new Error(`Invalid ${field}`)
}

export function readNumberField(body: unknown, field: string) {
  const record = readRecord(body)

  if (typeof record[field] === 'number') {
    return record[field]
  }

  throw new Error(`Missing ${field}`)
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

  throw new Error(`Invalid ${field}`)
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
    throw new Error(`Invalid ${field}`)
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
    throw new Error(`Invalid ${field}`)
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
    throw new Error(`Invalid ${field}`)
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
    throw new Error(`Invalid ${fieldName}: ${formatUnknownValue(value)}`)
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
  response.writeHead(statusCode, {
    'content-type': 'application/json',
  })
  response.end(JSON.stringify(body))
}
