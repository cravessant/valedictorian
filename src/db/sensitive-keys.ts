/**
 * Broadened sensitive-JSON-key denylist (issue #298 hardening).
 *
 * The schema CHECKs and the migration transform reject any JSON whose object keys
 * CONTAIN a sensitive substring, not just exact matches — so OAuth- and
 * header-style keys (`access_token`, `refresh_token`, `client_secret`,
 * `api_key`/`apiKey`, `X-Api-Key`, `X-Auth-Token`, `privateKey`, `bearer`,
 * `credential`, …) are caught. Matching is case-insensitive and
 * underscore/hyphen/camelCase agnostic.
 *
 * This is deliberately STRICTER than the sparxie contract's exact-key rule
 * (defense in depth). A false-positive legacy payload is not a migration failure:
 * it takes the existing reset+report path. Runtime writers own their key choices.
 */
export const SENSITIVE_KEY_SUBSTRINGS =
  'authorization|cookie|password|secret|token|api_key|apikey|api-key|private_key|privatekey|bearer|credential|auth-token|ssn'

/** Postgres regex literal matching a JSON key whose name contains a sensitive substring. */
export const SENSITIVE_JSON_KEY_REGEX = `"[^"]*(${SENSITIVE_KEY_SUBSTRINGS})[^"]*"[[:space:]]*:`

/**
 * Drizzle `sql.raw(...)` fragment for a CHECK: a text column passes when it does
 * NOT contain a sensitive JSON key. Usage: sql`${col} ${sql.raw(FORBIDDEN_JSON_KEY_PREDICATE)}`.
 */
export const FORBIDDEN_JSON_KEY_PREDICATE = `!~* '${SENSITIVE_JSON_KEY_REGEX}'`
