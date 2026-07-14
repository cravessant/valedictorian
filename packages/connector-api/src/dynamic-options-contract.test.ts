import { describe, expect, it } from "vitest"

import type {
  ConnectorDynamicOptionsDeclaration,
  ConnectorOptionQueryInput,
  ConnectorOptionQueryResult,
  ConnectorOptionRuntime,
  ConnectorOptionValue,
  JobConnector,
  SourceExecutionScopeId,
} from "./index.js"

const catalog = {
  protocolVersion: "connector-dynamic-options@1",
  version: "fixture-options@3",
  sources: [
    {
      id: "fixture.location",
      version: "fixture-location@2",
      label: "Location",
      valueSchema: {
        type: "object",
        properties: {
          type: { type: "string", minLength: 4, maxLength: 5 },
          city: { type: "string", minLength: 1, maxLength: 120 },
          state: { type: "string", minLength: 1, maxLength: 120 },
          radiusRange: {
            type: "number",
            minimum: 0,
            maximum: 100,
            integer: true,
          },
        },
        required: ["type", "city", "state"],
        additionalProperties: false,
        maxProperties: 4,
      },
      display: { kind: "property", labelPointer: "/city" },
      operations: {
        search: {
          minSearchLength: 2,
          maxSearchLength: 100,
          defaultLimit: 20,
          maxLimit: 50,
        },
        resolve: { maxValues: 50 },
      },
      auth: { mode: "connector", requirementIds: ["fixture"] },
      dependencies: [
        {
          id: "country",
          filterPointer: "/country",
          cardinality: "one",
          required: true,
        },
      ],
    },
  ],
  bindings: [
    {
      filterPointer: "/locations",
      sourceId: "fixture.location",
      cardinality: "many",
      intent: "include",
    },
  ],
} as const satisfies ConnectorDynamicOptionsDeclaration

async function parseCatalog(input: unknown): Promise<unknown> {
  const core = await import("./index.js")
  const parser = (core as Record<string, unknown>)[
    "parseConnectorDynamicOptionsDeclaration"
  ]
  expect(parser).toBeTypeOf("function")
  return (parser as (value: unknown) => unknown)(input)
}

