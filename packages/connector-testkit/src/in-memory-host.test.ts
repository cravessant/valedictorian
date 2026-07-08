import { describe, expect, it } from "vitest"

import {
  createFixtureConnector,
  createInMemoryConnectorHost,
} from "./index.js"

describe("in-memory connector host", () => {
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
})
