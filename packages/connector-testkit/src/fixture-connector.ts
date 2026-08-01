import type {
  ConnectorDefinition,
  ConnectorRefreshInput,
  ConnectorRefreshResult,
  JobConnector,
  JobObservation,
} from "@sparxie/valedictorian-connectors-core"
import { jobObservationSchemaVersion } from "@sparxie/valedictorian-connectors-core"

export type FixtureConnectorOptions = {
  observedAt: string
}

export function createFixtureConnector(
  options: FixtureConnectorOptions,
): JobConnector {
  const parserVersion = "fixture-parser@1"
  const definition: ConnectorDefinition = {
    id: "fixture.jobs",
    version: "0.0.0-fixture",
    displayName: "Fixture jobs",
    configSchema: {
      version: "fixture-config@1",
      schema: {
        type: "object",
        properties: {
          listUrl: {
            type: "string",
            maxLength: 2_048,
          },
        },
        additionalProperties: true,
      },
      presentation: {
        fields: {
          "/listUrl": {
            label: "List URL",
            description: "Fixture list address used by the in-memory host.",
          },
        },
      },
    },
    filterSchema: {
      version: "fixture-filters@1",
      schema: {
        type: "object",
        properties: {
          roleKeywords: {
            type: "array",
            maxItems: 50,
            items: {
              type: "string",
              maxLength: 256,
            },
          },
        },
        additionalProperties: true,
      },
      presentation: {
        fields: {
          "/roleKeywords": {
            label: "Role keywords",
            description: "Fixture keywords used to exercise filter presentation.",
          },
        },
      },
    },
    auth: {
      modes: ["none"],
    },
    capabilities: {
      fetchesPublicPages: false,
      resolvesIntermediaryLinks: false,
      supportsIncrementalRefresh: true,
      supportsFiltering: true,
    },
    checkpoint: {
      schemaVersion: "fixture-checkpoint@1",
    },
    observation: {
      schemaVersion: jobObservationSchemaVersion,
    },
  }

  return {
    definition,
    async refresh(
      input: ConnectorRefreshInput,
    ): Promise<ConnectorRefreshResult> {
      const observation: JobObservation = {
        connectorId: definition.id,
        connectorVersion: definition.version,
        parserVersion,
        observationSchemaVersion: jobObservationSchemaVersion,
        sourceRecordKey: "fixture.jobs:software-engineering-intern",
        observedAt: options.observedAt,
        companyName: "Example Robotics",
        roleTitle: "Software Engineering Intern",
        locationRaw: "Remote",
        descriptionText: "Build fixture robots and connector proofs.",
        pay: null,
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
        sourceMetadata: {
          fixture: true,
        },
        evidence: [
          {
            type: "fixture",
            capturedAt: options.observedAt,
            sourceUrl:
              "https://example.test/jobs/software-engineering-intern",
          },
        ],
      }

      return {
        observations: [observation],
        nextCheckpoint: {
          checkpoint: {
            cursor: `fixture:${options.observedAt}`,
          },
          schemaVersion: "fixture-checkpoint@1",
        },
        coverage: input.coverage,
        stats: {
          observations: 1,
        },
        warnings: [],
        status: "completed",
        operationOutcome: null,
        synchronization: {
          newestFrontier: { state: "caught_up" },
          historicalBackfill: {
            state: "caught_up",
            boundary: { earliestDate: input.coverage.start.slice(0, 10) },
          },
          pendingResolutionCount: 0,
          outcome: { kind: "caught_up" },
        },
      }
    },
  }
}
