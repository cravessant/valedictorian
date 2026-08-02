import { SENSITIVE_KEY_SUBSTRINGS } from '../../db/sensitive-keys.js'

export const destinationUrlMaximumLength = 2_048

export type DestinationUrlSafetyCode =
  | 'empty'
  | 'too_long'
  | 'surrounding_whitespace'
  | 'malformed'
  | 'not_https'
  | 'credentials'
  | 'fragment'
  | 'unsafe_host'
  | 'sensitive_query'
  | 'invalid_resolver_method'

export type DestinationUrlSafetyResult =
  | { readonly ok: true; readonly url: string }
  | {
    readonly ok: false
    readonly code: DestinationUrlSafetyCode
    readonly message: string
  }

/**
 * Validates one public destination without rewriting it. This module intentionally
 * uses only platform APIs so desktop UI feedback and server-side enforcement share
 * the same decision table; callers must retain the original accepted string.
 */
export function validateDestinationUrl(value: string): DestinationUrlSafetyResult {
  if (value.length === 0) return failure('empty', 'Enter a destination URL.')
  if (value.length > destinationUrlMaximumLength) {
    return failure('too_long', 'Destination URLs must be 2,048 characters or fewer.')
  }
  if (value.trim() !== value) {
    return failure('surrounding_whitespace', 'Destination URLs cannot start or end with whitespace.')
  }
  if (value.includes('\\')) {
    return failure('malformed', 'Destination URLs cannot include backslashes.')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return failure('malformed', 'Enter a complete public HTTPS destination URL.')
  }
  if (parsed.protocol !== 'https:') {
    return failure('not_https', 'Destination URLs must use HTTPS.')
  }
  if (parsed.username || parsed.password || hasAuthorityUserinfoDelimiter(value)) {
    return failure('credentials', 'Destination URLs cannot include credentials.')
  }
  if (parsed.hash || value.includes('#')) {
    return failure('fragment', 'Destination URLs cannot include fragments.')
  }
  if (!parsed.hostname || parsed.hostname.length > 253 || isUnsafeHost(parsed.hostname)) {
    return failure('unsafe_host', 'Destination URLs must use a public hostname.')
  }
  for (const key of parsed.searchParams.keys()) {
    if (isSensitiveQueryKey(key)) {
      return failure('sensitive_query', 'Destination URLs cannot include sensitive query parameters.')
    }
  }
  return { ok: true, url: value }
}

export function validateResolverMethod(method: string): DestinationUrlSafetyResult {
  return /^[a-z][a-z0-9_.-]{0,99}$/i.test(method)
    ? { ok: true, url: '' }
    : failure('invalid_resolver_method', 'The destination resolver returned an invalid method.')
}

function failure(code: DestinationUrlSafetyCode, message: string): DestinationUrlSafetyResult {
  return { ok: false, code, message }
}

function isUnsafeHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.+$/u, '')
  return !host.includes('.')
    || isIpAddress(host)
    || host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.test')
    || host.endsWith('.example')
    || host.endsWith('.invalid')
    || host.endsWith('.home')
    || host.endsWith('.lan')
    || host.endsWith('.onion')
    || host === 'jobright.ai'
    || host.endsWith('.jobright.ai')
}

function isIpAddress(host: string) {
  if (host.includes(':')) return true
  const octets = host.split('.')
  return octets.length === 4
    && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)
}

function hasAuthorityUserinfoDelimiter(value: string) {
  const schemeEnd = value.indexOf(':')
  if (schemeEnd < 0 || value.slice(schemeEnd + 1, schemeEnd + 3) !== '//') return false
  const authorityStart = schemeEnd + 3
  const authorityEnd = firstDelimiter(value, authorityStart)
  return value.slice(authorityStart, authorityEnd).includes('@')
}

function firstDelimiter(value: string, start: number) {
  const delimiters = [value.indexOf('/', start), value.indexOf('?', start), value.indexOf('#', start)]
    .filter((index) => index >= 0)
  return delimiters.length > 0 ? Math.min(...delimiters) : value.length
}

function isSensitiveQueryKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, '')
  return SENSITIVE_KEY_SUBSTRINGS.split('|').some((term) =>
    normalized.includes(term.replace(/[^a-z0-9]/gu, '')))
    || /(?:sig(?:nature)?|jwt|session|csrf|xsrf|nonce|credential|bearer|oauth|xamz)/iu.test(normalized)
}
