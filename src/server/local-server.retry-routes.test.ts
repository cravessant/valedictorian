import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectorRunSummarySchema } from 'sparxie'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from '../runtime/local-valedictorian-client'
import { createDrizzleDatabase, createFileDatabase, migrateDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from './local-server'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-server-')), 'valedictorian.sqlite')
}

async function readJson(response: Response) {
  return (await response.json()) as unknown
}

describe('local Valedictorian HTTP server', () => {
  let server: StartedValedictorianHttpServer | null = null
  const originalReferenceTrackerPath = process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH

  beforeEach(() => {
    process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = path.join(
      os.tmpdir(),
      'valedictorian-missing-reference-tracker.md',
    )
  })

  afterEach(async () => {
    await server?.close()
    server = null
    if (originalReferenceTrackerPath === undefined) {
      delete process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
    } else {
      process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = originalReferenceTrackerPath
    }
  })

  it('returns the same persisted not-due run through HTTP manual trigger without invoking the connector', async () => {
    const sqlitePath = createTempSqlitePath()
    const clock = '2026-07-11T12:00:30.000Z'
    const refresh = vi.fn<AppJobConnector['refresh']>()
    const connector = {
      definition: { id: 'fixture.retry', version: '1.0.0' },
      refresh,
    } as AppJobConnector
    const sqlite = createFileDatabase(sqlitePath)
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    await repository.upsertInstance({
      id: 'retry-http', connectorId: 'fixture.retry', connectorVersion: '1.0.0',
      displayName: 'Retry HTTP', enabled: true, filters: {}, createdAt: '2026-07-11T12:00:00.000Z',
    })
    await repository.recordRefreshResult({
      connectorInstanceId: 'retry-http', mode: 'manual', startedAt: '2026-07-11T12:00:00.000Z', completedAt: '2026-07-11T12:00:01.000Z',
      config: {}, filters: {}, filterSignature: 'filters:{}', result: {
        observations: [], warnings: [], stats: { observations: 0 },
        coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-retry@1' },
        retryHints: {
          state: 'scheduled', reason: 'rate_limit', attempt: 1, maxAttempts: 3,
          lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
          nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
        },
      },
    })
    sqlite.close()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]), now: () => new Date(clock),
      seedDataMode: 'none', sqlitePath,
    })
    server = await createValedictorianHttpServer({
      client, host: '127.0.0.1', port: 0,
      resolveWorkspaceClient(workspaceId) {
        expect(workspaceId).toBe('workspace-retry')
        return client
      },
    })

    const response = await fetch(`${server.url}/v1/workspaces/workspace-retry/connectors/retry-http/runs`, {
      body: JSON.stringify({ mode: 'manual', coverageEndedAt: clock }),
      headers: { 'content-type': 'application/json' }, method: 'POST',
    })
    const httpRun = connectorRunSummarySchema.parse(await readJson(response))
    const repeated = await client.connectors.runs.trigger({
      connectorInstanceId: 'retry-http',
      mode: 'manual',
      coverageEndedAt: clock,
    })

    expect(response.status).toBe(200)
    expect(httpRun).toMatchObject({
      mode: 'manual',
      scheduleOccurrence: null,
      status: 'skipped',
      retryHints: { state: 'not_due' },
    })
    expect(repeated).toMatchObject({ id: httpRun.id, status: 'skipped', retryHints: { state: 'not_due' } })
    expect(refresh).not.toHaveBeenCalled()
  })
})
