import { describe, expect, it } from "vitest"

import {
  createFixtureConnector,
  createInMemoryConnectorHost,
} from "./index.js"
import type {
  ConnectorRefreshResult,
  JobConnector,
} from "@sparxie/valedictorian-connectors-core"
import { emptyRefreshResult } from "./test-support/in-memory-host-fixtures.js"

describe("in-memory connector host — core", () => {
  it("exposes connector definition metadata for host validation and policy", () => {
    const connector = createFixtureConnector({
      observedAt: "2026-07-08T16:00:00.000Z",
    })

    expect(connector.definition).toMatchObject({
      observation: {
        schemaVersion: "job-observation@1",
      },
      configSchema: {
        version: "fixture-config@1",
        schema: expect.objectContaining({
          type: "object",
        }),
      },
      filterSchema: {
        version: "fixture-filters@1",
        schema: expect.objectContaining({
          type: "object",
        }),
      },
      auth: {
        modes: ["none"],
      },
      capabilities: {
        fetchesPublicPages: false,
        supportsFiltering: true,
        supportsIncrementalRefresh: true,
      },
      checkpoint: {
        schemaVersion: "fixture-checkpoint@1",
      },
      politeness: {
        concurrency: 1,
        maxBackfillDays: 7,
      },
    })
  })

  it("runs a fixture connector and records host-owned run state", async () => {
    const observedAt = "2026-07-08T16:00:00.000Z"
    const connector = createFixtureConnector({ observedAt })
    const host = createInMemoryConnectorHost()

    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_fixture",
      workspaceId: "workspace_alpha",
      displayName: "Fixture jobs",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    const run = await host.refresh(connector, {
      connectorInstanceId: "instance_fixture",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: observedAt,
      },
    })

    expect(run.status).toBe("completed")
    expect(run.stats.observations).toBe(1)
    expect(run.coverage).toEqual({
      start: "2026-07-01T00:00:00.000Z",
      end: observedAt,
    })

    const snapshot = host.snapshot()

    expect(snapshot.instances).toHaveLength(1)
    expect(snapshot.runs).toHaveLength(1)
    expect(snapshot.checkpoints).toEqual([
      {
        connectorInstanceId: "instance_fixture",
        filterSignature: "filters:{}",
        checkpoint: { cursor: "fixture:2026-07-08T16:00:00.000Z" },
        schemaVersion: "fixture-checkpoint@1",
      },
    ])
    expect(snapshot.observations).toHaveLength(1)
    expect(snapshot.observations[0]).toMatchObject({
      connectorId: "fixture.jobs",
      connectorVersion: "0.0.0-fixture",
      parserVersion: "fixture-parser@1",
      observationSchemaVersion: "job-observation@1",
      connectorInstanceId: "instance_fixture",
      sourceRecordKey: "fixture.jobs:software-engineering-intern",
      companyName: "Example Robotics",
      roleTitle: "Software Engineering Intern",
      observedAt,
      links: {
        source: "https://example.test/jobs/software-engineering-intern",
        intermediary: null,
        official: "https://example.test/apply/software-engineering-intern",
      },
      resolution: {
        status: "resolved",
        method: "fixture",
        reason: null,
      },
      dedupeKeys: [
        "official:https://example.test/apply/software-engineering-intern",
        "source:fixture.jobs:software-engineering-intern",
      ],
    })
    expect(snapshot.observations[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "fixture",
          capturedAt: observedAt,
          sourceUrl: "https://example.test/jobs/software-engineering-intern",
        }),
      ]),
    )
  })

  it("binds connector lineage and acknowledges raw records through the host runtime", async () => {
    const observedAt = "2026-07-08T16:00:00.000Z"
    const connector: JobConnector = {
      definition: {
        id: "fixture.raw-jobs",
        version: "0.0.0-fixture",
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        if (!runtime.rawSourceIntake) {
          throw new Error("raw source intake is required")
        }
        const receipt = await runtime.rawSourceIntake.capture({
          observedAt,
          providerRecordId: "provider-job-1",
          providerSchema: "fixture-provider@1",
          payload: { title: "Software Engineer" },
        })
        expect(receipt.revision.rawRecordId).toBe(receipt.rawRecordId)
        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost()

    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_raw_fixture",
      workspaceId: "workspace_alpha",
      displayName: "Raw fixture jobs",
      enabled: true,
      createdAt: observedAt,
    })
    await host.refresh(connector, {
      connectorInstanceId: "instance_raw_fixture",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: observedAt, end: observedAt },
    })

    expect(host.snapshot().rawCaptures).toEqual([
      expect.objectContaining({
        input: {
          adapter: {
            id: "fixture.raw-jobs",
            kind: "connector",
            version: "0.0.0-fixture",
          },
          capture: {
            connectorInstanceId: "instance_raw_fixture",
            connectorRunId: "run_1",
            executionScopeId: "connector.instance_raw_fixture",
          },
          intakeItemId: "run_1:item:1",
          observedAt,
          providerRecordId: "provider-job-1",
          providerSchema: "fixture-provider@1",
          payload: { title: "Software Engineer" },
        },
      }),
    ])
  })

  it("reuses an unchanged raw revision while appending re-observation occurrences", async () => {
    const observedAt = "2026-07-08T16:00:00.000Z"
    const receipts: import("@sparxie/valedictorian-connectors-core").RawSourceIntakeReceipt[] = []
    const connector: JobConnector = {
      definition: { id: "fixture.reobserved", version: "0.0.0-fixture" },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        if (!runtime.rawSourceIntake) throw new Error("raw intake required")
        receipts.push(
          await runtime.rawSourceIntake.capture({
            observedAt,
            providerRecordId: "provider-job-1",
            providerSchema: "fixture-provider@1",
            payload: { title: "Software Engineer" },
          }),
        )
        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_reobserved",
      workspaceId: "workspace_alpha",
      displayName: "Reobserved raw fixture",
      enabled: true,
      createdAt: observedAt,
    })

    for (let index = 0; index < 2; index += 1) {
      await host.refresh(connector, {
        connectorInstanceId: "instance_reobserved",
        workspaceId: "workspace_alpha",
        mode: "manual",
        coverage: { start: observedAt, end: observedAt },
      })
    }

    expect(receipts).toHaveLength(2)
    expect(receipts[1]).toMatchObject({
      rawRecordId: receipts[0]?.rawRecordId,
      revision: {
        id: receipts[0]?.revision.id,
        revision: 1,
        reused: true,
      },
    })
    expect(receipts[1]?.occurrence.id).not.toBe(receipts[0]?.occurrence.id)
    expect(receipts.map(({ occurrence }) => occurrence.capture?.connectorRunId)).toEqual([
      "run_1",
      "run_2",
    ])
  })

  it("runs trusted resolver outcomes against an acknowledged raw revision", async () => {
    const observedAt = "2026-07-08T16:00:00.000Z"
    const connector: JobConnector = {
      definition: { id: "fixture.resolved-raw", version: "0.0.0-fixture" },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        if (!runtime.rawSourceIntake || !runtime.normalization) {
          throw new Error("raw normalization runtime is required")
        }
        const receipt = await runtime.rawSourceIntake.capture({
          observedAt,
          providerRecordId: "provider-job-1",
          providerSchema: "fixture-provider@1",
          payload: { employmentType: "FT" },
        })
        await runtime.normalization.run({
          rawRevision: receipt.revision,
          resolver: {
            id: "fixture.employment",
            version: "fixture-employment@1",
            requiredInputs: ["payload.employmentType"],
            outputFields: ["employmentType"],
            capabilities: ["pure"],
            costClass: "none",
            precedence: 100,
            scopeRequirement: "none",
          },
          async resolve() {
            return [
              {
                resolverId: "fixture.employment",
                resolverVersion: "fixture-employment@1",
                field: "employmentType",
                inputHash: receipt.revision.contentHash,
                status: "resolved",
                value: "full_time",
                confidence: 1,
              },
            ]
          },
        })
        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_resolved_raw",
      workspaceId: "workspace_alpha",
      displayName: "Resolved raw fixture",
      enabled: true,
      createdAt: observedAt,
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_resolved_raw",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: observedAt, end: observedAt },
    })

    expect(host.snapshot().normalizations).toEqual([
      expect.objectContaining({
        rawRevisionId: "raw_revision_1",
        resolver: expect.objectContaining({
          id: "fixture.employment",
          version: "fixture-employment@1",
        }),
        outcomes: [
          expect.objectContaining({
            field: "employmentType",
            status: "resolved",
            value: "full_time",
          }),
        ],
      }),
    ])
  })

  it("settles host raw persistence before returning the intake acknowledgement", async () => {
    const events: string[] = []
    const observedAt = "2026-07-08T16:00:00.000Z"
    const connector: JobConnector = {
      definition: { id: "fixture.raw-order", version: "0.0.0-fixture" },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        if (!runtime.rawSourceIntake) throw new Error("raw intake required")
        await runtime.rawSourceIntake.capture({ observedAt, payload: { id: 1 } })
        events.push("acknowledged")
        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost({
      async onRawCapture() {
        events.push("persisting")
        await Promise.resolve()
        events.push("persisted")
      },
    })
    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_raw_order",
      workspaceId: "workspace_alpha",
      displayName: "Raw order",
      enabled: true,
      createdAt: observedAt,
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_raw_order",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: observedAt, end: observedAt },
    })

    expect(events).toEqual(["persisting", "persisted", "acknowledged"])
  })

  it("reserves unique run ids before concurrent refreshes complete out of order", async () => {
    let releaseFirst: (() => void) | undefined
    let markFirstCaptured: (() => void) | undefined
    const firstCaptured = new Promise<void>((resolve) => {
      markFirstCaptured = resolve
    })
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const connector: JobConnector = {
      definition: { id: "fixture.concurrent-runs", version: "0.0.0-fixture" },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        if (!runtime.rawSourceIntake) throw new Error("raw intake required")
        await runtime.rawSourceIntake.capture({
          observedAt: input.coverage.end,
          providerRecordId: input.coverage.end,
          payload: { run: input.coverage.end },
        })
        if (input.coverage.end === "first") {
          markFirstCaptured?.()
          await firstGate
          throw new Error("first concurrent refresh failed")
        }
        if (input.coverage.end === "failing") {
          throw new Error("fixture refresh failed")
        }
        return emptyRefreshResult(input)
      },
    }
    let hostTime = Date.parse("2026-07-08T16:00:00.000Z")
    const host = createInMemoryConnectorHost({
      now: () => {
        const timestamp = new Date(hostTime).toISOString()
        hostTime += 1_000
        return timestamp
      },
    })
    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_concurrent_runs",
      workspaceId: "workspace_alpha",
      displayName: "Concurrent runs",
      enabled: true,
      createdAt: "2026-07-08T16:00:00.000Z",
    })

    const first = host.refresh(connector, {
      connectorInstanceId: "instance_concurrent_runs",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: "first", end: "first" },
    })
    await firstCaptured
    await host.refresh(connector, {
      connectorInstanceId: "instance_concurrent_runs",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: "second", end: "second" },
    })
    releaseFirst?.()
    await expect(first).rejects.toThrow("first concurrent refresh failed")

    const snapshot = host.snapshot()
    expect(
      snapshot.rawCaptures.map(({ input }) => ({
        providerRecordId: input.providerRecordId,
        runId: input.capture?.connectorRunId,
      })),
    ).toEqual([
      { providerRecordId: "first", runId: "run_1" },
      { providerRecordId: "second", runId: "run_2" },
    ])
    expect(
      snapshot.runs.map(({ coverage, id, status }) => ({
        end: coverage.end,
        id,
        status,
      })),
    ).toEqual([
      { end: "second", id: "run_2", status: "completed" },
      { end: "first", id: "run_1", status: "failed" },
    ])
    expect(snapshot.runs[0]).toMatchObject({
      id: "run_2",
      startedAt: "2026-07-08T16:00:01.000Z",
      completedAt: "2026-07-08T16:00:02.000Z",
    })
    expect(snapshot.runs[1]).toMatchObject({
      id: "run_1",
      startedAt: "2026-07-08T16:00:00.000Z",
      completedAt: "2026-07-08T16:00:03.000Z",
      stats: { observations: 0 },
      warnings: [
        {
          code: "connector_refresh_failed",
          message: "Connector refresh failed before returning a result.",
        },
      ],
    })

    await expect(
      host.refresh(connector, {
        connectorInstanceId: "instance_concurrent_runs",
        workspaceId: "workspace_alpha",
        mode: "manual",
        coverage: { start: "failing", end: "failing" },
      }),
    ).rejects.toThrow("fixture refresh failed")
    await host.refresh(connector, {
      connectorInstanceId: "instance_concurrent_runs",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: "after-failure", end: "after-failure" },
    })
    expect(
      host
        .snapshot()
        .rawCaptures.slice(-2)
        .map(({ input }) => input.capture?.connectorRunId),
    ).toEqual(["run_3", "run_4"])
    expect(host.snapshot().runs.at(-1)?.id).toBe("run_4")
    expect(host.snapshot().runs.at(-2)).toMatchObject({
      id: "run_3",
      status: "failed",
    })
  })

  it("records a reserved failed run when the connector throws before capture", async () => {
    const connector: JobConnector = {
      definition: { id: "fixture.pre-capture-failure", version: "0.0.0-fixture" },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        if (input.coverage.end === "before-capture") {
          throw new Error("secret-bearing upstream failure")
        }
        if (!runtime.rawSourceIntake) throw new Error("raw intake required")
        await runtime.rawSourceIntake.capture({
          observedAt: input.coverage.end,
          providerRecordId: "after-failure",
          payload: { ok: true },
        })
        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_pre_capture_failure",
      workspaceId: "workspace_alpha",
      displayName: "Pre-capture failure",
      enabled: true,
      createdAt: "2026-07-08T16:00:00.000Z",
    })

    await expect(
      host.refresh(connector, {
        connectorInstanceId: "instance_pre_capture_failure",
        workspaceId: "workspace_alpha",
        mode: "manual",
        coverage: { start: "before-capture", end: "before-capture" },
      }),
    ).rejects.toThrow("secret-bearing upstream failure")
    await host.refresh(connector, {
      connectorInstanceId: "instance_pre_capture_failure",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: "after-failure", end: "after-failure" },
    })

    const snapshot = host.snapshot()
    expect(snapshot.runs).toHaveLength(2)
    expect(snapshot.runs[0]).toMatchObject({
      id: "run_1",
      status: "failed",
      warnings: [expect.objectContaining({ code: "connector_refresh_failed" })],
    })
    expect(JSON.stringify(snapshot.runs[0])).not.toContain(
      "secret-bearing upstream failure",
    )
    expect(snapshot.rawCaptures).toHaveLength(1)
    expect(snapshot.rawCaptures[0]?.input.capture?.connectorRunId).toBe("run_2")
    expect(snapshot.runs[1]).toMatchObject({ id: "run_2", status: "completed" })
  })
})
