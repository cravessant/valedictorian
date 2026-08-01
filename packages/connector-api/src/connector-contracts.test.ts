import { describe, expect, it } from "vitest"
import * as api from "./index.js"

const renderer = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    region: { type: "string" as const, maxLength: 80 },
  },
  required: ["region"],
  maxProperties: 1,
}

const descriptor = {
  connectorId: "fixture.jobs",
  connectorVersion: "1.0.0",
  displayName: "Fixture jobs",
  configSchema: {
    version: "fixture-config@1",
    schema: renderer,
  },
  filterSchema: {
    version: "fixture-filter@1",
    schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        locations: {
          type: "array" as const,
          maxItems: 10,
          items: { type: "string" as const, maxLength: 80 },
        },
      },
      required: ["locations"],
      maxProperties: 1,
    },
  },
}

describe("installed connector descriptor ABI", () => {
  it("exports exactly the five connector-owned Sparxie values at runtime", () => {
    const runtimeKeys = Object.keys(api)
    expect(runtimeKeys).toContain("installedConnectorDescriptorSchema")
    expect(runtimeKeys).toContain("sourceAdapterKinds")
    expect(runtimeKeys).not.toContain("connectorRunSummarySchema")
  })

  it("accepts bounded renderer and filter descriptors", () => {
    expect(api.installedConnectorDescriptorSchema.safeParse(descriptor).success).toBe(true)
  })

  it.each([
    ["an unbounded string renderer", {
      ...descriptor,
      configSchema: {
        version: "fixture-config@1",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { region: { type: "string" } },
        },
      },
    }],
    ["an unresolved presentation pointer", {
      ...descriptor,
      configSchema: {
        ...descriptor.configSchema,
        presentation: {
          fields: {
            "/missing": { label: "Missing", description: "Not declared" },
          },
        },
      },
    }],
    ["a binding with the wrong cardinality", {
      ...descriptor,
      dynamicOptions: {
        protocolVersion: "connector-dynamic-options@1",
        version: "fixture-options@1",
        sources: [{
          id: "fixture.location",
          version: "fixture-location@1",
          label: "Location",
          valueSchema: { type: "string", maxLength: 80 },
          display: { kind: "value" },
          operations: {
            search: {
              minSearchLength: 1,
              maxSearchLength: 80,
              defaultLimit: 10,
              maxLimit: 20,
            },
          },
        }],
        bindings: [{
          filterPointer: "/locations",
          sourceId: "fixture.location",
          cardinality: "one",
          intent: "include",
        }],
      },
    }],
  ])("rejects %s", (_name, input) => {
    expect(api.installedConnectorDescriptorSchema.safeParse(input).success).toBe(false)
  })

  it("rejects cyclic or accessor-backed descriptor data before Zod traversal", () => {
    const cyclic: Record<string, unknown> = { ...descriptor }
    cyclic.self = cyclic
    expect(api.installedConnectorDescriptorSchema.safeParse(cyclic).success).toBe(false)

    let reads = 0
    const hostile = {
      get connectorId() {
        reads += 1
        return "fixture.jobs"
      },
    }
    expect(api.installedConnectorDescriptorSchema.safeParse(hostile).success).toBe(false)
    expect(reads).toBe(0)
  })
})
