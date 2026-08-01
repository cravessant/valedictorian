import { describe, expect, it } from "vitest"

import {
  createInMemoryConnectorHost,
} from "./index.js"
import type {
  ConnectorRefreshInput,
  ConnectorRefreshResult,
  JobConnector,
} from "@sparxie/valedictorian-connectors-core"

describe("in-memory connector host — config", () => {
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
          status: "completed",
          operationOutcome: null,
          synchronization: {
            newestFrontier: { state: "caught_up" },
            historicalBackfill: { state: "caught_up", boundary: { earliestDate: input.coverage.start.slice(0, 10) } },
            pendingResolutionCount: 0,
            outcome: { kind: "caught_up" },
          },
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
          status: "completed",
          operationOutcome: null,
          synchronization: {
            newestFrontier: { state: "caught_up" },
            historicalBackfill: { state: "caught_up", boundary: { earliestDate: input.coverage.start.slice(0, 10) } },
            pendingResolutionCount: 0,
            outcome: { kind: "caught_up" },
          },
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