describe("connector dynamic-option declaration", () => {
  it("accepts a versioned trusted catalog with independently versioned sources", async () => {
    const parsed = await parseCatalog(catalog)

    expect(parsed).toMatchObject({
      protocolVersion: "connector-dynamic-options@1",
      version: "fixture-options@3",
      sources: [
        {
          id: "fixture.location",
          version: "fixture-location@2",
        },
      ],
    })
  })

  it.each([
    ["endpoint", "https://provider.invalid/options"],
    ["module", "./provider-options.js"],
    ["template", "POST /options?q={{search}}"],
    ["execute", "return fetch(input)"],
    ["handler", () => Promise.resolve([])],
  ])("rejects executable or implementation-selecting source field %s", async (
    field,
    value,
  ) => {
    const unsafe = structuredClone(catalog) as Record<string, unknown>
    const sources = unsafe.sources as Record<string, unknown>[]
    sources[0] = { ...sources[0], [field]: value }

    await expect(parseCatalog(unsafe)).rejects.toThrow()
  })

  it("rejects duplicate source ids", async () => {
    const unsafe = structuredClone(catalog) as Record<string, unknown>
    const sources = unsafe.sources as Record<string, unknown>[]
    sources.push(structuredClone(sources[0]!))

    await expect(parseCatalog(unsafe)).rejects.toThrow()
  })

  it("rejects a binding to an undeclared source", async () => {
    const unsafe = structuredClone(catalog) as Record<string, unknown>
    const bindings = unsafe.bindings as Record<string, unknown>[]
    bindings[0] = { ...bindings[0], sourceId: "fixture.unknown" }

    await expect(parseCatalog(unsafe)).rejects.toThrow()
  })

  it.each(["locations", "/bad~2escape"])(
    "rejects invalid RFC 6901 pointer %s",
    async (filterPointer) => {
      const unsafe = structuredClone(catalog) as Record<string, unknown>
      const bindings = unsafe.bindings as Record<string, unknown>[]
      bindings[0] = { ...bindings[0], filterPointer }

      await expect(parseCatalog(unsafe)).rejects.toThrow()
    },
  )

  it("rejects a property display pointer absent from the value schema", async () => {
    const unsafe = structuredClone(catalog) as Record<string, unknown>
    const source = (unsafe.sources as Record<string, unknown>[])[0]!
    source.display = { kind: "property", labelPointer: "/missing" }

    await expect(parseCatalog(unsafe)).rejects.toThrow()
  })

  it("accepts a bounded first-nonempty property display projection", async () => {
    const projected = structuredClone(catalog) as Record<string, unknown>
    const source = (projected.sources as Record<string, unknown>[])[0]!
    source.valueSchema = {
      oneOf: [
        {
          type: "object",
          properties: {
            type: { type: "string", maxLength: 4, const: "city" },
            city: { type: "string", minLength: 1, maxLength: 120 },
          },
          required: ["type", "city"],
          additionalProperties: false,
          maxProperties: 2,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", maxLength: 5, const: "state" },
            state: { type: "string", minLength: 1, maxLength: 120 },
          },
          required: ["type", "state"],
          additionalProperties: false,
          maxProperties: 2,
        },
      ],
    }
    source.display = {
      kind: "first_nonempty_property",
      labelPointers: ["/city", "/state"],
    }

    await expect(parseCatalog(projected)).resolves.toMatchObject({
      sources: [
        {
          display: {
            kind: "first_nonempty_property",
            labelPointers: ["/city", "/state"],
          },
        },
      ],
    })
  })

  it.each([
    ["empty", []],
    ["duplicate", ["/city", "/city"]],
    ["unknown", ["/city", "/missing"]],
    ["invalid", ["/city", "/bad~2escape"]],
  ])(
    "rejects a %s first-nonempty property display projection",
    async (_name, labelPointers) => {
      const unsafe = structuredClone(catalog) as Record<string, unknown>
      const source = (unsafe.sources as Record<string, unknown>[])[0]!
      source.display = { kind: "first_nonempty_property", labelPointers }

      await expect(parseCatalog(unsafe)).rejects.toThrow()
    },
  )

  it("rejects a default result limit above the declared maximum", async () => {
    const unsafe = structuredClone(catalog) as Record<string, unknown>
    const source = (unsafe.sources as Record<string, unknown>[])[0]
    const operations = source?.operations as Record<string, unknown>
    operations.search = {
      ...(operations.search as Record<string, unknown>),
      defaultLimit: 51,
      maxLimit: 50,
    }

    await expect(parseCatalog(unsafe)).rejects.toThrow()
  })

  it("rejects a URL in place of a declared source id", async () => {
    const unsafe = structuredClone(catalog) as Record<string, unknown>
    const sources = unsafe.sources as Record<string, unknown>[]
    sources[0] = {
      ...sources[0],
      id: "https://provider.invalid/options",
    }

    await expect(parseCatalog(unsafe)).rejects.toThrow()
  })

  it.each([
    {
      name: "nested object",
      property: {
        type: "object",
        properties: {
          nested: { type: "string", maxLength: 20 },
        },
        required: ["nested"],
        additionalProperties: false,
        maxProperties: 1,
      },
    },
    {
      name: "array",
      property: {
        type: "array",
        items: { type: "string", maxLength: 20 },
      },
    },
  ])("rejects a $name inside an option value", async ({ property }) => {
    const unsafe = structuredClone(catalog) as Record<string, unknown>
    const sources = unsafe.sources as Record<string, unknown>[]
    const source = sources[0] as Record<string, unknown>
    const valueSchema = source.valueSchema as Record<string, unknown>
    source.valueSchema = {
      ...valueSchema,
      properties: {
        ...(valueSchema.properties as Record<string, unknown>),
        unsafe: property,
      },
      required: ["type", "city", "state", "unsafe"],
      maxProperties: 5,
    }

    await expect(parseCatalog(unsafe)).rejects.toThrow()
  })

  it.each(["number", "integer"])(
    "rejects an unbounded %s option value schema",
    async (type) => {
      const unsafe = structuredClone(catalog) as Record<string, unknown>
      const source = (unsafe.sources as Record<string, unknown>[])[0]!
      const valueSchema = source.valueSchema as Record<string, unknown>
      source.valueSchema = {
        ...valueSchema,
        properties: {
          ...(valueSchema.properties as Record<string, unknown>),
          radiusRange: { type },
        },
      }

      await expect(parseCatalog(unsafe)).rejects.toThrow()
    },
  )

  it("rejects numeric enum values outside their declared bounds", async () => {
    const unsafe = structuredClone(catalog) as Record<string, unknown>
    const source = (unsafe.sources as Record<string, unknown>[])[0]!
    const valueSchema = source.valueSchema as Record<string, unknown>
    source.valueSchema = {
      ...valueSchema,
      properties: {
        ...(valueSchema.properties as Record<string, unknown>),
        radiusRange: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          enum: [0, 25, 101],
        },
      },
    }

    await expect(parseCatalog(unsafe)).rejects.toThrow()
  })

  it.each([
    ["maxSearchLength", 0],
    ["defaultLimit", 0],
    ["maxLimit", 0],
    ["maxValues", 0],
  ])("rejects an unbounded or unusable query limit %s=%s", async (
    field,
    value,
  ) => {
    const unsafe = structuredClone(catalog) as Record<string, unknown>
    const source = (unsafe.sources as Record<string, unknown>[])[0]
    const operations = source?.operations as Record<string, unknown>
    if (field === "maxValues") {
      operations.resolve = { maxValues: value }
    } else {
      operations.search = {
        ...(operations.search as Record<string, unknown>),
        [field]: value,
      }
    }

    await expect(parseCatalog(unsafe)).rejects.toThrow()
  })
})

