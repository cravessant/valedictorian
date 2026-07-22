import { describe, expect, it } from "vitest"

import type {
  ConnectorCaptureInput,
  ConnectorProviderFieldResolverInput,
  ConnectorRefreshInput,
  ConnectorRefreshResult,
  FieldResolutionOutcome,
  JobConnector,
} from "@sparxie/valedictorian-connectors-core"
import { createInMemoryConnectorHost } from "./index.js"
import { emptyRefreshResult } from "./test-support/in-memory-host-fixtures.js"

function capturingConnector(captures: ConnectorCaptureInput[]): JobConnector {
  return {
    definition: {
      id: "capture-test.jobs",
      version: "0.0.1-test",
      auth: { modes: ["none"] },
      checkpoint: { schemaVersion: "fixture-checkpoint@1" },
    },
    providerFieldResolver: {
      declaration: {
        id: "capture-test.provider-fields",
        version: "capture-test-provider-fields@1",
        scopeRequirement: "none",
        supportedAdapters: { kinds: ["connector"], ids: ["capture-test.jobs"] },
        supportedProviderSchemas: ["test-schema@1"],
        requiredInputs: ["payload"],
        outputFields: ["location"],
        capabilities: ["pure"],
        costClass: "none",
        precedence: 100,
      },
      resolve(input: ConnectorProviderFieldResolverInput): FieldResolutionOutcome[] {
        const payload = input.payload as Record<string, unknown> | null
        const location = payload?.location as string | undefined
        if (location) {
          return [{
            resolverId: "capture-test.provider-fields",
            resolverVersion: "capture-test-provider-fields@1",
            field: "location",
            inputHash: input.captureRevision.contentHash,
            status: "resolved",
            value: { raw: location, city: null, region: null, country: null },
            confidence: 1,
            evidence: [{ kind: "provider_field", path: "location", value: location }],
          }]
        }
        return [{
          resolverId: "capture-test.provider-fields",
          resolverVersion: "capture-test-provider-fields@1",
          field: "location",
          inputHash: input.captureRevision.contentHash,
          status: "abstained",
          reason: "location_absent",
        }]
      },
    },
    async refresh(input: ConnectorRefreshInput, runtime): Promise<ConnectorRefreshResult> {
      for (const capture of captures) {
        await runtime.captureIntake!.capture(capture)
      }
      return emptyRefreshResult(input)
    },
  }
}

