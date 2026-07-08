import { describe, expect, it } from "vitest"

import {
  createFixtureConnector,
  createInMemoryConnectorHost,
} from "./index.js"
import type {
  ConnectorRefreshInput,
  ConnectorRefreshResult,
  JobConnector,
} from "@valedictorian-connectors/core"

describe("in-memory connector host", () => {
  it("exposes connector definition metadata for host validation and policy", () => {
    const connector = createFixtureConnector({
      observedAt: "2026-07-08T16:00:00.000Z",
    })

    expect(connector.definition).toMatchObject({
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
              id: "internlist",
              mode: "api_key",
              label: "InternList API key",
            },
          ],
        },
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: "internlist",
            mode: "api_key",
          }),
        )

        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost({
      secrets: {
        internlist_api_key: "il-secret",
      },
    })

    host.registerInstance({
      auth: [
        {
          id: "internlist",
          mode: "api_key",
          secretKey: "internlist_api_key",
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
        id: "internlist",
        mode: "api_key",
        secretKey: "internlist_api_key",
        status: "ready",
        value: "il-secret",
      },
    ])
    expect(JSON.stringify(host.snapshot())).not.toContain("il-secret")
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
            reason: "budget_exhausted",
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
        reason: "budget_exhausted",
      },
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
