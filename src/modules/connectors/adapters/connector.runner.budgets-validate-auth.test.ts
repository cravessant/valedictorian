import { describe, expect, it } from 'vitest'
import { createPgliteSecretService } from '../../secrets/secret.composition'
import { createWorkspaceSecretScope } from '../../secrets/secret.scope'
import { createConnectorSecretResolver } from '../../secrets/connector-secret-resolver'
import type { SecretCodec } from '../../secrets/secret.codec'
import { createSourceExecutionGovernor } from '../../source-execution/source-execution-governor'
import type { ConnectorCoverageWindow } from '../ports/connector.repository.port'
import type { AppJobConnector } from '../ports/connector.runner-contracts'
import { createConnectorRunner } from './connector.runner'
import {
  useResettablePgliteTestConnectorRepositoryContext,
} from './persistence/connector.repository.pglite-test-helpers'

const testCodec: SecretCodec = {
  decrypt(value) {
    return value.replace(/^enc:/, '')
  },
  encrypt(value) {
    return `enc:${value}`
  },
}

describe.sequential('connector runner', () => {
  const createConnectorRepositoryTestContext
    = useResettablePgliteTestConnectorRepositoryContext()

  it('does not add a host-owned budget during catch-up', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    const receivedInputs: unknown[] = []
    const fixtureConnector = createBudgetCapturingConnector(receivedInputs)

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    await runner.catchUp(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      now: '2026-07-09T16:00:00.000Z',
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
    })

    expect(receivedInputs[0]).not.toHaveProperty('budget')
  })

  it('does not add a host-owned budget during manual refresh', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    const receivedInputs: unknown[] = []
    const fixtureConnector = createBudgetCapturingConnector(receivedInputs)

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    await runner.refresh(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      coverage: {
        start: '2026-07-09T15:00:00.000Z',
        end: '2026-07-09T16:00:00.000Z',
      },
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
    })

    expect(receivedInputs[0]).not.toHaveProperty('budget')
  })

  it('does not add a host-owned budget during scheduled deferred refresh', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    const receivedInputs: unknown[] = []
    const fixtureConnector = createBudgetCapturingConnector(receivedInputs)

    await runner.registerInstance({
      id: 'connector-instance-fixture',
      connector: fixtureConnector,
      displayName: 'Fixture jobs',
      enabled: true,
      createdAt: '2026-07-08T16:00:00.000Z',
    })

    await runner.refreshWithDeferredCheckpoint(fixtureConnector, {
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'scheduled',
      coverage: {
        start: '2026-07-09T15:00:00.000Z',
        end: '2026-07-09T16:00:00.000Z',
      },
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: '2026-07-09T16:00:01.000Z',
    })

    expect(receivedInputs[0]).not.toHaveProperty('budget')
  })

  it('validates username/password credentials without recording run artifacts', async () => {
    const { database, repository } = await createConnectorRepositoryTestContext()
    const secretService = createPgliteSecretService(database, testCodec, createWorkspaceSecretScope('test-workspace'))
    const runner = createConnectorRunner({
      repository,
      sourceExecutionGovernor: createSourceExecutionGovernor(database),
      workspaceId: 'workspace-fixture',
      auth: {
        secrets: createConnectorSecretResolver(secretService),
      },
    })
    const receivedValues: string[] = []
    const connector: AppJobConnector = {
      definition: {
        id: 'fixture.password-jobs',
        version: '0.0.0-fixture',
        auth: {
          modes: ['username_password'],
          requirements: [
            {
              id: 'jobright',
              mode: 'username_password',
              label: 'Jobright username and password',
              required: true,
            },
          ],
        },
      },
      async refresh() {
        throw new Error('refresh should not run during validateAuth')
      },
      async validateAuth(input, runtime) {
        const grant = await runtime.auth.resolve({
          id: 'jobright',
          mode: 'username_password',
        })

        if (grant.status !== 'ready' || typeof grant.value !== 'string') {
          return {
            status: 'missing',
            reason: 'username_password_missing',
          }
        }

        receivedValues.push(grant.value)
        const established = await runtime.auth.refresh({ id: 'jobright', mode: 'username_password',
          executionScopeId: input.executionScopeId }, async () => ({ status: 'ready', sessionId: 'fixture-session' }))
        return {
          status: established.status === 'ready' ? 'ready' : 'failed',
          reason: established.status === 'ready' ? 'jobright_auth_ready' : 'auth_validation_failed',
        }
      },
    }

    await secretService.upsert({
      key: 'connector_jobright_credentials_fixture',
      kind: 'password',
      label: 'Jobright username and password',
      value: JSON.stringify({
        username: 'demo@example.com',
        password: ' pass with spaces ',
      }),
    })
    await runner.registerInstance({
      id: 'connector-instance-password',
      connector,
      displayName: 'Password jobs',
      enabled: true,
      auth: [
        {
          id: 'jobright',
          mode: 'username_password',
          secretKey: 'connector_jobright_credentials_fixture',
        },
      ],
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    const validation = await runner.validateAuth(connector, {
      connectorInstanceId: 'connector-instance-password',
    })
    const runs = await repository.listRuns({
      connectorInstanceId: 'connector-instance-password',
      limit: 10,
      offset: 0,
    })
    const observations = await repository.listObservations({
      connectorInstanceId: 'connector-instance-password',
    })
    const checkpoints = await repository.listCheckpoints({
      connectorInstanceId: 'connector-instance-password',
    })

    expect(validation).toEqual({
      connectorInstanceId: 'connector-instance-password',
      message: 'Connector credentials are verified and ready.',
      reason: 'jobright_auth_ready',
      status: 'ready',
    })
    expect(receivedValues).toEqual([
      JSON.stringify({
        username: 'demo@example.com',
        password: ' pass with spaces ',
      }),
    ])
    expect(runs.total).toBe(0)
    expect(observations).toEqual([])
    expect(checkpoints).toEqual([])
    expect(JSON.stringify(validation)).not.toContain('demo@example.com')
    expect(JSON.stringify(validation)).not.toContain(' pass with spaces ')
  })

  it('sanitizes validateAuth status and unknown reasons', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
    const runner = createConnectorRunner({
      repository,
      workspaceId: 'workspace-fixture',
    })

    const cases: Array<{
      result: { status: string; reason?: string }
      expected: {
        status: string
        reason: string
      }
    }> = [
      {
        result: { status: 'missing', reason: 'username_password_missing' },
        expected: { status: 'missing', reason: 'username_password_missing' },
      },
      {
        result: { status: 'expired', reason: 'jobright_not_logged_in' },
        expected: { status: 'expired', reason: 'jobright_not_logged_in' },
      },
      {
        result: { status: 'action_required', reason: 'jobright_login_rejected' },
        expected: { status: 'action_required', reason: 'jobright_login_rejected' },
      },
      {
        result: { status: 'rate_limited', reason: 'jobright_rate_limited' },
        expected: { status: 'rate_limited', reason: 'jobright_rate_limited' },
      },
      {
        result: { status: 'retryable', reason: 'jobright_login_retryable' },
        expected: { status: 'retryable', reason: 'jobright_login_retryable' },
      },
      {
        result: { status: 'failed', reason: 'jobright_login_schema_invalid' },
        expected: { status: 'failed', reason: 'jobright_login_schema_invalid' },
      },
      {
        result: { status: 'cancelled', reason: 'jobright_auth_request_failed' },
        expected: { status: 'cancelled', reason: 'jobright_auth_request_failed' },
      },
      {
        result: { status: 'invocation_timeout', reason: 'jobright_auth_request_failed' },
        expected: { status: 'invocation_timeout', reason: 'jobright_auth_request_failed' },
      },
      {
        result: { status: 'weird', reason: 'totally_unknown_reason' },
        expected: { status: 'failed', reason: 'auth_validation_failed' },
      },
    ]

    for (const [index, testCase] of cases.entries()) {
      const connector: AppJobConnector = {
        definition: {
          id: `fixture.validate-${index}`,
          version: '0.0.0-fixture',
        },
        async refresh() {
          throw new Error('refresh should not run')
        },
        async validateAuth() {
          return testCase.result as never
        },
      }
      const connectorInstanceId = `connector-instance-validate-${index}`

      await runner.registerInstance({
        id: connectorInstanceId,
        connector,
        displayName: `Validate ${index}`,
        enabled: true,
        auth: [],
        createdAt: '2026-07-08T16:55:00.000Z',
      })

      const validation = await runner.validateAuth(connector, { connectorInstanceId })

      expect(validation).toMatchObject({
        connectorInstanceId,
        reason: testCase.expected.reason,
        status: testCase.expected.status,
      })
      expect(JSON.stringify(validation)).not.toContain('totally_unknown_reason')
    }
  })

  it('returns secure_storage_unavailable when secret decrypt fails closed', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
    const runner = createConnectorRunner({
      repository,
      workspaceId: 'workspace-fixture',
      auth: {
        secrets: {
          async revealSecret() {
            const error = new Error('sensitive-stack Secure storage is unavailable') as Error & {
              code: string
            }
            error.code = 'secure_storage_unavailable'
            throw error
          },
        },
      },
    })
    const connector: AppJobConnector = {
      definition: {
        id: 'fixture.password-jobs',
        version: '0.0.0-fixture',
        auth: {
          modes: ['username_password'],
          requirements: [
            {
              id: 'jobright',
              mode: 'username_password',
              required: true,
            },
          ],
        },
      },
      async refresh() {
        throw new Error('refresh should not run during validateAuth')
      },
      async validateAuth(_input, runtime) {
        await runtime.auth.resolve({
          id: 'jobright',
          mode: 'username_password',
        })

        return {
          status: 'ready',
          reason: 'jobright_auth_ready',
        }
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-secure-storage',
      connector,
      displayName: 'Secure storage jobs',
      enabled: true,
      auth: [
        {
          id: 'jobright',
          mode: 'username_password',
          secretKey: 'connector_jobright_credentials_fixture',
        },
      ],
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    const validation = await runner.validateAuth(connector, {
      connectorInstanceId: 'connector-instance-secure-storage',
    })
    const runs = await repository.listRuns({
      connectorInstanceId: 'connector-instance-secure-storage',
      limit: 10,
      offset: 0,
    })
    const observations = await repository.listObservations({
      connectorInstanceId: 'connector-instance-secure-storage',
    })
    const checkpoints = await repository.listCheckpoints({
      connectorInstanceId: 'connector-instance-secure-storage',
    })

    expect(validation).toEqual({
      connectorInstanceId: 'connector-instance-secure-storage',
      message: 'Secure storage is unavailable. Enable platform encryption, then try again.',
      reason: 'secure_storage_unavailable',
      status: 'failed',
    })
    expect(runs.total).toBe(0)
    expect(observations).toEqual([])
    expect(checkpoints).toEqual([])
    expect(JSON.stringify(validation)).not.toContain('fixture-secret')
    expect(JSON.stringify(validation)).not.toContain('sensitive-stack')
  })

  it('returns unsupported when the connector omits validateAuth', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
    const runner = createConnectorRunner({
      repository,
      workspaceId: 'workspace-fixture',
    })
    const connector: AppJobConnector = {
      definition: {
        id: 'fixture.no-validate',
        version: '0.0.0-fixture',
      },
      async refresh(input) {
        return emptyConnectorRefreshResult({
          checkpoint: { cursor: input.coverage.end },
          coverage: input.coverage,
        })
      },
    }

    await runner.registerInstance({
      id: 'connector-instance-no-validate',
      connector,
      displayName: 'No validate',
      enabled: true,
      auth: [],
      createdAt: '2026-07-08T16:55:00.000Z',
    })

    await expect(runner.validateAuth(connector, {
      connectorInstanceId: 'connector-instance-no-validate',
    })).resolves.toEqual({
      connectorInstanceId: 'connector-instance-no-validate',
      message: 'Connector auth validation is not supported.',
      reason: 'validate_auth_unsupported',
      status: 'unsupported',
    })
  })
})

function emptyConnectorRefreshResult({
  checkpoint,
  coverage,
}: {
  checkpoint: unknown
  coverage: ConnectorCoverageWindow
}) {
  return {
    coverage,
    stats: {
      observations: 0,
    },
    warnings: [],
    nextCheckpoint: {
      checkpoint,
      schemaVersion: 'fixture-checkpoint@1',
    },
    observations: [],
    operationOutcome: null,
    status: 'completed' as const,
    synchronization: {
      newestFrontier: { state: 'caught_up' as const },
      historicalBackfill: { state: 'caught_up' as const, boundary: { earliestDate: coverage.start.slice(0, 10) } },
      pendingResolutionCount: 0,
      outcome: { kind: 'caught_up' as const },
    },
  }
}

function createBudgetCapturingConnector(receivedInputs: unknown[]): AppJobConnector {
  return {
    definition: {
      id: 'fixture.jobs',
      version: '0.0.0-fixture',
    },
    async refresh(input) {
      receivedInputs.push(input)

      return emptyConnectorRefreshResult({
        checkpoint: {
          cursor: input.coverage.end,
        },
        coverage: input.coverage,
      })
    },
  }
}
