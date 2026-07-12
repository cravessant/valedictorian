import { describe, expect, it } from "vitest"

import {
  createInMemoryConnectorHost,
} from "./index.js"
import type {
  ConnectorProgressSnapshot,
  ConnectorRefreshResult,
  JobConnector,
} from "@sparxie/valedictorian-connectors-core"
import { emptyRefreshResult } from "./test-support/in-memory-host-fixtures.js"

describe("in-memory connector host — progress", () => {
  it("records partial-success connector results with retry hints", async () => {
    const connector: JobConnector = {
      definition: {
        id: "fixture.partial-jobs",
        version: "0.0.0-fixture",
      },
      async refresh(input): Promise<ConnectorRefreshResult> {
        return {
          status: "completed",
          observations: [],
          nextCheckpoint: {
            checkpoint: {
              cursor: "partial-cursor",
            },
            schemaVersion: "fixture-checkpoint@1",
          },
          coverage: input.coverage,
          stats: {
            observations: 0,
          },
          warnings: [],
          operationOutcome: null,
          synchronization: {
            newestFrontier: { state: "advancing" },
            historicalBackfill: { state: "advancing", boundary: { earliestDate: input.coverage.start.slice(0, 10) } },
            pendingResolutionCount: 1,
            outcome: { kind: "yielded", reason: "invocation_budget" },
          },
          retryHints: {
            state: "scheduled",
            reason: "server_failure",
            attempt: 1,
            maxAttempts: 3,
            lastAttemptAt: "2026-07-08T15:00:00.000Z",
            computedDelayMs: 1_000,
            nextAttemptAt: "2026-07-08T15:00:01.000Z",
            horizonAt: "2026-07-09T15:00:00.000Z",
          },
        }
      },
    }
    const host = createInMemoryConnectorHost()

    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_partial",
      workspaceId: "workspace_alpha",
      displayName: "Partial jobs",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    const run = await host.refresh(connector, {
      connectorInstanceId: "instance_partial",
      workspaceId: "workspace_alpha",
      mode: "catch_up",
      coverage: {
        start: "2026-07-08T15:00:00.000Z",
        end: "2026-07-08T16:00:00.000Z",
      },
    })

    expect(run).toMatchObject({
      status: "completed",
      retryHints: {
        state: "scheduled",
        reason: "server_failure",
      },
    })
  })

  it("forwards optional sanitized connector progress snapshots", async () => {
    const snapshots: ConnectorProgressSnapshot[] = []
    const connector: JobConnector = {
      definition: {
        id: "fixture.progress",
        version: "0.0.0-fixture",
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        const counts = {
          attempted: 0,
          discovered: 0,
          eligible: 0,
          filtered: 0,
          resolvedEmployerOrAts: 0,
          resolvedThirdParty: 0,
          skipped: 0,
          unresolved: 0,
        }
        await runtime.progress?.report({ stage: "authenticating", counts })
        await runtime.progress?.report({ stage: "finalizing", counts })
        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost({
      async progress(snapshot) {
        await Promise.resolve()
        snapshots.push(structuredClone(snapshot))
      },
    })
    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_progress",
      workspaceId: "workspace_alpha",
      displayName: "Progress fixture",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_progress",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T15:00:00.000Z",
        end: "2026-07-08T16:00:00.000Z",
      },
    })

    expect(snapshots.map((snapshot) => snapshot.stage)).toEqual([
      "authenticating",
      "finalizing",
    ])
  })

  it("forwards a per-run cancellation signal through the runtime", async () => {
    const controller = new AbortController()
    const connector: JobConnector = {
      definition: {
        id: "fixture.cancellation",
        version: "0.0.0-fixture",
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        expect(runtime.cancellation?.signal).toBe(controller.signal)
        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_cancellation",
      workspaceId: "workspace_alpha",
      displayName: "Cancellation fixture",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_cancellation",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T15:00:00.000Z",
        end: "2026-07-08T16:00:00.000Z",
      },
      signal: controller.signal,
    })
  })
})
