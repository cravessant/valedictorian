import { describe, expect, it } from "vitest"
import { connectorRunSummarySchema } from "@sparxie/sdk"

import {
  sanitizeConnectorRefreshStats,
  sanitizeConnectorSynchronization,
  type ConnectorAuthEstablishmentResult,
} from "./index.js"

const secretDiagnostic = "secret-core-outcome-canary"
const executionScopeId = "connector.validation"

const nonCaughtUpOutcomes = [
  { kind: "in_progress" },
  { kind: "failed", reason: "connector_execution_failed" },
  { kind: "cancelled", reason: "cancelled" },
  { kind: "yielded", reason: "invocation_budget" },
  {
    kind: "cooling_down",
    operation: {
      kind: "scope_rate_limited",
      executionScopeId,
      retryAt: "2026-07-18T01:00:00.000Z",
      serverMinimumDelayMs: 60_000,
    },
  },
  {
    kind: "action_required",
    operation: {
      kind: "authentication_expired",
      executionScopeId,
      requestRefresh: true,
    },
  },
  { kind: "boundary_exhausted" },
  { kind: "source_exhausted" },
] as const

describe("connector core — sanitized outcomes", () => {
  it("keeps host session-coordination reasons compatible with the app executor", () => {
    const outcomes = [
      { status: "failed", reason: "source_execution_scope_mismatch" },
      { status: "failed", reason: "source_session_host_unavailable" },
      { status: "failed", reason: "session_refresh_failed" },
      { status: "failed", reason: "source_session_generation_missing" },
      { status: "action_required", reason: "source_action_required" },
      { status: "rate_limited", reason: "source_scope_cooldown" },
      {
        status: "retryable",
        reason: "source_refresh_in_progress",
        retryReason: "server_failure",
      },
    ] as const satisfies readonly ConnectorAuthEstablishmentResult[]

    expect(outcomes.map(({ reason }) => reason)).toEqual([
      "source_execution_scope_mismatch",
      "source_session_host_unavailable",
      "session_refresh_failed",
      "source_session_generation_missing",
      "source_action_required",
      "source_scope_cooldown",
      "source_refresh_in_progress",
    ])
  })

  it("runtime-closes stopReason and drops arbitrary adapter stats", () => {
    const stats = sanitizeConnectorRefreshStats({
      observations: 3,
      attempted: 2,
      stopReason: secretDiagnostic,
      providerBody: secretDiagnostic,
    })

    expect(stats).toEqual({
      observations: 3,
      attempted: 2,
      stopReason: "failed",
    })
    expect(JSON.stringify(stats)).not.toContain(secretDiagnostic)
  })

  it("validates malicious aggregate counts independently", () => {
    expect(sanitizeConnectorRefreshStats({
      observations: -1,
      providerReturned: 1,
      providerValid: 50,
      providerInvalid: Number.MAX_VALUE,
    })).toEqual({
      observations: 0,
      providerReturned: 1,
      providerValid: 50,
      providerInvalid: 0,
    })
  })

  it.each(nonCaughtUpOutcomes)(
    "removes fully caught-up progress from $kind synchronization",
    (outcome) => {
      const synchronization = sanitizeConnectorSynchronization({
        newestFrontier: { state: "caught_up" },
        historicalBackfill: {
          state: "caught_up",
          boundary: { earliestDate: "2026-07-01" },
        },
        pendingResolutionCount: 0,
        outcome,
      })
      const fullyCaughtUp =
        synchronization.newestFrontier.state === "caught_up" &&
        synchronization.historicalBackfill.state === "caught_up" &&
        synchronization.pendingResolutionCount === 0

      expect(fullyCaughtUp).toBe(false)
      expect(connectorRunSummarySchema.safeParse({
        id: "connector-refresh-validation",
        connectorInstanceId: "connector-refresh-validation",
        executionScopeId,
        status: runStatusFor(synchronization.outcome.kind),
        filterSignature: "connector-refresh-validation",
        observationCount: 0,
        warningCount: 0,
        warnings: [],
        ...synchronization,
        startedAt: "2026-07-18T00:00:00.000Z",
        completedAt: synchronization.outcome.kind === "in_progress"
          ? null
          : "2026-07-18T00:00:01.000Z",
        mode: "manual",
        scheduleOccurrence: null,
      }).success).toBe(true)
    },
  )

  it("canonicalizes caught-up progress in the public projector", () => {
    expect(sanitizeConnectorSynchronization({
      newestFrontier: { state: "not_started" },
      historicalBackfill: {
        state: "advancing",
        boundary: { earliestDate: "2026-07-01" },
      },
      pendingResolutionCount: 7,
      outcome: { kind: "caught_up" },
    })).toEqual({
      newestFrontier: { state: "caught_up" },
      historicalBackfill: {
        state: "caught_up",
        boundary: { earliestDate: "2026-07-01" },
      },
      pendingResolutionCount: 0,
      outcome: { kind: "caught_up" },
    })
  })

  it("rejects an impossible historical boundary date", () => {
    const synchronization = sanitizeConnectorSynchronization({
      newestFrontier: { state: "advancing" },
      historicalBackfill: {
        state: "advancing",
        boundary: { earliestDate: "2026-99-99" },
      },
      pendingResolutionCount: 0,
      outcome: { kind: "yielded", reason: "invocation_budget" },
    })

    expect(synchronization.historicalBackfill.boundary.earliestDate).toBe(
      "1970-01-01",
    )
  })
})

function runStatusFor(
  outcome: ReturnType<typeof sanitizeConnectorSynchronization>["outcome"]["kind"],
): "running" | "completed" | "failed" | "cancelled" {
  if (outcome === "in_progress") return "running"
  if (outcome === "failed") return "failed"
  if (outcome === "cancelled") return "cancelled"
  return "completed"
}
