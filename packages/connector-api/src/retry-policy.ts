import {
  retryAdviceSchema,
  type RetryAdvice,
  type TransientRetryReason,
} from "./retry.js"

export type RetryPolicyInput = {
  attempt: number
  baseDelayMs: number
  horizonAt: string
  maxAttempts: number
  maxDelayMs: number
  reason: TransientRetryReason
  serverMinimumDelayMs?: number | null
}
export type RetryPolicyDependencies = {
  nowEpochMs(): number
  random(): number
}

const maxEcmascriptDateEpochMs = 8_640_000_000_000_000

function isPositiveSafeMillisecond(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maxEcmascriptDateEpochMs
  )
}

export function scheduleRetry(
  input: RetryPolicyInput,
  dependencies: RetryPolicyDependencies,
): RetryAdvice {
  const nowEpochMs = dependencies.nowEpochMs()
  if (!isPositiveSafeMillisecond(nowEpochMs)) {
    throw new RangeError("nowEpochMs must be a positive safe millisecond value")
  }
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new RangeError("attempt must be a positive safe integer")
  }
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive safe integer")
  }
  if (!isPositiveSafeMillisecond(input.baseDelayMs)) {
    throw new RangeError("baseDelayMs must be a positive safe millisecond value")
  }
  if (!isPositiveSafeMillisecond(input.maxDelayMs)) {
    throw new RangeError("maxDelayMs must be a positive safe millisecond value")
  }
  if (
    input.serverMinimumDelayMs !== undefined &&
    input.serverMinimumDelayMs !== null &&
    (!Number.isSafeInteger(input.serverMinimumDelayMs) ||
      input.serverMinimumDelayMs < 1)
  ) {
    throw new RangeError(
      "serverMinimumDelayMs must be a positive safe integer",
    )
  }
  const horizonEpochMs = Date.parse(input.horizonAt)
  if (!Number.isFinite(horizonEpochMs)) {
    throw new RangeError("horizonAt must be a finite timestamp")
  }
  const timing = {
    reason: input.reason,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    lastAttemptAt: new Date(Math.min(nowEpochMs, horizonEpochMs)).toISOString(),
    horizonAt: new Date(horizonEpochMs).toISOString(),
  }
  const sanitizedServerMinimum =
    input.serverMinimumDelayMs !== undefined &&
    input.serverMinimumDelayMs !== null
      ? { serverMinimumDelayMs: input.serverMinimumDelayMs }
      : {}
  if (input.attempt >= input.maxAttempts || nowEpochMs >= horizonEpochMs) {
    return retryAdviceSchema.parse({
      ...timing,
      state: "exhausted",
      computedDelayMs: input.serverMinimumDelayMs ?? null,
      nextAttemptAt: null,
      ...sanitizedServerMinimum,
    })
  }
  const remainingHorizonMs = horizonEpochMs - nowEpochMs
  if (
    input.serverMinimumDelayMs !== undefined &&
    input.serverMinimumDelayMs !== null &&
    input.serverMinimumDelayMs > remainingHorizonMs
  ) {
    return retryAdviceSchema.parse({
      ...timing,
      state: "exhausted",
      computedDelayMs: input.serverMinimumDelayMs,
      nextAttemptAt: null,
      ...sanitizedServerMinimum,
    })
  }
  const cap = Math.min(
    input.maxDelayMs,
    input.baseDelayMs * 2 ** (input.attempt - 1),
  )
  const random = dependencies.random()
  if (!Number.isFinite(random) || random < 0 || random >= 1) {
    throw new RangeError("random must be in [0, 1)")
  }
  const serverMinimumDelayMs = input.serverMinimumDelayMs
  const computedDelayMs =
    serverMinimumDelayMs !== undefined &&
    serverMinimumDelayMs !== null &&
    serverMinimumDelayMs > 0
      ? serverMinimumDelayMs +
        Math.floor(
          random *
            Math.max(1, Math.min(1_000, Math.floor(serverMinimumDelayMs * 0.05))),
        ) +
        1
      : Math.max(1, Math.floor(random * cap))

  if (computedDelayMs > remainingHorizonMs) {
    return retryAdviceSchema.parse({
      ...timing,
      state: "exhausted",
      computedDelayMs,
      nextAttemptAt: null,
      ...sanitizedServerMinimum,
    })
  }

  return retryAdviceSchema.parse({
    ...timing,
    state: "scheduled",
    computedDelayMs,
    ...sanitizedServerMinimum,
    nextAttemptAt: new Date(nowEpochMs + computedDelayMs).toISOString(),
  })
}
