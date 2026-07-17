import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { completedConnectorRefreshContract } from '../modules/connectors/connector-refresh-result.test-helpers'
import { createSqliteSecretService } from '../modules/secrets/secret.composition'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-client-')), 'valedictorian.sqlite')
}


describe('runtime local Valedictorian client', () => {
  const originalReferenceTrackerPath = process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH

  beforeEach(() => {
    process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = path.join(
      os.tmpdir(),
      'valedictorian-missing-reference-tracker.md',
    )
  })

  afterEach(() => {
    if (originalReferenceTrackerPath === undefined) {
      delete process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
    } else {
      process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = originalReferenceTrackerPath
    }
  })

  it('runs connector status reconnect and skip actions through the local client', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.1.0',
      displayName: 'Fixture Jobs',
      enabled: true,
      auth: [
        {
          id: 'fixture-session',
          label: 'Fixture session',
          mode: 'api_key',
          secretKey: 'fixture-session-123',
        },
      ],
      filters: { roleKeywords: ['intern'] },
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    await connectorRepository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-08T17:00:00.000Z',
      completedAt: '2026-07-08T17:00:01.000Z',
      config: {},
      filters: { roleKeywords: ['intern'] },
      filterSignature: 'filters:{"roleKeywords":["intern"]}',
      result: {
        ...completedConnectorRefreshContract('2026-07-08'),
        coverage: {
          start: '2026-07-08T16:00:00.000Z',
          end: '2026-07-08T17:00:00.000Z',
        },
        nextCheckpoint: {
          checkpoint: { cursor: 'latest-cursor' },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        retryHints: null,
        stats: {
          observations: 0,
        },
        status: 'completed',
        outcome: { kind: 'yielded' },
        warnings: [
          {
            code: 'auth.expired_session',
            message: 'Expired API key fixture-session-123.',
          },
        ],
      },
    })

    const reconnect = await client.connectors.status.reconnect({
      connectorInstanceId: 'connector-instance-fixture',
    })
    const skipped = await client.connectors.status.skip({
      connectorInstanceId: 'connector-instance-fixture',
      reason: 'user_skipped_auth_required_run',
    })
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
      limit: 10,
    })
    const status = await client.connectors.status.list()

    expect(reconnect).toMatchObject({
      action: 'reconnect',
      connectorInstanceId: 'connector-instance-fixture',
      grants: [],
      message: 'Connector auth validation is not supported.',
      reason: 'validate_auth_unsupported',
      status: 'unsupported',
    })
    expect(skipped).toMatchObject({
      action: 'skip',
      connectorInstanceId: 'connector-instance-fixture',
      run: {
        connectorInstanceId: 'connector-instance-fixture',
        mode: 'manual',
        status: 'cancelled',
      },
      status: 'skipped',
    })
    expect(runs.items).toEqual([
      expect.objectContaining({
        retryHints: null,
        status: 'cancelled',
        stats: expect.objectContaining({
          reason: 'user_skipped_auth_required_run',
          skipped: true,
        }),
      }),
      expect.objectContaining({
        status: 'completed',
      }),
    ])
    expect(status.items).toMatchObject([
      {
        actions: [],
        status: 'skipped',
        statusLabel: 'Skipped by user',
        summary: 'This synchronization work opportunity was skipped by the user.',
      },
    ])
    expect(JSON.stringify(reconnect)).not.toContain('fixture-session-123')
    sqlite.close()
  })

  it('returns unsupported reconnect when connector-owned validateAuth is unavailable', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({ sqlitePath })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.1.0',
      displayName: 'Fixture Jobs',
      enabled: true,
      auth: [
        {
          id: 'fixture-session',
          label: 'Fixture session',
          mode: 'api_key',
          secretKey: 'fixture-session-123',
        },
      ],
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    await expect(
      client.connectors.status.reconnect({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toEqual({
      action: 'reconnect',
      connectorInstanceId: 'connector-instance-fixture',
      grants: [],
      message: 'Connector auth validation is not supported.',
      reason: 'validate_auth_unsupported',
      status: 'unsupported',
    })
    sqlite.close()
  })

  it('validates Jobright credentials through connector-owned validateAuth without plaintext', async () => {
    const sqlitePath = createTempSqlitePath()
    const secretValue = JSON.stringify({
      username: 'demo@example.com',
      password: ' pass with spaces ',
    })
    const secretCodec = {
      decrypt: (value: string) => value.replace(/^enc:/, ''),
      encrypt: (value: string) => `enc:${value}`,
    }
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      const body = typeof init?.body === 'string' ? init.body : ''

      if (url.includes('/swan/auth/login/pwd')) {
        expect(body).toContain('demo@example.com')
        expect(body).toContain(' pass with spaces ')
        return new Response(JSON.stringify({ success: true, result: {} }), {
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'SESSION_ID=session-cookie; Path=/',
          },
          status: 200,
        })
      }

      if (url.includes('/swan/auth/newinfo')) {
        return new Response(JSON.stringify({
          success: true,
          result: { logined: true },
        }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch
    const { createJobrightConnector } = await import('@sparxie/valedictorian-connectors-jobright')
    const { createStaticConnectorRegistry } = await import('../modules/connectors/connector.registry')
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        createJobrightConnector({ fetch: fetchImpl }),
      ]),
      secretCodec,
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)
    const secretService = createSqliteSecretService(database, secretCodec)

    await secretService.upsert({
      key: 'connector_jobright_credentials_jobright_default',
      kind: 'password',
      label: 'Jobright username and password',
      value: secretValue,
    })
    await connectorRepository.upsertInstance({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [
        {
          id: 'jobright',
          label: 'Jobright username and password',
          mode: 'username_password',
          secretKey: 'connector_jobright_credentials_jobright_default',
        },
      ],
      createdAt: '2026-07-09T15:00:00.000Z',
    })

    const reconnect = await client.connectors.status.reconnect({
      connectorInstanceId: 'jobright-default',
    })
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'jobright-default',
      limit: 10,
    })
    const observations = await client.connectors.observations.list({
      connectorInstanceId: 'jobright-default',
    })
    const checkpoints = await client.connectors.checkpoints.list({
      connectorInstanceId: 'jobright-default',
    })

    expect(reconnect).toMatchObject({
      action: 'reconnect',
      connectorInstanceId: 'jobright-default',
      reason: 'jobright_auth_ready',
      status: 'ready',
    })
    expect(runs.total).toBe(0)
    expect(observations.total).toBe(0)
    expect(checkpoints.items).toEqual([])
    expect(JSON.stringify(reconnect)).not.toContain('demo@example.com')
    expect(JSON.stringify(reconnect)).not.toContain(' pass with spaces ')
    expect(JSON.stringify(reconnect)).not.toContain('session-cookie')
    sqlite.close()
  })

})
