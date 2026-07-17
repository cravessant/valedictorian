import { scheduleRetry } from '@sparxie/valedictorian-connectors-core'
import type { FieldResolutionOutcome, JsonValue, TransientRetryReason } from 'sparxie'
import type { ClaimedProviderUrlResolutionWork } from './provider-url-resolution.source'

export type ProviderUrlResolverResult =
  | {
      status: 'resolved'
      url: string
      method: string
      evidence?: readonly { kind: string; value?: JsonValue }[]
    }
  | { status: 'interrupted'; reason: 'cancelled' | 'runtime_limit' }
  | {
      status: 'retryable'
      reason: string
      retryReason: TransientRetryReason
      serverMinimumDelayMs?: number
    }
  | {
      status: 'terminal'
      reason: string
      action?: 'authenticate'
      parserChanged?: boolean
      evidence?: readonly { kind: string; value?: JsonValue }[]
    }

const MAX_PROVIDER_URL_BYTES = 2_048
const MAX_PROVIDER_RESULT_TEXT_BYTES = 512
const MAX_PROVIDER_RESULT_METHOD_BYTES = 256
const MAX_PROVIDER_RESULT_EVIDENCE_ITEMS = 50
const MAX_PROVIDER_RESULT_EVIDENCE_BYTES = 16_384
const MAX_PROVIDER_RESULT_JSON_DEPTH = 8

export function validateProviderUrlResolverResult(value: unknown): value is ProviderUrlResolverResult {
  if (!isPlainRecord(value) || typeof value.status !== 'string') return false
  if (value.status === 'interrupted') {
    return hasOnlyKeys(value, ['status', 'reason'])
      && (value.reason === 'cancelled' || value.reason === 'runtime_limit')
  }
  if (value.status === 'resolved') {
    return hasOnlyKeys(value, ['status', 'url', 'method', 'evidence'])
      && boundedProviderUrl(value.url)
      && boundedText(value.method, MAX_PROVIDER_RESULT_METHOD_BYTES)
      && validEvidence(value.evidence)
  }
  if (value.status === 'retryable') {
    return hasOnlyKeys(value, ['status', 'reason', 'retryReason', 'serverMinimumDelayMs'])
      && boundedText(value.reason, MAX_PROVIDER_RESULT_TEXT_BYTES)
      && (value.retryReason === 'rate_limit' || value.retryReason === 'server_failure'
        || value.retryReason === 'network_interruption' || value.retryReason === 'operation_timeout')
      && (value.serverMinimumDelayMs === undefined
        || (typeof value.serverMinimumDelayMs === 'number'
          && Number.isSafeInteger(value.serverMinimumDelayMs) && value.serverMinimumDelayMs >= 0))
  }
  if (value.status === 'terminal') {
    return hasOnlyKeys(value, ['status', 'reason', 'action', 'parserChanged', 'evidence'])
      && boundedText(value.reason, MAX_PROVIDER_RESULT_TEXT_BYTES)
      && (value.action === undefined || value.action === 'authenticate')
      && (value.parserChanged === undefined || typeof value.parserChanged === 'boolean')
      && validEvidence(value.evidence)
  }
  return false
}

function validEvidence(value: unknown): value is readonly { kind: string; value?: JsonValue }[] | undefined {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.length > MAX_PROVIDER_RESULT_EVIDENCE_ITEMS) return false
  const budget = { bytes: 0 }
  return value.every((item) => {
    if (!isPlainRecord(item) || !hasOnlyKeys(item, ['kind', 'value'])
      || !boundedText(item.kind, MAX_PROVIDER_RESULT_TEXT_BYTES)) return false
    budget.bytes += Buffer.byteLength(item.kind, 'utf8') + 2
    if (budget.bytes > MAX_PROVIDER_RESULT_EVIDENCE_BYTES) return false
    if (!Object.prototype.hasOwnProperty.call(item, 'value')) return true
    return boundedJson(item.value, 0, new WeakSet<object>(), budget)
  })
}

