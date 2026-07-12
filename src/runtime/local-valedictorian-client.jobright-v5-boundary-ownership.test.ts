import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'
import {
  rawSourceRevisions,
  retryWork,
} from '../db/schema'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import { createSqliteProfileRepository } from '../modules/profile/profile.repository'

function createTempSqlitePath() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-v5-boundary-')),
    'valedictorian.sqlite',
  )
}

function jobrightDetailResponse(jobId: string) {
  return new Response(JSON.stringify({
    success: true,
    result: {
      logined: true,
      jobDetail: {
        jobResult: {
          applyLink: `https://jobs.lever.co/example/${jobId}`,
          originalUrl: `https://jobright.ai/jobs/info/${jobId}`,
          jobTitle: 'Boundary Intern',
          companyName: 'Boundary Co',
          isCompanySiteLink: true,
        },
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('runtime Jobright v5 earliest-boundary retry ownership', () => {
  it('does not acquire suspended or out-of-bound exact work across earliest-date narrowing and widening', async () => {
    const sqlitePath = createTempSqlitePath()
    let clock = '2026-07-11T12:00:00.000Z'
    let detailCalls = 0
    let discoveryCalls = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/swan/auth/login/pwd')) {
        return new Response(JSON.stringify({ success: true, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'SESSION_ID=boundary-session; Path=/' },
        })
      }
      if (url.includes('/swan/auth/newinfo')) {
        return new Response(JSON.stringify({ success: true, result: { logined: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/swan/recommend/visitor-list/jobs')) {
        discoveryCalls += 1
        return new Response(JSON.stringify({
          success: true,
          result: {
            jobNum: 1,
            jobList: [{
              jobResult: {
                jobId: 'job-boundary',
                jobTitle: 'Boundary Intern',
                companyName: 'Boundary Co',
                publishTime: '2026-07-05T12:00:00.000Z',
              },
              companyResult: { companyName: 'Boundary Co' },
            }],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.endsWith('/swan/share/job/job-boundary')) {
        detailCalls += 1
        return detailCalls === 1
          ? new Response(JSON.stringify({ success: false }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
          : jobrightDetailResponse('job-boundary')
      }
      throw new Error(`Unexpected boundary fixture request: ${url}`)
    }) as typeof fetch

    const connector = createJobrightConnector({
      fetch: fetchImpl,
      now: () => clock,
      nowEpochMs: () => Date.parse(clock),
      random: () => 0,
    })
    const secretCodec = {
      decrypt: (value: string) => value.replace(/^enc:/, ''),
      encrypt: (value: string) => `enc:${value}`,
    }
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      connectorRuntime: { delay: { async wait() { return 0 } } },
      now: () => new Date(clock),
      secretCodec,
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const profiles = createSqliteProfileRepository(database, secretCodec)
    await profiles.upsertSecret({
      key: 'boundary-credentials',
      kind: 'password',
      label: 'Boundary credentials',
      value: JSON.stringify({ username: 'boundary@example.test', password: 'boundary-password' }),
    })
    await repository.upsertInstance({
      id: 'jobright-boundary',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.8.0',
      displayName: 'Jobright boundary',
      enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'boundary-credentials' }],
      config: { discoveryCount: 1, maxRequestsPerRun: 10 },
      filters: { maxResolutionCount: 1 },
      earliestBackfillDate: '2026-07-01',
      createdAt: clock,
    })

    const first = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-boundary',
      mode: 'manual',
      coverageEndedAt: clock,
    })
    expect(first.retryHints).toMatchObject({ state: 'scheduled', reason: 'server_failure' })
    expect(detailCalls).toBe(1)
    expect(discoveryCalls).toBe(1)

    const filterSignature = 'provider-state:jobright.resolver@0.8.0'
    const checkpointAfterFirst = await repository.getCheckpoint({
      connectorInstanceId: 'jobright-boundary',
      filterSignature,
    })
    const pendingAfterFirst = (
      checkpointAfterFirst!.checkpoint as {
        pendingDetailRetries: Array<{
          sourceId: string
          ownership: string
          generationId: string | null
          advice: Record<string, unknown>
          posting: { raw: unknown }
        }>
        generationId: string
        effectiveCoverageStart: string
      }
    )
    expect(pendingAfterFirst.pendingDetailRetries).toEqual([
      expect.objectContaining({
        sourceId: 'jobright.public:job-boundary',
        ownership: 'active',
        generationId: pendingAfterFirst.generationId,
      }),
    ])
    expect(pendingAfterFirst.effectiveCoverageStart).toBe('2026-07-01T00:00:00.000Z')
    expect(database.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')).toEqual([
      expect.objectContaining({ state: 'scheduled' }),
    ])

    await client.connectors.update({
      connectorInstanceId: 'jobright-boundary',
      earliestBackfillDate: '2026-07-10',
    })

    clock = String(first.retryHints!.nextAttemptAt)
    const afterNarrow = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-boundary',
      mode: 'manual', executionIntent: 'deferred_refresh',
      coverageEndedAt: clock,
    })
    expect(afterNarrow.status).not.toBe('skipped')
    expect(detailCalls).toBe(1)
    expect(discoveryCalls).toBe(2)

    const checkpointAfterNarrow = await repository.getCheckpoint({
      connectorInstanceId: 'jobright-boundary',
      filterSignature,
    })
    const pendingAfterNarrow = (
      checkpointAfterNarrow!.checkpoint as {
        pendingDetailRetries: Array<{
          sourceId: string
          ownership: string
          generationId: string | null
          advice: Record<string, unknown>
        }>
        retryState: Array<{ sourceId: string }>
        effectiveCoverageStart: string
      }
    )
    expect(pendingAfterNarrow.effectiveCoverageStart).toBe('2026-07-10T00:00:00.000Z')
    expect(pendingAfterNarrow.pendingDetailRetries).toEqual([
      expect.objectContaining({
        sourceId: 'jobright.public:job-boundary',
        ownership: 'suspended',
        generationId: null,
        advice: expect.objectContaining({
          attempt: pendingAfterFirst.pendingDetailRetries[0]!.advice.attempt,
        }),
      }),
    ])
    expect(pendingAfterNarrow.retryState).toEqual([])
    expect(database.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')).toEqual([
      expect.objectContaining({
        state: 'scheduled',
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
    ])

    const detailBeforeRepeat = detailCalls
    const repeated = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-boundary',
      mode: 'manual', executionIntent: 'deferred_refresh',
      coverageEndedAt: clock,
    })
    expect(detailCalls).toBe(detailBeforeRepeat)
    expect(repeated.status).not.toMatch(/skipped/)
    expect(database.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')).toEqual([
      expect.objectContaining({
        state: 'scheduled',
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
    ])
    const checkpointAfterRepeat = await repository.getCheckpoint({
      connectorInstanceId: 'jobright-boundary',
      filterSignature,
    })
    expect(
      (checkpointAfterRepeat!.checkpoint as {
        pendingDetailRetries: Array<{ ownership: string }>
      }).pendingDetailRetries,
    ).toEqual([
      expect.objectContaining({ ownership: 'suspended' }),
    ])

    await client.connectors.update({
      connectorInstanceId: 'jobright-boundary',
      earliestBackfillDate: '2026-07-01',
    })
    const afterWiden = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-boundary',
      mode: 'manual', executionIntent: 'deferred_refresh',
      coverageEndedAt: clock,
    })
    expect(afterWiden.status).not.toMatch(/skipped/)
    expect(detailCalls).toBe(2)
    expect(discoveryCalls).toBe(2)

    const checkpointAfterWiden = await repository.getCheckpoint({
      connectorInstanceId: 'jobright-boundary',
      filterSignature,
    })
    const pendingAfterWiden = (
      checkpointAfterWiden!.checkpoint as {
        pendingDetailRetries: Array<{ sourceId: string; ownership: string }>
        successfulDetailLedger: Array<{ sourceId: string; status: string }>
        effectiveCoverageStart: string
      }
    )
    expect(pendingAfterWiden.effectiveCoverageStart).toBe('2026-07-01T00:00:00.000Z')
    expect(pendingAfterWiden.pendingDetailRetries).toEqual([])
    expect(pendingAfterWiden.successfulDetailLedger).toEqual([
      expect.objectContaining({
        sourceId: 'jobright.public:job-boundary',
        status: 'resolved',
      }),
    ])

    const revisions = database.select().from(rawSourceRevisions).all()
      .filter(({ providerRecordId }) => providerRecordId === 'job-boundary')
    expect(revisions).toHaveLength(1)
    const residualRetry = database.select().from(retryWork).all()
      .filter(({ kind }) => kind === 'normalization')
    expect(residualRetry).toEqual([
      expect.objectContaining({
        rawRevisionId: revisions[0]!.id,
        resolverId: 'jobright.authenticated-destination',
        resolverVersion: 'jobright-authenticated-destination@1',
        state: 'scheduled',
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
    ])

    const detailBeforeFinal = detailCalls
    clock = new Date(Date.parse(clock) + 60_000).toISOString()
    const afterResidual = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-boundary',
      mode: 'manual', executionIntent: 'deferred_refresh',
      coverageEndedAt: clock,
    })
    expect(detailCalls).toBe(detailBeforeFinal)
    expect(afterResidual.retryHints).toBeNull()
    expect(database.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')).toEqual([
      expect.objectContaining({
        id: residualRetry[0]!.id,
        state: 'scheduled',
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
    ])
    sqlite.close()
  })
})
