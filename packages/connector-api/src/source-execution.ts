import { z } from "zod"
import {
  retryAdviceSchema,
  type NotDueRetryAdvice,
  type ScheduledRetryAdvice,
} from "./retry.js"

/** Opaque host-derived identity for one provider auth and rate-limit domain. */
export type SourceExecutionScopeId = string

export const sourceExecutionScopeIdSchema = z
  .string()
  .min(8)
  .max(256)
  .regex(/^[A-Za-z0-9._~-]+$/)

export type SourceOperationOutcome =
  | {
      kind: "authentication_expired"
      executionScopeId: SourceExecutionScopeId
      requestRefresh: true
    }
  | {
      kind: "scope_rate_limited"
      executionScopeId: SourceExecutionScopeId
      retryAt: string
      serverMinimumDelayMs: number | null
    }
  | {
      kind: "item_transient"
      retry: ItemTransientRetryAdvice
    }
  | { kind: "item_permanent"; reason: string }

export type ItemTransientRetryReason = Exclude<
  ScheduledRetryAdvice["reason"],
  "rate_limit"
>

export type ItemTransientRetryAdvice =
  | (Omit<ScheduledRetryAdvice, "reason" | "serverMinimumDelayMs"> & {
      reason: ItemTransientRetryReason
      serverMinimumDelayMs?: null
    })
  | (Omit<NotDueRetryAdvice, "reason" | "serverMinimumDelayMs"> & {
      reason: ItemTransientRetryReason
      serverMinimumDelayMs?: null
    })

export const itemTransientRetryAdviceSchema: z.ZodType<ItemTransientRetryAdvice> =
  retryAdviceSchema.refine(
    (value): value is ItemTransientRetryAdvice =>
      (value.state === "scheduled" || value.state === "not_due") &&
      value.reason !== "rate_limit" &&
      (value.serverMinimumDelayMs === undefined || value.serverMinimumDelayMs === null),
    { message: "item retry advice cannot carry scope cooldown authority" },
  )

export const sourceOperationOutcomeSchema: z.ZodType<SourceOperationOutcome> =
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("authentication_expired"),
      executionScopeId: sourceExecutionScopeIdSchema,
      requestRefresh: z.literal(true),
    }).strict(),
    z.object({
      kind: z.literal("scope_rate_limited"),
      executionScopeId: sourceExecutionScopeIdSchema,
      retryAt: z.iso.datetime({ offset: true }),
      serverMinimumDelayMs: z.number().int().nonnegative().nullable(),
    }).strict(),
    z.object({
      kind: z.literal("item_transient"),
      retry: itemTransientRetryAdviceSchema,
    }).strict(),
    z.object({
      kind: z.literal("item_permanent"),
      reason: z.string().min(1).max(512),
    }).strict(),
  ])
