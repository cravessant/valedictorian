import { describe, expect, it } from "vitest"

import {
  ConnectorExecutionError,
  type JobConnector,
} from "@sparxie/valedictorian-connectors-core"
import { createInMemoryConnectorHost } from "./index.js"
import { sanitizeConnectorRunLifecycle } from "./result-sanitizers.js"
import { emptyRefreshResult } from "./test-support/in-memory-host-fixtures.js"

const secretDiagnostic = "secret-thrown-adapter-diagnostic"

describe("in-memory connector host — sanitized adapter failures", () => {
  it("replaces adapter-supplied auth reasons with closed status facts", async () => {
    const connector: JobConnector = {
      definition: { id: "fixture.auth-reason", version: "1.0.0" },
      async refresh(input) {
        return emptyRefreshResult(input)
      },
      async validateAuth() {
        return {
          status: "retryable",
          reason: secretDiagnostic,
        } as never
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_auth_reason",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Auth reason fixture",
      enabled: true,
      createdAt: "2026-07-18T00:00:00.000Z",
    })

    const result = await host.validateAuth(connector, {
      connectorInstanceId: "instance_auth_reason",
      workspaceId: "workspace_alpha",
    })

    expect(result).toEqual({
      status: "retryable",
      reason: "jobright_auth_request_failed",
    })
    expect(JSON.stringify(result)).not.toContain(secretDiagnostic)
  })

  it("replaces adapter-supplied warning copy with canonical copy", async () => {
    const connector: JobConnector = {
      definition: { id: "fixture.warning", version: "1.0.0" },
      async refresh(input) {
        return {
          ...emptyRefreshResult(input),
          warnings: [{
            code: "connector.execution_failed",
            message: secretDiagnostic,
          }],
        } as unknown as ReturnType<typeof emptyRefreshResult>
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_warning",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Warning fixture",
      enabled: true,
      createdAt: "2026-07-18T00:00:00.000Z",
    })

    const run = await host.refresh(connector, {
      connectorInstanceId: "instance_warning",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-18T00:00:00.000Z",
      },
    })

    expect(run.warnings).toEqual([{
      code: "connector.execution_failed",
      message: "Connector execution failed before completion.",
    }])
    expect(JSON.stringify({ run, snapshot: host.snapshot() })).not.toContain(
      secretDiagnostic,
    )
  })

  it("reconciles malicious adapter stats with the projected batch", async () => {
    const connector: JobConnector = {
      definition: { id: "fixture.stats", version: "1.0.0" },
      async refresh(input) {
        return {
          ...emptyRefreshResult(input),
          stats: {
            observations: 999,
            providerReturned: 1,
            providerValid: 50,
            providerInvalid: Number.MAX_VALUE,
            stopReason: secretDiagnostic,
            providerBody: secretDiagnostic,
          },
        } as never
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_stats",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Stats fixture",
      enabled: true,
      createdAt: "2026-07-18T00:00:00.000Z",
    })

    const run = await host.refresh(connector, {
      connectorInstanceId: "instance_stats",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-18T00:00:00.000Z",
      },
    })

    expect(run.stats).toEqual({
      observations: 0,
      providerReturned: 1,
      providerValid: 50,
      providerInvalid: 0,
      stopReason: "failed",
    })
    expect(host.snapshot().observations).toHaveLength(0)
    expect(JSON.stringify({ run, snapshot: host.snapshot() })).not.toContain(
      secretDiagnostic,
    )
  })

  it("runtime-closes adapter status and retry advice before persistence", async () => {
    const connector: JobConnector = {
      definition: { id: "fixture.result-canaries", version: "1.0.0" },
      async refresh(input) {
        return {
          ...emptyRefreshResult(input),
          status: secretDiagnostic,
          retryHints: {
            state: "scheduled",
            reason: secretDiagnostic,
            attempt: 1,
            maxAttempts: 3,
            lastAttemptAt: "2026-07-18T00:00:00.000Z",
            computedDelayMs: 1_000,
            nextAttemptAt: "2026-07-18T00:00:01.000Z",
            horizonAt: "2026-07-19T00:00:00.000Z",
            providerBody: secretDiagnostic,
          },
        } as never
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_result_canaries",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Result canary fixture",
      enabled: true,
      createdAt: "2026-07-18T00:00:00.000Z",
    })

    const run = await host.refresh(connector, {
      connectorInstanceId: "instance_result_canaries",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-18T00:00:00.000Z",
      },
    })

    expect(run.status).toBe("failed")
    expect(run.retryHints).toBeNull()
    expect(run.synchronization.outcome).toEqual({
      kind: "failed",
      reason: "connector_execution_failed",
    })
    expect(JSON.stringify({ run, snapshot: host.snapshot() })).not.toContain(
      secretDiagnostic,
    )
  })

  it("runtime-projects result coverage without provider strings", async () => {
    const validEnd = "2026-07-18T00:00:00.000Z"
    const connector: JobConnector = {
      definition: { id: "fixture.coverage-canary", version: "1.0.0" },
      async refresh(input) {
        return {
          ...emptyRefreshResult(input),
          coverage: {
            start: secretDiagnostic,
            end: validEnd,
            providerBody: secretDiagnostic,
          },
        } as never
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_coverage_canary",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Coverage canary fixture",
      enabled: true,
      createdAt: validEnd,
    })

    const run = await host.refresh(connector, {
      connectorInstanceId: "instance_coverage_canary",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: validEnd, end: validEnd },
    })

    expect(run.coverage).toEqual({ start: null, end: validEnd })
    expect(JSON.stringify({ run, snapshot: host.snapshot() })).not.toContain(
      secretDiagnostic,
    )
  })

  it("persists a closed failed run and rejects without consuming retry work", async () => {
    const connector: JobConnector = {
      definition: { id: "fixture.throwing", version: "1.0.0" },
      async refresh() {
        throw new Error(secretDiagnostic)
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_throwing",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Throwing fixture",
      enabled: true,
      createdAt: "2026-07-18T00:00:00.000Z",
    })

    const settlement = host.refresh(connector, {
      connectorInstanceId: "instance_throwing",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-18T00:00:00.000Z",
      },
    })

    const error = await settlement.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConnectorExecutionError)
    expect(error).toMatchObject({
      code: "connector_execution_failed",
      message: "Connector execution failed before completion.",
    })
    const snapshot = host.snapshot()
    expect(snapshot.runs).toHaveLength(1)
    expect(snapshot.runs[0]).toMatchObject({
      status: "failed",
      retryHints: null,
    })
    expect(snapshot.runs[0]?.warnings).toEqual([{
      code: "connector.execution_failed",
      message: "Connector execution failed before completion.",
    }])
    expect(snapshot.checkpoints).toEqual([])
    expect(JSON.stringify({ error, snapshot })).not.toContain(
      secretDiagnostic,
    )
  })

  it("persists caller-driven cancellation as cancellation", async () => {
    const controller = new AbortController()
    const connector: JobConnector = {
      definition: { id: "fixture.cancelled", version: "1.0.0" },
      async refresh() {
        controller.abort(secretDiagnostic)
        throw new DOMException(secretDiagnostic, "AbortError")
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_cancelled",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Cancelled fixture",
      enabled: true,
      createdAt: "2026-07-18T00:00:00.000Z",
    })

    const run = await host.refresh(connector, {
      connectorInstanceId: "instance_cancelled",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-18T00:00:00.000Z",
      },
      signal: controller.signal,
    })

    expect(run.status).toBe("cancelled")
    expect(run.warnings).toEqual([])
    expect(JSON.stringify({ run, snapshot: host.snapshot() })).not.toContain(
      secretDiagnostic,
    )
  })

  it.each([
    {
      adapterOutcome: { kind: "failed", reason: secretDiagnostic },
      persistedOutcome: {
        kind: "failed",
        reason: "connector_execution_failed",
      },
      status: "failed" as const,
    },
    {
      adapterOutcome: { kind: "cancelled", reason: secretDiagnostic },
      persistedOutcome: { kind: "cancelled", reason: "cancelled" },
      status: "cancelled" as const,
    },
  ])("sanitizes an arbitrary $status synchronization reason before persistence", async ({
    adapterOutcome,
    persistedOutcome,
    status,
  }) => {
    const connector: JobConnector = {
      definition: { id: `fixture.sync-${status}`, version: "1.0.0" },
      async refresh(input) {
        return {
          ...emptyRefreshResult(input),
          status,
          synchronization: {
            ...emptyRefreshResult(input).synchronization,
            outcome: adapterOutcome,
          },
        } as never
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: `instance_sync_${status}`,
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Synchronization fixture",
      enabled: true,
      createdAt: "2026-07-18T00:00:00.000Z",
    })

    const run = await host.refresh(connector, {
      connectorInstanceId: `instance_sync_${status}`,
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-18T00:00:00.000Z",
      },
    })

    expect(run.synchronization?.outcome).toEqual(persistedOutcome)
    expect(JSON.stringify({ run, snapshot: host.snapshot() })).not.toContain(
      secretDiagnostic,
    )
  })

  it.each([
    {
      id: "null-observations",
      mutate(result: Record<string, unknown>) {
        result.observations = null
      },
    },
    {
      id: "throwing-status",
      mutate(result: Record<string, unknown>) {
        Object.defineProperty(result, "status", {
          get() {
            throw new Error(secretDiagnostic)
          },
        })
      },
    },
    {
      id: "malformed-observation",
      mutate(result: Record<string, unknown>) {
        result.observations = [{ sourceRecordKey: "fixture:incomplete" }]
      },
    },
  ])("atomically rejects a malformed $id result", async ({ id, mutate }) => {
    const connector: JobConnector = {
      definition: { id: `fixture.${id}`, version: "1.0.0" },
      async refresh(input) {
        const result = emptyRefreshResult(input) as unknown as Record<
          string,
          unknown
        >
        mutate(result)
        return result as never
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: `instance_${id}`,
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Malformed result fixture",
      enabled: true,
      createdAt: "2026-07-18T00:00:00.000Z",
    })

    const error = await host.refresh(connector, {
      connectorInstanceId: `instance_${id}`,
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-18T00:00:00.000Z",
      },
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConnectorExecutionError)
    expect(error).toMatchObject({
      code: "connector_execution_failed",
      message: "Connector execution failed before completion.",
    })
    const snapshot = host.snapshot()
    expect(snapshot.runs).toHaveLength(1)
    expect(snapshot.runs[0]).toMatchObject({ status: "failed" })
    expect(snapshot.checkpoints).toEqual([])
    expect(snapshot.observations).toEqual([])
    expect(JSON.stringify({ error, snapshot })).not.toContain(secretDiagnostic)
  })

  it("does not partially commit observations when later projection fails", async () => {
    const connector: JobConnector = {
      definition: { id: "fixture.partial-observations", version: "1.0.0" },
      async refresh(input) {
        const hostileObservation = {}
        Object.defineProperty(hostileObservation, "sourceRecordKey", {
          enumerable: true,
          get() {
            throw new Error(secretDiagnostic)
          },
        })
        return {
          ...emptyRefreshResult(input),
          observations: [
            { sourceRecordKey: "fixture:first" },
            hostileObservation,
          ],
        } as never
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_partial_observations",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Partial observation fixture",
      enabled: true,
      createdAt: "2026-07-18T00:00:00.000Z",
    })

    const error = await host.refresh(connector, {
      connectorInstanceId: "instance_partial_observations",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-18T00:00:00.000Z",
      },
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConnectorExecutionError)
    const snapshot = host.snapshot()
    expect(snapshot.runs).toHaveLength(1)
    expect(snapshot.runs[0]).toMatchObject({ status: "failed" })
    expect(snapshot.checkpoints).toEqual([])
    expect(snapshot.observations).toEqual([])
    expect(JSON.stringify({ error, snapshot })).not.toContain(secretDiagnostic)
  })

  it("replaces an auth result accessor failure with a fixed error", async () => {
    const connector: JobConnector = {
      definition: { id: "fixture.auth-accessor", version: "1.0.0" },
      async refresh(input) {
        return emptyRefreshResult(input)
      },
      async validateAuth() {
        const result = {}
        Object.defineProperty(result, "status", {
          get() {
            throw new Error(secretDiagnostic)
          },
        })
        return result as never
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_auth_accessor",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Auth accessor fixture",
      enabled: true,
      createdAt: "2026-07-18T00:00:00.000Z",
    })

    const error = await host.validateAuth(connector, {
      connectorInstanceId: "instance_auth_accessor",
      workspaceId: "workspace_alpha",
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConnectorExecutionError)
    expect(error).toMatchObject({
      code: "connector_execution_failed",
      message: "Connector execution failed before completion.",
    })
    expect(JSON.stringify(error)).not.toContain(secretDiagnostic)
  })

  it("downgrades fully caught-up frontiers for every non-caught-up outcome", async () => {
    const connector: JobConnector = {
      definition: { id: "fixture.yielded-frontiers", version: "1.0.0" },
      async refresh(input) {
        return {
          ...emptyRefreshResult(input),
          synchronization: {
            ...emptyRefreshResult(input).synchronization,
            outcome: { kind: "yielded", reason: "invocation_budget" },
          },
        }
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_yielded_frontiers",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Yielded frontier fixture",
      enabled: true,
      createdAt: "2026-07-18T00:00:00.000Z",
    })

    const run = await host.refresh(connector, {
      connectorInstanceId: "instance_yielded_frontiers",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-18T00:00:00.000Z",
      },
    })

    expect(run.synchronization).toMatchObject({
      newestFrontier: { state: "advancing" },
      historicalBackfill: { state: "advancing" },
      pendingResolutionCount: 0,
      outcome: { kind: "yielded", reason: "invocation_budget" },
    })
  })

  it("prevents every non-caught-up outcome from retaining caught-up frontiers", () => {
    const outcomes = [
      { kind: "in_progress" },
      { kind: "failed", reason: "connector_execution_failed" },
      { kind: "cancelled", reason: "cancelled" },
      { kind: "yielded", reason: "operation_timeout" },
      {
        kind: "cooling_down",
        operation: {
          kind: "scope_rate_limited",
          executionScopeId: "connector.fixture",
          retryAt: "2026-07-18T00:01:00.000Z",
          serverMinimumDelayMs: 60_000,
        },
      },
      {
        kind: "action_required",
        operation: {
          kind: "authentication_expired",
          executionScopeId: "connector.fixture",
          requestRefresh: true,
        },
      },
      { kind: "boundary_exhausted" },
      { kind: "source_exhausted" },
    ]

    for (const outcome of outcomes) {
      const lifecycle = sanitizeConnectorRunLifecycle("completed", {
        newestFrontier: { state: "caught_up" },
        historicalBackfill: {
          state: "caught_up",
          boundary: { earliestDate: "2026-07-01" },
        },
        pendingResolutionCount: 0,
        outcome,
      })
      const synchronization = lifecycle.synchronization
      expect(synchronization.outcome.kind).not.toBe("caught_up")
      expect(
        synchronization.newestFrontier.state === "caught_up" &&
          synchronization.historicalBackfill.state === "caught_up" &&
          synchronization.pendingResolutionCount === 0,
      ).toBe(false)
    }
  })
})
