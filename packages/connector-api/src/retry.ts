import { z } from "zod"

export const transientRetryReasons = [
  "rate_limit",
  "server_failure",
  "network_interruption",
  "operation_timeout",
] as const

export type TransientRetryReason = (typeof transientRetryReasons)[number]

export const retryAdviceStates = [
  "scheduled",
  "not_due",
  "exhausted",
  "cancelled",
] as const

export type RetryAdviceState = (typeof retryAdviceStates)[number]

export interface RetryTiming {
  reason: TransientRetryReason
  attempt: number
  maxAttempts: number
  lastAttemptAt: string
  horizonAt: string
}

interface SchedulableRetryAdvice extends RetryTiming {
  computedDelayMs: number
  serverMinimumDelayMs?: number | null
  nextAttemptAt: string
}

export interface ScheduledRetryAdvice extends SchedulableRetryAdvice {
  state: "scheduled"
}

export interface NotDueRetryAdvice extends SchedulableRetryAdvice {
  state: "not_due"
}

interface TerminalRetryAdvice extends RetryTiming {
  computedDelayMs: number | null
  serverMinimumDelayMs?: number | null
  nextAttemptAt: null
}

export interface ExhaustedRetryAdvice extends TerminalRetryAdvice {
  state: "exhausted"
}

export interface CancelledRetryAdvice extends TerminalRetryAdvice {
  state: "cancelled"
}

export type RetryAdvice =
  | ScheduledRetryAdvice
  | NotDueRetryAdvice
  | ExhaustedRetryAdvice
  | CancelledRetryAdvice

const retryTimestampSchema = z.iso.datetime({ offset: true, precision: 3 })

const retryAdviceBaseShape = {
  reason: z.enum(transientRetryReasons),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  lastAttemptAt: retryTimestampSchema,
  horizonAt: retryTimestampSchema,
}

const delayShape = {
  computedDelayMs: z.number().int().nonnegative(),
  serverMinimumDelayMs: z.number().int().nonnegative().nullable().optional(),
}

export const retryAdviceSchema = z
  .discriminatedUnion("state", [
    z
      .object({
        state: z.literal("scheduled"),
        ...retryAdviceBaseShape,
        ...delayShape,
        computedDelayMs: z.number().int().positive(),
        nextAttemptAt: retryTimestampSchema,
      })
      .strict(),
    z
      .object({
        state: z.literal("not_due"),
        ...retryAdviceBaseShape,
        ...delayShape,
        computedDelayMs: z.number().int().positive(),
        nextAttemptAt: retryTimestampSchema,
      })
      .strict(),
    z
      .object({
        state: z.literal("exhausted"),
        ...retryAdviceBaseShape,
        ...delayShape,
        computedDelayMs: z.number().int().nonnegative().nullable(),
        nextAttemptAt: z.null(),
      })
      .strict(),
    z
      .object({
        state: z.literal("cancelled"),
        ...retryAdviceBaseShape,
        ...delayShape,
        computedDelayMs: z.number().int().nonnegative().nullable(),
        nextAttemptAt: z.null(),
      })
      .strict(),
  ])
  .superRefine((advice, context) => {
    const lastAttemptAt = Date.parse(advice.lastAttemptAt)
    const horizonAt = Date.parse(advice.horizonAt)

    if (advice.attempt > advice.maxAttempts) {
      context.addIssue({
        code: "custom",
        message: "retry attempt cannot exceed the maximum",
        path: ["attempt"],
      })
    }

    if (
      advice.serverMinimumDelayMs !== undefined &&
      advice.serverMinimumDelayMs !== null &&
      (advice.computedDelayMs === null ||
        advice.serverMinimumDelayMs > advice.computedDelayMs)
    ) {
      context.addIssue({
        code: "custom",
        message: "computed delay cannot be shorter than the server minimum",
        path: ["serverMinimumDelayMs"],
      })
    }

    if (lastAttemptAt > horizonAt) {
      context.addIssue({
        code: "custom",
        message: "last attempt cannot be after the retry horizon",
        path: ["lastAttemptAt"],
      })
    }

    if (advice.state === "exhausted" || advice.state === "cancelled") {
      return
    }

    const nextAttemptAt = Date.parse(advice.nextAttemptAt)

    if (advice.attempt >= advice.maxAttempts) {
      context.addIssue({
        code: "custom",
        message: "schedulable retry advice requires remaining attempts",
        path: ["attempt"],
      })
    }

    if (nextAttemptAt !== lastAttemptAt + advice.computedDelayMs) {
      context.addIssue({
        code: "custom",
        message: "next attempt must equal the last attempt plus the computed delay",
        path: ["nextAttemptAt"],
      })
    }

    if (nextAttemptAt > horizonAt) {
      context.addIssue({
        code: "custom",
        message: "next attempt cannot exceed the retry horizon",
        path: ["nextAttemptAt"],
      })
    }
  }) as unknown as z.ZodType<RetryAdvice>
