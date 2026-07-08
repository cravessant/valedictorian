import { describe, expect, it } from "vitest"

import {
  createFixtureConnector,
  createInMemoryConnectorHost,
} from "./index.js"
import type { ConnectorRefreshInput, ConnectorRefreshResult, JobConnector } from "@valedictorian-connectors/core"

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

    expect(run.status).toBe("success")
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