describe("connector dynamic-option query ABI", () => {
  const connector = {
    definition: {
      id: "fixture.connector",
      version: "8.1.0",
      auth: {
        modes: ["api_key"],
        requirements: [{ id: "fixture", mode: "api_key", required: true }],
      },
      filterSchema: {
        version: "fixture-filters@4",
        schema: { type: "object", additionalProperties: false },
      },
      dynamicOptions: catalog,
    },
    async refresh() {
      throw new Error("not exercised by this contract test")
    },
    async queryOptions(
      input: ConnectorOptionQueryInput,
      runtime: ConnectorOptionRuntime,
    ): Promise<ConnectorOptionQueryResult> {
      expect(input.workspaceId).toBe("workspace-1")
      expect(input.connectorInstanceId).toBe("instance-1")
      expect(input.executionScopeId).toBe("scope-1")
      expect(input).toMatchObject({
        connectorVersion: "8.1.0",
        filterSchemaVersion: "fixture-filters@4",
        catalogVersion: "fixture-options@3",
        sourceVersion: "fixture-location@2",
      })
      expect(runtime.cancellation?.signal).toBeInstanceOf(AbortSignal)

      if (input.operation.kind === "resolve") {
        return {
          status: "resolve_ready",
          options: [],
          unknownValues: input.operation.values,
        }
      }
      return input.operation.search.length === 0
        ? { status: "search_empty" }
        : {
            status: "search_ready",
            options: [
              {
                key: "nyc-25",
                label: "New York, NY (25 mi)",
                value: {
                  type: "city",
                  city: "New York",
                  state: "NY",
                  radiusRange: 25,
                },
              },
            ],
            truncated: false,
          }
    },
  } satisfies JobConnector

  const inputBase = {
    connectorInstanceId: "instance-1",
    workspaceId: "workspace-1",
    executionScopeId: "scope-1" as SourceExecutionScopeId,
    connectorVersion: "8.1.0",
    filterSchemaVersion: "fixture-filters@4",
    catalogVersion: "fixture-options@3",
    sourceVersion: "fixture-location@2",
    sourceId: "fixture.location",
    dependencies: { country: "US" },
  } as const

  const controller = new AbortController()
  const runtime: ConnectorOptionRuntime = {
    auth: {
      async resolve() {
        return { id: "fixture", mode: "api_key", status: "ready" as const }
      },
      async refresh() {
        return { status: "ready" as const, sessionId: "opaque" }
      },
    },
    cancellation: { signal: controller.signal },
  }

  it("binds search to host scope, a declared source, text, dependencies, and a limit", async () => {
    const result = await connector.queryOptions(
      {
        ...inputBase,
        operation: { kind: "search", search: "new", limit: 20 },
      },
      runtime,
    )

    expect(result).toEqual({
      status: "search_ready",
      options: [
        {
          key: "nyc-25",
          label: "New York, NY (25 mi)",
          value: {
            type: "city",
            city: "New York",
            state: "NY",
            radiusRange: 25,
          },
        },
      ],
      truncated: false,
    })
  })

  it("resolves exact persisted values and reports unknown values without rewriting them", async () => {
    const staleValue: ConnectorOptionValue = {
      type: "state",
      state: "Old State",
    }
    const result = await connector.queryOptions(
      {
        ...inputBase,
        operation: { kind: "resolve", values: [staleValue] },
      },
      runtime,
    )

    expect(result).toEqual({
      status: "resolve_ready",
      options: [],
      unknownValues: [staleValue],
    })
  })

  it("defines every visible terminal query state as a closed result union", () => {
    const results = [
      { status: "search_ready", options: [], truncated: false },
      { status: "search_empty" },
      { status: "resolve_ready", options: [], unknownValues: [] },
      { status: "auth_required", requirementIds: ["fixture"] },
      {
        status: "error",
        code: "fixture_provider_unavailable",
        retryable: true,
        retryAfterMs: 1_000,
      },
      { status: "cancelled" },
    ] as const satisfies readonly ConnectorOptionQueryResult[]

    expect(results.map((result) => result.status)).toEqual([
      "search_ready",
      "search_empty",
      "resolve_ready",
      "auth_required",
      "error",
      "cancelled",
    ])
  })

  it("keeps the catalog and query method optional for existing connectors", () => {
    const legacyConnector = {
      definition: { id: "fixture.legacy", version: "1.0.0" },
      async refresh() {
        throw new Error("not exercised by this contract test")
      },
    } satisfies JobConnector

    expect("dynamicOptions" in legacyConnector.definition).toBe(false)
    expect("queryOptions" in legacyConnector).toBe(false)
  })

  it("limits option values to scalars or flat scalar objects at compile time", () => {
    const scalar: ConnectorOptionValue = "Software Engineering"
    const flat: ConnectorOptionValue = {
      taxonomyId: "15-1252",
      title: "Software Developer",
    }

    // @ts-expect-error Nested objects are executable-surface expansion, not v1 values.
    const nested: ConnectorOptionValue = { location: { city: "New York" } }
    // @ts-expect-error Arrays are not v1 option values.
    const array: ConnectorOptionValue = ["Software", "Engineering"]

    expect([scalar, flat, nested, array]).toHaveLength(4)
  })
})