describe("in-memory host — provider-field resolver seam", () => {
  it("invokes the registered provider-field resolver after capture acceptance", async () => {
    const captures: ConnectorCaptureInput[] = [{
      observedAt: "2026-07-20T00:00:00.000Z",
      providerRecordId: "job-1",
      providerSchema: "test-schema@1",
      payload: { location: "Remote" },
    }]
    const connector = capturingConnector(captures)
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_capture",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Capture test",
      enabled: true,
      createdAt: "2026-07-20T00:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_capture",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-20T00:00:00.000Z" },
    })

    const snapshotAfterRefresh = host.snapshot()
    expect(snapshotAfterRefresh.providerFieldResolutions).toHaveLength(0)
    expect(snapshotAfterRefresh.captures).toHaveLength(1)

    const revisionId = snapshotAfterRefresh.captures[0]!.receipt.revision.id
    const outcomes = host.resolveProviderFields(connector, revisionId)

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({
      field: "location",
      status: "resolved",
      inputHash: snapshotAfterRefresh.captures[0]!.receipt.revision.contentHash,
    })

    const finalSnapshot = host.snapshot()
    expect(finalSnapshot.providerFieldResolutions).toHaveLength(1)
    expect(finalSnapshot.providerFieldResolutions[0]).toMatchObject({
      captureRevisionId: revisionId,
      resolver: { version: "capture-test-provider-fields@1" },
    })
  })

  it("refresh produces zero provider-field invocations", async () => {
    const captures: ConnectorCaptureInput[] = [{
      observedAt: "2026-07-20T00:00:00.000Z",
      providerRecordId: "job-2",
      providerSchema: "test-schema@1",
      payload: { location: "Toronto, Canada" },
    }]
    const connector = capturingConnector(captures)
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_zero",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Zero invocation test",
      enabled: true,
      createdAt: "2026-07-20T00:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_zero",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-20T00:00:00.000Z" },
    })

    expect(host.snapshot().providerFieldResolutions).toHaveLength(0)
  })

  it("rejects unsupported provider schema before invocation with zero recorded", async () => {
    const captures: ConnectorCaptureInput[] = [{
      observedAt: "2026-07-20T00:00:00.000Z",
      providerRecordId: "job-3",
      providerSchema: "unsupported-schema@9",
      payload: { location: "Remote" },
    }]
    const connector = capturingConnector(captures)
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_schema",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Schema test",
      enabled: true,
      createdAt: "2026-07-20T00:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_schema",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-20T00:00:00.000Z" },
    })

    const revisionId = host.snapshot().captures[0]!.receipt.revision.id
    expect(() => host.resolveProviderFields(connector, revisionId)).toThrow("not applicable")
    expect(host.snapshot().providerFieldResolutions).toHaveLength(0)
  })

  it("rejects null provider schema before invocation", async () => {
    const captures: ConnectorCaptureInput[] = [{
      observedAt: "2026-07-20T00:00:00.000Z",
      providerRecordId: "job-4",
      providerSchema: null,
      payload: { location: "Remote" },
    }]
    const connector = capturingConnector(captures)
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      id: "instance_null_schema",
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      workspaceId: "workspace_alpha",
      displayName: "Null schema test",
      enabled: true,
      createdAt: "2026-07-20T00:00:00.000Z",
    })

    await host.refresh(connector, {
      connectorInstanceId: "instance_null_schema",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-20T00:00:00.000Z" },
    })

    const revisionId = host.snapshot().captures[0]!.receipt.revision.id
    expect(() => host.resolveProviderFields(connector, revisionId)).toThrow("not applicable")
    expect(host.snapshot().providerFieldResolutions).toHaveLength(0)
  })

  it("throws for unknown capture revision", () => {
    const connector = capturingConnector([])
    const host = createInMemoryConnectorHost()
    expect(() => host.resolveProviderFields(connector, "nonexistent")).toThrow("Unknown capture revision")
  })

  it("throws for connector without provider-field resolver", () => {
    const connector: JobConnector = {
      definition: { id: "no-resolver.jobs", version: "0.0.1-test", auth: { modes: ["none"] }, checkpoint: { schemaVersion: "fixture-checkpoint@1" } },
      async refresh(input) { return emptyRefreshResult(input) },
    }
    const host = createInMemoryConnectorHost()
    expect(() => host.resolveProviderFields(connector, "any")).toThrow("does not support provider-field resolution")
  })

  it("resolver mutation does not affect stored Capture", async () => {
    const captures: ConnectorCaptureInput[] = [{
      observedAt: "2026-07-20T00:00:00.000Z",
      providerRecordId: "job-mut",
      providerSchema: "test-schema@1",
      payload: { location: "Original" },
    }]
    const mutatingConnector: JobConnector = {
      definition: { id: "capture-test.jobs", version: "0.0.1-test", auth: { modes: ["none"] }, checkpoint: { schemaVersion: "fixture-checkpoint@1" } },
      providerFieldResolver: {
        declaration: {
          id: "capture-test.provider-fields", version: "capture-test-provider-fields@1", scopeRequirement: "none",
          supportedAdapters: { kinds: ["connector"], ids: ["capture-test.jobs"] },
          supportedProviderSchemas: ["test-schema@1"], requiredInputs: ["payload"],
          outputFields: ["location"], capabilities: ["pure"], costClass: "none", precedence: 100,
        },
        resolve(input: ConnectorProviderFieldResolverInput): FieldResolutionOutcome[] {
          (input.adapter as { id: string }).id = "MUTATED"
          ;(input.payload as Record<string, unknown>).location = "MUTATED"
          return [{ resolverId: "capture-test.provider-fields", resolverVersion: "capture-test-provider-fields@1", field: "location", inputHash: input.captureRevision.contentHash, status: "abstained", reason: "mutated" }]
        },
      },
      async refresh(input: ConnectorRefreshInput, runtime): Promise<ConnectorRefreshResult> {
        for (const c of captures) await runtime.captureIntake!.capture(c)
        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({ id: "instance_mut", connectorId: "capture-test.jobs", connectorVersion: "0.0.1-test", workspaceId: "workspace_alpha", displayName: "Mut", enabled: true, createdAt: "2026-07-20T00:00:00.000Z" })
    await host.refresh(mutatingConnector, { connectorInstanceId: "instance_mut", workspaceId: "workspace_alpha", mode: "manual", coverage: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-20T00:00:00.000Z" } })
    const snapshotBefore = host.snapshot()
    const hashBefore = snapshotBefore.captures[0]!.receipt.revision.contentHash
    const revisionId = snapshotBefore.captures[0]!.receipt.revision.id
    host.resolveProviderFields(mutatingConnector, revisionId)
    const snapshotAfter = host.snapshot()
    expect(snapshotAfter.captures[0]!.input.adapter.id).toBe("capture-test.jobs")
    expect((snapshotAfter.captures[0]!.input.payload as Record<string, unknown>).location).toBe("Original")
    expect(snapshotAfter.captures[0]!.receipt.revision.contentHash).toBe(hashBefore)
  })

  it("version-restricted resolver fails before invocation with zero records", async () => {
    const captures: ConnectorCaptureInput[] = [{
      observedAt: "2026-07-20T00:00:00.000Z",
      providerRecordId: "job-ver",
      providerSchema: "test-schema@1",
      payload: { location: "Remote" },
    }]
    const versionRestricted: JobConnector = {
      definition: { id: "capture-test.jobs", version: "0.0.1-test", auth: { modes: ["none"] }, checkpoint: { schemaVersion: "fixture-checkpoint@1" } },
      providerFieldResolver: {
        declaration: {
          id: "capture-test.provider-fields", version: "capture-test-provider-fields@1", scopeRequirement: "none",
          supportedAdapters: { kinds: ["connector"], ids: ["capture-test.jobs"], versions: ["9.9.9"] },
          supportedProviderSchemas: ["test-schema@1"], requiredInputs: ["payload"],
          outputFields: ["location"], capabilities: ["pure"], costClass: "none", precedence: 100,
        },
        resolve(): FieldResolutionOutcome[] { return [] },
      },
      async refresh(input: ConnectorRefreshInput, runtime): Promise<ConnectorRefreshResult> {
        for (const c of captures) await runtime.captureIntake!.capture(c)
        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({ id: "instance_ver", connectorId: "capture-test.jobs", connectorVersion: "0.0.1-test", workspaceId: "workspace_alpha", displayName: "Ver", enabled: true, createdAt: "2026-07-20T00:00:00.000Z" })
    await host.refresh(versionRestricted, { connectorInstanceId: "instance_ver", workspaceId: "workspace_alpha", mode: "manual", coverage: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-20T00:00:00.000Z" } })
    const revisionId = host.snapshot().captures[0]!.receipt.revision.id
    expect(() => host.resolveProviderFields(versionRestricted, revisionId)).toThrow("not applicable")
    expect(host.snapshot().providerFieldResolutions).toHaveLength(0)
  })
})
