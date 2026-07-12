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

    expect(connectorWithoutValidateAuth.validateAuth).toBeUndefined()

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
      reason: "fixture_ready",
    }

    expect(statuses).toContain(result.status)
    expect(result).toEqual({
      status: "ready",
      reason: "fixture_ready",
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
              id: "jobright",
              mode: "username_password",
              label: "Jobright username and password",
              required: true,
            },
          ],
        },
      },
      async refresh(input, runtime): Promise<ConnectorRefreshResult> {
        receivedGrants.push(
          await runtime.auth.resolve({
            id: "jobright",
            mode: "username_password",
          }),
        )

        return emptyRefreshResult(input)
      },
    }
    const host = createInMemoryConnectorHost({
      secrets: {
        jobright_credentials: JSON.stringify({
          username: "user@example.test",
          password: "fixture-password",
        }),
      },
    })

    host.registerInstance({
      auth: [
        {
          id: "jobright",
          mode: "username_password",
          secretKey: "jobright_credentials",
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
        id: "jobright",
        mode: "username_password",
        secretKey: "jobright_credentials",
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
              id: "jobright",
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
          id: "jobright",
          mode: "username_password",
        })
        received.push({ input, grant })
        return {
          status: grant.status === "ready" ? "ready" : "missing",
          reason:
            grant.status === "ready"
              ? "fixture_auth_ready"
              : (grant.reason ?? "fixture_auth_missing"),
        }
      },
    }
    const host = createInMemoryConnectorHost({
      secrets: {
        jobright_credentials: secretValue,
      },
    })

    host.registerInstance({
      auth: [
        {
          id: "jobright",
          mode: "username_password",
          secretKey: "jobright_credentials",
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
      reason: "fixture_auth_ready",
    })
    expect(received).toEqual([
      {
        input: {
          connectorInstanceId: "instance_validate_auth",
          workspaceId: "workspace_alpha",
        },
        grant: {
          id: "jobright",
          mode: "username_password",
          secretKey: "jobright_credentials",
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
})
