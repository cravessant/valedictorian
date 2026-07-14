import type { JsonObject, JsonValue } from 'sparxie'
import { sanitizeDisplayText, sanitizeRawFacts } from './raw-detail-sanitization'

export interface CapturedRawFacts {
  title: string | null
  company: string | null
}

const TITLE_PATHS = [
  ['roleTitle'],
  ['jobTitle'],
  ['title'],
  ['role'],
  ['providerRow', 'jobResult', 'jobTitle'],
  ['providerRow', 'jobResult', 'jobNlpTitle'],
  ['providerRow', 'jobResult', 'title'],
  ['jobResult', 'jobTitle'],
  ['jobResult', 'jobNlpTitle'],
  ['jobResult', 'title'],
] as const

const COMPANY_PATHS = [
  ['companyName'],
  ['company'],
  ['providerRow', 'companyResult', 'companyName'],
  ['providerRow', 'jobResult', 'companyName'],
  ['companyResult', 'companyName'],
  ['jobResult', 'companyName'],
] as const

/**
 * Bounded captured title/company for list and Inspect presentation.
 * Reads only sanitized raw evidence — never canonical candidate fields.
 */
export function presentCapturedRawFacts(
  payload: JsonValue | null | undefined,
): CapturedRawFacts {
  const sanitized = sanitizeRawFacts(payload ?? undefined)
  if (!isJsonObject(sanitized)) return { title: null, company: null }
  return {
    title: firstNonblankString(sanitized, TITLE_PATHS),
    company: firstNonblankString(sanitized, COMPANY_PATHS),
  }
}

function firstNonblankString(
  root: JsonObject,
  paths: readonly (readonly string[])[],
): string | null {
  for (const path of paths) {
    const value = readPath(root, path)
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    const display = sanitizeDisplayText(trimmed)
    if (display === 'Sensitive detail omitted') continue
    return display
  }
  return null
}

function readPath(root: JsonObject, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue = root
  for (const key of path) {
    if (!isJsonObject(current)) return undefined
    current = current[key] as JsonValue
  }
  return current
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
}
