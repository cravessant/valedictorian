import type { JsonValue, RawSourceEvidenceInput } from 'sparxie'

const sensitiveAssignmentPattern = /(?:^|[^\w])["']?([a-z][a-z\d_-]{0,63})["']?\s*[:=]/gi
const bearerCredentialPattern = /\bbearer\s+[\w.~+/-]+=*/i
const jwtCredentialPattern = /(?:^|[^a-z\d_-])([a-z\d_-]{8,})\.[a-z\d_-]+\.[a-z\d_-]*(?=$|[^a-z\d_-])/gi
const awsAccessKeyPattern = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/
const urlTokenPattern = /(?:\b(?:[a-z][a-z\d+.-]*):\/\/|\/\/|\b(?:javascript|data|vbscript|file|mailto|tel|urn|blob):)[^\s<>"']+/gi
const maxScannedStringLength = 1_000_000
const maxAssignmentsPerString = 64
const maxIdentifierLength = 512
const maxJwtHeaderLength = 4_096
const maxUrlParametersPerToken = 64
const maxUrlTokensPerString = 64
const maxDecodePasses = 3
const maxNestedUrlDepth = 3

export function sanitizeRawFacts(value: JsonValue | undefined): JsonValue | undefined {
  if (typeof value === 'string') {
    if (hasSensitiveAssignment(value)) return undefined
    if (hasUnsafeUrlToken(value)) return undefined
    return value
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRawFacts(item)).filter((item) => item !== undefined) as JsonValue[]
  }
  if (!value) return undefined
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (!isSafeIdentifier(key)) return []
    const sanitized = sanitizeRawFacts(item)
    return sanitized === undefined ? [] : [[key, sanitized]]
  }))
}

function hasSensitiveAssignment(value: string): boolean {
  return decodedVariants(value).some((variant) => {
    if (
      bearerCredentialPattern.test(variant)
      || hasJwtCredential(variant)
      || awsAccessKeyPattern.test(variant)
    ) return true
    sensitiveAssignmentPattern.lastIndex = 0
    let assignments = 0
    for (const match of variant.matchAll(sensitiveAssignmentPattern)) {
      assignments += 1
      if (assignments > maxAssignmentsPerString || isSensitiveIdentifier(match[1]!)) return true
    }
    return false
  })
}

function hasJwtCredential(value: string): boolean {
  jwtCredentialPattern.lastIndex = 0
  for (const match of value.matchAll(jwtCredentialPattern)) {
    const header = match[1]!
    if (header.length > maxJwtHeaderLength) return true
    try {
      const base64 = header.replace(/-/g, '+').replace(/_/g, '/')
      const padding = '='.repeat((4 - (base64.length % 4)) % 4)
      const decoded = JSON.parse(atob(`${base64}${padding}`)) as unknown
      if (
        decoded !== null
        && typeof decoded === 'object'
        && !Array.isArray(decoded)
        && typeof (decoded as { alg?: unknown }).alg === 'string'
      ) return true
    } catch {
      // A dotted public identifier is not a JWT unless its JOSE header is valid JSON.
    }
  }
  return false
}

function isSafeIdentifier(value: string): boolean {
  return !isSensitiveIdentifier(value)
    && !hasSensitiveAssignment(value)
    && !hasUnsafeUrlToken(value)
}

function isSensitiveIdentifier(value: string): boolean {
  if (value.length > maxIdentifierLength) return true
  const normalized = value.toLowerCase().replace(/[^a-z\d]/g, '')
  if (normalized.endsWith('sig') || normalized.includes('signature')) return true
  if (/^(?:auth|authentication)(?:token|key|id|secret)?$/.test(normalized)) return true
  return [
    'authorization', 'cookie', 'credential', 'password', 'passwd', 'secret', 'session',
    'token', 'apikey', 'privatekey', 'accesskeyid', 'jwt',
  ].some((marker) => normalized.includes(marker))
}

function decodedVariants(value: string): string[] {
  if (value.length > maxScannedStringLength) return []
  const variants = [value]
  for (let pass = 0; pass < maxDecodePasses; pass += 1) {
    const decoded = variants.at(-1)!.replace(/(?:%[\da-f]{2})+/gi, (encoded) => {
      try {
        return decodeURIComponent(encoded)
      } catch {
        return encoded
      }
    })
    if (decoded === variants.at(-1) || decoded.length > maxScannedStringLength) break
    variants.push(decoded)
  }
  return variants
}

function hasUnsafeUrlToken(value: string, depth = 0): boolean {
  if (value.length > maxScannedStringLength) return true
  let tokenCount = 0
  for (const variant of decodedVariants(value)) {
    urlTokenPattern.lastIndex = 0
    for (const match of variant.matchAll(urlTokenPattern)) {
      tokenCount += 1
      if (tokenCount > maxUrlTokensPerString || !isSafeHttpUrlToken(match[0], depth)) return true
    }
  }
  return false
}

function isSafeHttpUrlToken(value: string, depth: number): boolean {
  if (value.length > maxScannedStringLength) return false
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (url.username || url.password) return false
    let parameterCount = 0
    for (const key of url.searchParams.keys()) {
      parameterCount += 1
      if (parameterCount > maxUrlParametersPerToken || isSensitiveIdentifier(key)) return false
    }
    const nestedContent = `${url.search}${url.hash}`
    if (hasSensitiveAssignment(nestedContent)) return false
    if (depth >= maxNestedUrlDepth) {
      return decodedVariants(nestedContent).every((variant) => {
        urlTokenPattern.lastIndex = 0
        return !urlTokenPattern.test(variant)
      })
    }
    return !hasUnsafeUrlToken(nestedContent, depth + 1)
  } catch {
    return false
  }
}

export function sanitizeRawEvidence(
  evidence: RawSourceEvidenceInput[],
): RawSourceEvidenceInput[] {
  return evidence.flatMap((item) => {
    if (!isSafeIdentifier(item.kind) || !isSafeIdentifier(item.label)) return []
    const value = sanitizeRawFacts(item.value)
    return value === undefined ? [] : [{ ...item, value }]
  })
}

export function isSafeHttpUrl(value: string): boolean {
  return !value.startsWith('//') && isSafeHttpUrlToken(value, 0)
}

export function sanitizeDisplayText(value: string): string {
  const sanitized = sanitizeRawFacts(value)
  return typeof sanitized === 'string' ? sanitized : 'Sensitive detail omitted'
}

export function isSafeDisplayString(value: string): boolean {
  return sanitizeRawFacts(value) === value
}
