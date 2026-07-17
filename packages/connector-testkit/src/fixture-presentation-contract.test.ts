import { describe, expect, it } from "vitest"
import { installedConnectorDescriptorSchema } from "sparxie"

import { createFixtureConnector } from "./index.js"

describe("fixture connector presentation metadata", () => {
  it("exposes valid presentation metadata on config and filter schemas", () => {
    const connector = createFixtureConnector({
      observedAt: "2026-07-17T12:00:00.000Z",
    })

    const configPresentation = connector.definition.configSchema?.presentation
    const filterPresentation = connector.definition.filterSchema?.presentation

    expect(configPresentation?.fields["/listUrl"]).toMatchObject({
      label: expect.any(String),
      description: expect.any(String),
    })
    expect(filterPresentation?.fields["/roleKeywords"]).toMatchObject({
      label: expect.any(String),
      description: expect.any(String),
    })

    const parsed = installedConnectorDescriptorSchema.parse({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      displayName: connector.definition.displayName ?? connector.definition.id,
      configSchema: connector.definition.configSchema,
      filterSchema: connector.definition.filterSchema,
    })

    expect(parsed.configSchema?.presentation?.fields["/listUrl"]?.label).toEqual(
      expect.any(String),
    )
    expect(
      parsed.filterSchema?.presentation?.fields["/roleKeywords"]?.label,
    ).toEqual(expect.any(String))
  })
})
