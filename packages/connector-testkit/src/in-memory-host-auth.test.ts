import { describe, expect, it } from "vitest"

import {
  createFixtureConnector,
  createInMemoryConnectorHost,
} from "./index.js"
import type {
  ConnectorAuthValidationInput,
  ConnectorAuthValidationResult,
  ConnectorRefreshResult,
  JobConnector,
} from "@sparxie/valedictorian-connectors-core"
import { emptyRefreshResult } from "./test-support/in-memory-host-fixtures.js"

describe("in-memory connector host — auth", () => {
  it("single-flights concurrent establishment for one execution scope", async () => {
    let establishmentCalls = 0
    const release = Promise.withResolvers<void>()
    const connector: JobConnector = {
      definition: { id: "fixture.auth-flight", version: "0.10.0" },
      async refresh(input) { return emptyRefreshResult(input) },
      async validateAuth(input, runtime) {
        const result = await runtime.auth.refresh(
          { id: "fixture", executionScopeId: input.executionScopeId },
          async () => {
            establishmentCalls += 1
            await release.promise
            return { status: "ready", sessionId: "canonical-session" }
          },
        )
        return { status: result.status, reason: "auth_validation_ready" }
      },
    }
    const host = createInMemoryConnectorHost()
    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      createdAt: "2026-07-12T00:00:00.000Z",
      displayName: "Auth flight",
      enabled: true,
      id: "instance_auth_flight",
      workspaceId: "workspace_alpha",
    })
    const request = {
      connectorInstanceId: "instance_auth_flight",
      workspaceId: "workspace_alpha",
    }
    const first = host.validateAuth(connector, request)
    const second = host.validateAuth(connector, request)
    await Promise.resolve()
    expect(establishmentCalls).toBe(1)
    release.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "ready", reason: "auth_validation_ready" },
      { status: "ready", reason: "auth_validation_ready" },
    ])
  })

  it("returns a newer canonical generation without letting stale establishment overwrite it", async () => {
    const scope = "connector.instance_auth_fence"
    const sessions = {
      [scope]: { generation: 1, sessionId: "old-session" },
    }
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const connector: JobConnector = {
      definition: { id: "fixture.auth-fence", version: "0.10.0" },
      async refresh(input) { return emptyRefreshResult(input) },
      async validateAuth(input, runtime) {
        const result = await runtime.auth.refresh(
          { id: "fixture", executionScopeId: input.executionScopeId },
          async () => {
            started.resolve()
            await release.promise
            return { status: "ready", sessionId: "stale-session" }
          },
        )
        return {
          status: result.status === "ready" ? "ready" : "failed",
          reason: result.status === "ready"
            ? "auth_validation_ready"
            : "auth_validation_failed",
        }
      },
    }
    const host = createInMemoryConnectorHost({ authSessions: sessions })
    host.registerInstance({
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      createdAt: "2026-07-12T00:00:00.000Z",
      displayName: "Auth fence",
      enabled: true,
      id: "instance_auth_fence",
      workspaceId: "workspace_alpha",
    })
    const validation = host.validateAuth(connector, {
      connectorInstanceId: "instance_auth_fence",
      workspaceId: "workspace_alpha",
    })
    await started.promise
    sessions[scope] = { generation: 2, sessionId: "newer-session" }
    release.resolve()
    await expect(validation).resolves.toEqual({
      status: "ready",
      reason: "auth_validation_ready",
    })
    expect(sessions[scope]).toEqual({ generation: 2, sessionId: "newer-session" })
  })

  it("reuses a generation newer than the session resolved by the connector", async () => {
    const scope = "connector.instance_auth_reuse"
    const sessions = {
      [scope]: { generation: 1, sessionId: "resolved-session" },
    }
    const resolved = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let establishmentCalls = 0
    let refreshResult: unknown
    const connector: JobConnector = {
      definition: { id: "fixture.auth-reuse", version: "0.10.0" },
      async refresh(input, runtime) {
        await runtime.auth.resolve({ id: "fixture", mode: "username_password" })
        resolved.resolve()
        await release.promise
        refreshResult = await runtime.auth.refresh(
          { id: "fixture", executionScopeId: input.executionScopeId },
          async () => {
            establishmentCalls += 1
            return { status: "ready", sessionId: "stale-establishment" }
          },
        )
        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost({ authSessions: sessions })
    host.registerInstance({
      auth: [{ id: "fixture", mode: "username_password" }],
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      createdAt: "2026-07-12T00:00:00.000Z",
      displayName: "Auth reuse",
      enabled: true,
      id: "instance_auth_reuse",
      workspaceId: "workspace_alpha",
    })
    const run = host.refresh(connector, {
      connectorInstanceId: "instance_auth_reuse",
      workspaceId: "workspace_alpha",
      mode: "manual",
      coverage: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-12T00:00:00.000Z",
      },
    })
    await resolved.promise
    sessions[scope] = { generation: 2, sessionId: "newer-session" }
    release.resolve()
    await run
    expect(establishmentCalls).toBe(0)
    expect(refreshResult).toEqual({ status: "ready", sessionId: "newer-session" })
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

    expect("validateAuth" in connectorWithoutValidateAuth).toBe(false)

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
      reason: "auth_validation_ready",
    }

    expect(statuses).toContain(result.status)
    expect(result).toEqual({
      status: "ready",
      reason: "auth_validation_ready",
    })
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
              id: "fixture",
              mode: "username_password",
              label: "Fixture username and password",
              required: true,
            },
          ],
        },
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: "fixture",
            mode: "username_password",
          }),
        )

        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost({
      secrets: {
        fixture_credentials: JSON.stringify({
          username: "user@example.test",
          password: "fixture-password",
        }),
      },
    })

    host.registerInstance({
      auth: [
        {
          id: "fixture",
          mode: "username_password",
          secretKey: "fixture_credentials",
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
        id: "fixture",
        mode: "username_password",
        secretKey: "fixture_credentials",
        sessionId: "connector.instance_username_password",
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
              id: "fixture",
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
          id: "fixture",
          mode: "username_password",
        })
        received.push({ input, grant })
        return {
          status: grant.status === "ready" ? "ready" : "missing",
          reason: grant.status === "ready"
            ? "auth_validation_ready"
            : "username_password_missing",
        }
      },
    }
    const host = createInMemoryConnectorHost({
      secrets: {
        fixture_credentials: secretValue,
      },
    })

    host.registerInstance({
      auth: [
        {
          id: "fixture",
          mode: "username_password",
          secretKey: "fixture_credentials",
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
      reason: "auth_validation_ready",
    })
    expect(received).toEqual([
      {
        input: {
          connectorInstanceId: "instance_validate_auth",
          executionScopeId: "connector.instance_validate_auth",
          workspaceId: "workspace_alpha",
        },
        grant: {
          id: "fixture",
          mode: "username_password",
          secretKey: "fixture_credentials",
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

})
