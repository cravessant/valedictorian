/**
 * Strict Policy config patch admission (issue #396).
 *
 * The SDK ships no schema for `PolicyConfig` — only `defaultPolicyConfig` (the canonical key
 * shape) and `normalizePolicyConfig`, which rebuilds a config from known keys and silently
 * substitutes the default for any value it cannot read. Both halves of that leniency are
 * failures at an authoritative write boundary: an unknown or misspelled section and a malformed
 * known value alike merge, get dropped, and are reported back as a successful update that
 * changed nothing — or worse, reset a valid non-default setting to the default.
 *
 * Admission rejects both instead, and derives the rule from the contract rather than
 * restating it:
 *  - unknown keys come from walking `defaultPolicyConfig`, the canonical key tree;
 *  - malformed values come from `normalizePolicyConfig` itself — a patch leaf is admissible
 *    exactly when normalization round-trips it unchanged. That makes the SDK's own readers
 *    (positive number, positive integer, hour, `HH:MM`, boolean, non-empty string array,
 *    evidence-tag array, timezone) the authority, so this module cannot drift from them.
 *
 * Normalization reads each field against a constant default independently of its siblings, so
 * normalizing the bare patch is enough to decide every leaf it carries.
 */
import { defaultPolicyConfig, normalizePolicyConfig, type PolicyConfigPatch } from '@sparxie/sdk'

/** The dotted path of the first unsupported field in `value`, or null when every key is canonical. */
export function unsupportedPolicyConfigField(value: unknown): string | null {
  return findUnsupportedField(value, defaultPolicyConfig, '')
}

/**
 * The reason `patch` is inadmissible, or null when every key and value survives normalization
 * intact. The message is the single wording both the HTTP parser and the repository raise.
 */
export function policyConfigPatchViolation(patch: unknown): string | null {
  const unsupported = unsupportedPolicyConfigField(patch)
  if (unsupported !== null) return `Unsupported policy config field: ${unsupported}`

  let normalized: unknown
  try {
    normalized = normalizePolicyConfig(patch)
  } catch (error) {
    return error instanceof Error ? error.message : 'Unreadable policy config patch'
  }
  const discarded = findDiscardedValue(patch, normalized, '')
  return discarded === null ? null : `Unsupported policy config value: ${discarded}`
}

export function admitPolicyConfigPatch(patch: unknown): PolicyConfigPatch {
  const violation = policyConfigPatchViolation(patch)
  if (violation !== null) throw new Error(violation)
  return patch as PolicyConfigPatch
}

function findUnsupportedField(value: unknown, canonical: unknown, path: string): string | null {
  if (!isRecord(value) || !isRecord(canonical)) return null
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = path ? `${path}.${key}` : key
    if (!Object.prototype.hasOwnProperty.call(canonical, key)) return nestedPath
    const unsupported = findUnsupportedField(nested, canonical[key], nestedPath)
    if (unsupported !== null) return unsupported
  }
  return null
}

/** The dotted path of the first patch leaf that normalization did not keep verbatim. */
function findDiscardedValue(value: unknown, normalized: unknown, path: string): string | null {
  if (isRecord(value) && isRecord(normalized)) {
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = path ? `${path}.${key}` : key
      const discarded = findDiscardedValue(nested, normalized[key], nestedPath)
      if (discarded !== null) return discarded
    }
    return null
  }
  return sameValue(value, normalized) ? null : path
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameValue(item, right[index]))
  }
  return Object.is(left, right)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
