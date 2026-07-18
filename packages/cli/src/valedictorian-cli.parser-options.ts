import {
  canonicalizeApplicationUrl,
  MAX_APPLICATION_LIST_LIMIT,
  normalizeApplicationUrlPreservingQuery,
} from 'sparxie'

import { CliUsageError } from './valedictorian-cli.failures.js'

export function readOption(argv: string[], name: string) {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

export function readRequiredOption(argv: string[], name: string) {
  return readRequiredArgument(readOption(argv, name), `${name} value`)
}

export function setOptionalStringOption(
  target: object,
  argv: string[],
  optionName: string,
  fieldName: string,
) {
  const value = readOption(argv, optionName)

  if (value !== undefined) {
    ;(target as Record<string, unknown>)[fieldName] = parseNullableStringOption(value, fieldName)
  }
}

export function setOptionalBooleanOption(
  target: object,
  argv: string[],
  optionName: string,
  fieldName: string,
) {
  const value = readOption(argv, optionName)

  if (value !== undefined) {
    ;(target as Record<string, unknown>)[fieldName] = parseBooleanValue(value, optionName)
  }
}

export function parseNullableStringOption(value: string, fieldName: string) {
  const trimmed = value.trim()

  if (trimmed === 'null') {
    return null
  }

  if (!trimmed) {
    throw new CliUsageError(`${fieldName} is required`)
  }

  return trimmed
}

export function parseNullableTimestampOption(value: string, fieldName: string) {
  const trimmed = value.trim()

  if (trimmed === 'null') {
    return null
  }

  const timestamp = trimmed === 'now' ? new Date().toISOString() : trimmed

  if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || Number.isNaN(new Date(timestamp).getTime())) {
    throw new CliUsageError(`Invalid ${fieldName}: ${value}`)
  }

  return timestamp
}

export function parseNullableDateStringOption(value: string, fieldName: string) {
  const trimmed = value.trim()

  if (trimmed === 'null') {
    return null
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new CliUsageError(`Invalid ${fieldName}: ${value}`)
  }

  const date = new Date(`${trimmed}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
    throw new CliUsageError(`Invalid ${fieldName}: ${value}`)
  }

  return trimmed
}

export function parseBooleanValue(value: string, optionName: string) {
  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  throw new CliUsageError(`Invalid ${optionName}: expected true or false`)
}

export function parseNumberOption(value: string, optionName: string) {
  return parseStrictNumberOption(value, optionName)
}

export function parseStrictIntegerOption(value: string, optionName: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value) && !/^-(0|[1-9]\d*)$/.test(value)) {
    throw new CliUsageError(`Invalid ${optionName}: ${value}`)
  }

  const number = Number(value)
  if (!Number.isSafeInteger(number)) {
    throw new CliUsageError(`Invalid ${optionName}: ${value}`)
  }
  return number
}

export function parseStrictNonNegativeIntegerOption(value: string, optionName: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new CliUsageError(`Invalid ${optionName}: ${value}`)
  }

  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new CliUsageError(`Invalid ${optionName}: ${value}`)
  }
  return number
}

export function parseStrictNumberOption(value: string, optionName: string): number {
  if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new CliUsageError(`Invalid ${optionName}: ${value}`)
  }

  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new CliUsageError(`Invalid ${optionName}: ${value}`)
  }
  return number
}

export function parseStrictJsonValue(value: string, optionName: string): unknown {
  if (value.trim().length === 0) {
    throw new CliUsageError(`${optionName} must be valid JSON`)
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new CliUsageError(`${optionName} must be valid JSON`)
  }
}

export function parseStrictJsonObject(value: string, optionName: string): Record<string, unknown> {
  const parsed = parseStrictJsonValue(value, optionName)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliUsageError(`${optionName} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

export function parseStrictJsonArray(value: string, optionName: string): unknown[] {
  const parsed = parseStrictJsonValue(value, optionName)
  if (!Array.isArray(parsed)) {
    throw new CliUsageError(`${optionName} must be a JSON array`)
  }
  return parsed
}

export function parseNullableApplicationUrlOption(value: string, fieldName: string) {
  const parsed = parseNullableStringOption(value, fieldName)

  return parsed === null ? null : asCliUsage(() => canonicalizeApplicationUrl(parsed))
}

export function parseNullableSourceUrlOption(value: string, fieldName: string) {
  const parsed = parseNullableStringOption(value, fieldName)

  return parsed === null ? null : asCliUsage(() => normalizeApplicationUrlPreservingQuery(parsed))
}

export function hasFlag(argv: string[], name: string) {
  return argv.includes(name)
}

export function hasTextValue(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

export function assertKnownOptions(argv: string[], allowedOptions: string[]) {
  for (const token of argv) {
    if (token.startsWith('--') && !allowedOptions.includes(token)) {
      throw new CliUsageError(`Unknown option: ${token}`)
    }
  }
}

export function assertMutationPatch(input: object, identityFields: string[], message: string) {
  const patchKeys = Object.keys(input).filter((key) => !identityFields.includes(key))

  if (patchKeys.length === 0) {
    throw new CliUsageError(message)
  }
}

export function readRequiredText(value: string | undefined, fieldName: string) {
  const trimmed = value?.trim()

  if (!trimmed) {
    throw new CliUsageError(`${fieldName} is required`)
  }

  return trimmed
}

export function readOptionalText(value: string | undefined, fieldName: string) {
  if (value === undefined) {
    return undefined
  }

  return readRequiredText(value, fieldName)
}

export function readRequiredArgument(value: string | undefined, label: string) {
  const trimmed = value?.trim()

  if (!trimmed) {
    throw new CliUsageError(`Missing ${label}`)
  }

  return trimmed
}

export function validateLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_APPLICATION_LIST_LIMIT) {
    throw new CliUsageError(`Invalid --limit: must be between 1 and ${MAX_APPLICATION_LIST_LIMIT}`)
  }
}

export function asCliUsage<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof CliUsageError) throw error
    if (error instanceof Error) throw new CliUsageError(error.message)
    throw new CliUsageError(String(error))
  }
}

export function parseDateOption(
  optionName: string,
  value: string | undefined,
  boundary: 'start' | 'end',
) {
  if (!value) {
    throw new CliUsageError(`Missing value for ${optionName}`)
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    throw new CliUsageError(`Invalid date for ${optionName}: ${value}`)
  }

  return parsed.toISOString()
}