function boundedJson(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  budget: { bytes: number },
): value is JsonValue {
  if (depth > MAX_PROVIDER_RESULT_JSON_DEPTH) return false
  if (value === null || typeof value === 'boolean') {
    budget.bytes += 5
    return budget.bytes <= MAX_PROVIDER_RESULT_EVIDENCE_BYTES
  }
  if (typeof value === 'string') {
    budget.bytes += Buffer.byteLength(value, 'utf8')
    return budget.bytes <= MAX_PROVIDER_RESULT_EVIDENCE_BYTES
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false
    budget.bytes += 24
    return budget.bytes <= MAX_PROVIDER_RESULT_EVIDENCE_BYTES
  }
  if (!isPlainRecord(value) && !Array.isArray(value)) return false
  if (Array.isArray(value) && value.length > MAX_PROVIDER_RESULT_EVIDENCE_ITEMS) return false
  if (seen.has(value)) return false
  seen.add(value)
  const entries = Array.isArray(value)
    ? value.map((item) => ['', item] as const)
    : Object.entries(value)
  for (const [key, item] of entries) {
    if (!Array.isArray(value) && !boundedText(key, MAX_PROVIDER_RESULT_TEXT_BYTES)) return false
    budget.bytes += Buffer.byteLength(key, 'utf8') + 2
    if (budget.bytes > MAX_PROVIDER_RESULT_EVIDENCE_BYTES
      || !boundedJson(item, depth + 1, seen, budget)) return false
  }
  seen.delete(value)
  return true
}

function boundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !hasControlCharacter(value)
    && Buffer.byteLength(value, 'utf8') <= maxBytes
}

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 31 || codeUnit === 127) return true
  }
  return false
}

function boundedProviderUrl(value: unknown): value is string {
  if (!boundedText(value, MAX_PROVIDER_URL_BYTES)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
  } catch {
    return false
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key))
}

export function mapProviderUrlResolverResult(
  work: ClaimedProviderUrlResolutionWork,
  result: ProviderUrlResolverResult,
  dependencies: { nowEpochMs: () => number; random: () => number },
): FieldResolutionOutcome {
  if (result.status === 'interrupted' && result.reason === 'runtime_limit') {
    result = {
      status: 'retryable',
      reason: 'provider_url_runtime_limit',
      retryReason: 'operation_timeout',
    }
  }
  const base = {
    resolverId: work.resolverId,
    resolverVersion: work.resolverVersion,
    field: 'destinationUrl' as const,
    inputHash: work.inputHash,
  }
  if (result.status === 'resolved') {
    return {
      ...base,
      status: 'resolved',
      value: {
        class: 'employer_or_ats',
        intermediaryUrl: work.intermediaryUrl,
        url: result.url,
      },
      confidence: 1,
      evidence: [
        { kind: 'provider_url_intermediary', value: work.intermediaryUrl },
        { kind: 'provider_url_resolution_method', value: result.method },
        ...normalizeEvidence(result.evidence),
      ],
    }
  }
  if (result.status === 'terminal') {
    return {
      ...base,
      status: 'blocked',
      reason: result.reason,
      ...(result.evidence ? { evidence: normalizeEvidence(result.evidence) } : {}),
    }
  }
  if (result.status === 'interrupted') {
    return { ...base, status: 'blocked', reason: `provider_url_${result.reason}` }
  }
  const retry = scheduleRetry({
    attempt: work.attempt,
    baseDelayMs: 30_000,
    horizonAt: work.horizonAt,
    maxAttempts: work.maxAttempts,
    maxDelayMs: 30 * 60 * 1_000,
    reason: result.retryReason,
    serverMinimumDelayMs: result.serverMinimumDelayMs,
  }, dependencies)
  if (retry.state === 'exhausted') return { ...base, status: 'exhausted', retry }
  if (retry.state === 'scheduled' || retry.state === 'not_due') {
    return { ...base, status: 'retry', retry }
  }
  return { ...base, status: 'cancelled', retry }
}

function normalizeEvidence(
  evidence: readonly { kind: string; value?: JsonValue }[] | undefined,
) {
  return (evidence ?? []).map(({ kind, value }) => ({
    kind,
    value: value ?? null,
  }))
}
