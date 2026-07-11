import { describe, expect, it } from "vitest"

import {
  createFixtureConnector,
  createInMemoryConnectorHost,
} from "./index.js"
import type {
  ConnectorAuthValidationInput,
  ConnectorAuthValidationResult,
  ConnectorProgressSnapshot,
  ConnectorRefreshInput,
  ConnectorRefreshResult,
  JobConnector,
} from "@sparxie/valedictorian-connectors-core"

describe("in-memory connector host", () => {
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

  it("keeps JobConnector.validateAuth optional for source compatibility", () => {
    const connectorWithoutValidateAuth: JobConnector = {
      definition: {
        id: "fixture.optional-auth-validation",
        version: "0.0.0-fixture",
      },
      async refresh(input): Promise<ConnectorRefreshResult> {
        return emptyRefreshResult(input)
      },
    }

    expect(connectorWithoutValidateAuth.validateAuth).toBeUndefined()

    const statuses: ConnectorAuthValidationResult["status"][] = [
      "ready",
      "missing",
      "expired",
      "action_required",
      "rate_limited",
      "retryable",
      "failed",
    ]
    const result: ConnectorAuthValidationResult = {
      status: "ready",
      reason: "fixture_ready",
    }

    expect(statuses).toContain(result.status)
    expect(result).toEqual({
      status: "ready",
      reason: "fixture_ready",
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
          },
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

  it("provides a ready no-auth grant through the runtime port", async () => {
    const receivedGrants: unknown[] = []
    const connector: JobConnector = {
      definition: {
        id: "fixture.public-jobs",
        version: "0.0.0-fixture",
        auth: {
          modes: ["none"],
          requirements: [
            {
              id: "public",
              mode: "none",
            },
          ],
        },
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: "public",
          }),
        )

        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost()

    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_public",
      workspaceId: "workspace_alpha",
      displayName: "Public jobs",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_public",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T15:00:00.000Z",
        end: "2026-07-08T16:00:00.000Z",
      },
    })

    expect(receivedGrants).toEqual([
      {
        id: "public",
        mode: "none",
        status: "ready",
      },
    ])
  })

  it("resolves username_password grants as secret-backed JSON credentials", async () => {
    const receivedGrants: unknown[] = []
    const connector: JobConnector = {
      definition: {
        id: "fixture.username-password-jobs",
        version: "0.0.0-fixture",
        auth: {
          modes: ["username_password"],
          requirements: [
            {
              id: "jobright",
              mode: "username_password",
              label: "Jobright username and password",
              required: true,
            },
          ],
        },
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: "jobright",
            mode: "username_password",
          }),
        )

        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost({
      secrets: {
        jobright_credentials: JSON.stringify({
          username: "user@example.test",
          password: "fixture-password",
        }),
      },
    })

    host.registerInstance({
      auth: [
        {
          id: "jobright",
          mode: "username_password",
          secretKey: "jobright_credentials",
        },
      ],
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_username_password",
      workspaceId: "workspace_alpha",
      displayName: "Username password jobs",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_username_password",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T15:00:00.000Z",
        end: "2026-07-08T16:00:00.000Z",
      },
    })

    expect(receivedGrants).toEqual([
      {
        id: "jobright",
        mode: "username_password",
        secretKey: "jobright_credentials",
        status: "ready",
        value: JSON.stringify({
          username: "user@example.test",
          password: "fixture-password",
        }),
      },
    ])
    expect(JSON.stringify(host.snapshot())).not.toContain("fixture-password")
  })

  it("exercises optional validateAuth with the same grant resolution and never persists plaintext", async () => {
    const secretValue = JSON.stringify({
      username: "user@example.test",
      password: "validate-auth-password",
    })
    const received: Array<{
      input: ConnectorAuthValidationInput
      grant: unknown
    }> = []
    const connector: JobConnector = {
      definition: {
        id: "fixture.validate-auth-jobs",
        version: "0.0.0-fixture",
        auth: {
          modes: ["username_password"],
          requirements: [
            {
              id: "jobright",
              mode: "username_password",
              required: true,
            },
          ],
        },
      },
      async refresh(input): Promise<ConnectorRefreshResult> {
        return emptyRefreshResult(input)
      },
      async validateAuth(
        input,
        runtime,
      ): Promise<ConnectorAuthValidationResult> {
        const grant = await runtime.auth.resolve({
          id: "jobright",
          mode: "username_password",
        })
        received.push({ input, grant })
        return {
          status: grant.status === "ready" ? "ready" : "missing",
          reason:
            grant.status === "ready"
              ? "fixture_auth_ready"
              : (grant.reason ?? "fixture_auth_missing"),
        }
      },
    }
    const host = createInMemoryConnectorHost({
      secrets: {
        jobright_credentials: secretValue,
      },
    })

    host.registerInstance({
      auth: [
        {
          id: "jobright",
          mode: "username_password",
          secretKey: "jobright_credentials",
        },
      ],
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_validate_auth",
      workspaceId: "workspace_alpha",
      displayName: "Validate auth jobs",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    const result = await host.validateAuth(connector, {
      connectorInstanceId: "instance_validate_auth",
      workspaceId: "workspace_alpha",
    })

    expect(result).toEqual({
      status: "ready",
      reason: "fixture_auth_ready",
    })
    expect(received).toEqual([
      {
        input: {
          connectorInstanceId: "instance_validate_auth",
          workspaceId: "workspace_alpha",
        },
        grant: {
          id: "jobright",
          mode: "username_password",
          secretKey: "jobright_credentials",
          status: "ready",
          value: secretValue,
        },
      },
    ])
    const snapshot = host.snapshot()
    expect(snapshot.runs).toHaveLength(0)
    expect(snapshot.observations).toHaveLength(0)
    expect(JSON.stringify(snapshot)).not.toContain("validate-auth-password")
    expect(JSON.stringify(result)).not.toContain("validate-auth-password")
  })

  it("rejects validateAuth for connectors that omit the optional operation", async () => {
    const connector = createFixtureConnector({
      observedAt: "2026-07-08T16:00:00.000Z",
    })
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

    await expect(
      host.validateAuth(connector, {
        connectorInstanceId: "instance_fixture",
        workspaceId: "workspace_alpha",
      }),
    ).rejects.toThrow("does not support auth validation")
  })

  it("resolves secret-backed auth grants without persisting plaintext in host state", async () => {
    const receivedGrants: unknown[] = []
    const connector: JobConnector = {
      definition: {
        id: "fixture.secret-jobs",
        version: "0.0.0-fixture",
        auth: {
          modes: ["api_key"],
          requirements: [
            {
              id: "fixture_api",
              mode: "api_key",
              label: "Fixture API key",
            },
          ],
        },
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: "fixture_api",
            mode: "api_key",
          }),
        )

        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost({
      secrets: {
        fixture_api_key: "fixture-secret",
      },
    })

    host.registerInstance({
      auth: [
        {
          id: "fixture_api",
          mode: "api_key",
          secretKey: "fixture_api_key",
        },
      ],
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_secret",
      workspaceId: "workspace_alpha",
      displayName: "Secret jobs",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_secret",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T15:00:00.000Z",
        end: "2026-07-08T16:00:00.000Z",
      },
    })

    expect(receivedGrants).toEqual([
      {
        id: "fixture_api",
        mode: "api_key",
        secretKey: "fixture_api_key",
        status: "ready",
        value: "fixture-secret",
      },
    ])
    expect(JSON.stringify(host.snapshot())).not.toContain("fixture-secret")
  })

  it("resolves browser-session grants by the instance session reference", async () => {
    const receivedGrants: unknown[] = []
    const connector: JobConnector = {
      definition: {
        id: "fixture.browser-jobs",
        version: "0.0.0-fixture",
        auth: {
          modes: ["browser_session"],
          requirements: [
            {
              id: "jobright",
              mode: "browser_session",
              label: "Jobright browser session",
            },
          ],
        },
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: "jobright",
            mode: "browser_session",
          }),
        )

        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost({
      browserSessions: {
        workspace_session_1: {
          expiresAt: "2026-07-08T18:00:00.000Z",
          secretKey: "should-not-cross-session-boundary",
          sessionId: "session_123",
          sessionKey: "should-not-override-instance-reference",
          status: "ready",
          value: "should-not-cross-session-boundary",
        } as never,
      },
    })

    host.registerInstance({
      auth: [
        {
          id: "jobright",
          mode: "browser_session",
          sessionKey: "workspace_session_1",
        },
      ],
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_browser_ready",
      workspaceId: "workspace_alpha",
      displayName: "Browser jobs",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_browser_ready",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T15:00:00.000Z",
        end: "2026-07-08T16:00:00.000Z",
      },
    })

    expect(receivedGrants).toEqual([
      {
        id: "jobright",
        mode: "browser_session",
        sessionKey: "workspace_session_1",
        expiresAt: "2026-07-08T18:00:00.000Z",
        sessionId: "session_123",
        status: "ready",
      },
    ])
  })

  it("returns browser-session action-required grants when no session is available", async () => {
    const receivedGrants: unknown[] = []
    const connector: JobConnector = {
      definition: {
        id: "fixture.browser-jobs",
        version: "0.0.0-fixture",
        auth: {
          modes: ["browser_session"],
          requirements: [
            {
              id: "jobright",
              mode: "browser_session",
              label: "Jobright browser session",
            },
          ],
        },
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: "jobright",
            mode: "browser_session",
          }),
        )

        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost()

    host.registerInstance({
      auth: [
        {
          id: "jobright",
          mode: "browser_session",
          sessionKey: "workspace_session_1",
        },
      ],
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_browser",
      workspaceId: "workspace_alpha",
      displayName: "Browser jobs",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_browser",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T15:00:00.000Z",
        end: "2026-07-08T16:00:00.000Z",
      },
    })

    expect(receivedGrants).toEqual([
      {
        id: "jobright",
        mode: "browser_session",
        sessionKey: "workspace_session_1",
        reason: "browser_session_action_required",
        status: "action_required",
      },
    ])
  })

  it("returns expired browser-session grants by the instance session reference", async () => {
    const receivedGrants: unknown[] = []
    const connector: JobConnector = {
      definition: {
        id: "fixture.browser-jobs",
        version: "0.0.0-fixture",
        auth: {
          modes: ["browser_session"],
        },
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: "jobright",
            mode: "browser_session",
          }),
        )

        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost({
      browserSessions: {
        workspace_session_1: {
          expiresAt: "2026-07-08T14:00:00.000Z",
          reason: "session_expired",
          sessionId: "session_123",
          status: "expired",
        },
      },
    })

    host.registerInstance({
      auth: [
        {
          id: "jobright",
          mode: "browser_session",
          sessionKey: "workspace_session_1",
        },
      ],
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_browser_expired",
      workspaceId: "workspace_alpha",
      displayName: "Browser jobs",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_browser_expired",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T15:00:00.000Z",
        end: "2026-07-08T16:00:00.000Z",
      },
    })

    expect(receivedGrants).toEqual([
      {
        id: "jobright",
        mode: "browser_session",
        sessionKey: "workspace_session_1",
        expiresAt: "2026-07-08T14:00:00.000Z",
        reason: "session_expired",
        sessionId: "session_123",
        status: "expired",
      },
    ])
  })

  it("returns missing browser-session grants when no session reference is stored", async () => {
    const receivedGrants: unknown[] = []
    const connector: JobConnector = {
      definition: {
        id: "fixture.browser-jobs",
        version: "0.0.0-fixture",
        auth: {
          modes: ["browser_session"],
        },
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: "jobright",
            mode: "browser_session",
          }),
        )

        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost()

    host.registerInstance({
      auth: [
        {
          id: "jobright",
          mode: "browser_session",
        },
      ],
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_browser_missing_reference",
      workspaceId: "workspace_alpha",
      displayName: "Browser jobs",
      enabled: true,
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_browser_missing_reference",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T15:00:00.000Z",
        end: "2026-07-08T16:00:00.000Z",
      },
    })

    expect(receivedGrants).toEqual([
      {
        id: "jobright",
        mode: "browser_session",
        reason: "session_reference_missing",
        status: "missing",
      },
    ])
  })

  it("passes instance config and filters into refresh and scopes checkpoints by filter signature", async () => {
    const receivedInputs: ConnectorRefreshInput[] = []
    const connector: JobConnector = {
      definition: {
        id: "fixture.filtered-jobs",
        version: "0.0.0-fixture",
      },
      async refresh(input): Promise<ConnectorRefreshResult> {
        receivedInputs.push(input)

        return {
          observations: [],
          nextCheckpoint: {
            checkpoint: {
              cursor: `cursor:${JSON.stringify(input.filters ?? {})}`,
            },
            schemaVersion: "fixture-checkpoint@1",
          },
          coverage: input.coverage,
          stats: {
            observations: 0,
          },
          warnings: [],
        }
      },
    }
    const host = createInMemoryConnectorHost()

    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_filtered",
      workspaceId: "workspace_alpha",
      displayName: "Filtered jobs",
      enabled: true,
      config: {
        listUrl: "https://example.test/jobs",
      },
      filters: {
        roleKeywords: ["intern"],
      },
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    const firstRun = await host.refresh(connector, {
      connectorInstanceId: "instance_filtered",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-08T16:00:00.000Z",
      },
    })
    await host.refresh(connector, {
      connectorInstanceId: "instance_filtered",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T16:00:00.000Z",
        end: "2026-07-08T17:00:00.000Z",
      },
    })

    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_filtered",
      workspaceId: "workspace_alpha",
      displayName: "Filtered jobs",
      enabled: true,
      config: {
        listUrl: "https://example.test/jobs",
      },
      filters: {
        roleKeywords: ["new grad"],
      },
      createdAt: "2026-07-08T15:00:00.000Z",
    })
    const changedFilterRun = await host.refresh(connector, {
      connectorInstanceId: "instance_filtered",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T17:00:00.000Z",
        end: "2026-07-08T18:00:00.000Z",
      },
    })

    expect(receivedInputs).toMatchObject([
      {
        config: {
          listUrl: "https://example.test/jobs",
        },
        filters: {
          roleKeywords: ["intern"],
        },
      },
      {
        checkpoint: {
          cursor: 'cursor:{"roleKeywords":["intern"]}',
        },
        filters: {
          roleKeywords: ["intern"],
        },
      },
      {
        filters: {
          roleKeywords: ["new grad"],
        },
      },
    ])
    expect(receivedInputs[2]).not.toHaveProperty("checkpoint")
    expect(firstRun).toMatchObject({
      filters: {
        roleKeywords: ["intern"],
      },
      filterSignature: 'filters:{"roleKeywords":["intern"]}',
    })
    expect(changedFilterRun).toMatchObject({
      filters: {
        roleKeywords: ["new grad"],
      },
      filterSignature: 'filters:{"roleKeywords":["new grad"]}',
    })
    expect(host.snapshot().checkpoints).toEqual([
      expect.objectContaining({
        connectorInstanceId: "instance_filtered",
        filterSignature: 'filters:{"roleKeywords":["intern"]}',
        checkpoint: {
          cursor: 'cursor:{"roleKeywords":["intern"]}',
        },
      }),
      expect.objectContaining({
        connectorInstanceId: "instance_filtered",
        filterSignature: 'filters:{"roleKeywords":["new grad"]}',
        checkpoint: {
          cursor: 'cursor:{"roleKeywords":["new grad"]}',
        },
      }),
    ])
  })

  it("records partial-success connector results with retry hints", async () => {
    const connector: JobConnector = {
      definition: {
        id: "fixture.partial-jobs",
        version: "0.0.0-fixture",
      },
      async refresh(input): Promise<ConnectorRefreshResult> {
        return {
          status: "partial_success",
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
      status: "partial_success",
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
          remainingTarget: 1,
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

  it("keeps host-owned config and filter snapshots stable when a connector mutates input", async () => {
    const connector: JobConnector = {
      definition: {
        id: "fixture.mutating-jobs",
        version: "0.0.0-fixture",
      },
      async refresh(input): Promise<ConnectorRefreshResult> {
        const config = input.config as { listUrl: string }
        const filters = input.filters as { roleKeywords: string[] }
        config.listUrl = "https://mutated.example/jobs"
        filters.roleKeywords.push("mutated")

        return {
          observations: [],
          nextCheckpoint: {
            checkpoint: {
              cursor: "cursor:mutated",
            },
            schemaVersion: "fixture-checkpoint@1",
          },
          coverage: input.coverage,
          stats: {
            observations: 0,
          },
          warnings: [],
        }
      },
    }
    const host = createInMemoryConnectorHost()

    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      id: "instance_mutation",
      workspaceId: "workspace_alpha",
      displayName: "Mutation check",
      enabled: true,
      config: {
        listUrl: "https://example.test/jobs",
      },
      filters: {
        roleKeywords: ["intern"],
      },
      createdAt: "2026-07-08T15:00:00.000Z",
    })

    const run = await host.refresh(connector, {
      connectorInstanceId: "instance_mutation",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-08T17:00:00.000Z",
        end: "2026-07-08T18:00:00.000Z",
      },
    })

    expect(run.config).toEqual({
      listUrl: "https://example.test/jobs",
    })
    expect(run.filters).toEqual({
      roleKeywords: ["intern"],
    })
    expect(run.filterSignature).toBe('filters:{"roleKeywords":["intern"]}')
    expect(host.snapshot().instances[0]).toMatchObject({
      config: {
        listUrl: "https://example.test/jobs",
      },
      filters: {
        roleKeywords: ["intern"],
      },
    })
  })
})

function emptyRefreshResult(input: ConnectorRefreshInput): ConnectorRefreshResult {
  return {
    observations: [],
    nextCheckpoint: {
      checkpoint: {
        cursor: input.coverage.end,
      },
      schemaVersion: "fixture-checkpoint@1",
    },
    coverage: input.coverage,
    stats: {
      observations: 0,
    },
    warnings: [],
  }
}
