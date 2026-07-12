import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'
import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import {
  normalizationAttempts,
  normalizationFieldOutcomes,
  rawSourceOccurrences,
  rawSourceRevisions,
  retryWork,
} from '../db/schema'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import { createSqliteProfileRepository } from '../modules/profile/profile.repository'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-client-')), 'valedictorian.sqlite')
}

describe('runtime local Valedictorian client Jobright normalization retry', () => {

  it('replays only due Jobright v5 detail work without rediscovery or successful-detail duplication', async () => {
    const sqlitePath = createTempSqlitePath()
    let clock = '2026-07-11T12:00:00.000Z'
    let retryDetailCalls = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/swan/auth/login/pwd')) return new Response(JSON.stringify({ success: true, result: {} }), {
        status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'SESSION_ID=retry-session; Path=/' },
      })
      if (url.includes('/swan/auth/newinfo')) return new Response(JSON.stringify({ success: true, result: { logined: true } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
      if (url.includes('/swan/recommend/visitor-list/jobs')) return new Response(JSON.stringify({
        success: true,
        result: { jobNum: 2, jobList: [
          { jobResult: { jobId: 'job-success', jobTitle: 'Success Intern', companyName: 'Success Co' }, companyResult: { companyName: 'Success Co' } },
          { jobResult: { jobId: 'job-retry', jobTitle: 'Retry Intern', companyName: 'Retry Co' }, companyResult: { companyName: 'Retry Co' } },
        ] },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/swan/share/job/job-success')) return jobrightDetailResponse('job-success')
      if (url.endsWith('/swan/share/job/job-retry')) {
        retryDetailCalls += 1
        return retryDetailCalls === 1
          ? new Response(JSON.stringify({ success: false }), { status: 503, headers: { 'content-type': 'application/json' } })
          : jobrightDetailResponse('job-retry')
      }
      throw new Error(`Unexpected retry fixture request: ${url}`)
    }) as typeof fetch
    const connector = createJobrightConnector({
      fetch: fetchImpl, now: () => clock, nowEpochMs: () => Date.parse(clock), random: () => 0,
    })
    const secretCodec = { decrypt: (value: string) => value.replace(/^enc:/, ''), encrypt: (value: string) => `enc:${value}` }
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      connectorRuntime: { delay: { async wait() { return 0 } } },
      now: () => new Date(clock), secretCodec, seedDataMode: 'none', sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const profiles = createSqliteProfileRepository(database, secretCodec)
    await profiles.upsertSecret({ key: 'retry-credentials', kind: 'password', label: 'Retry credentials', value: JSON.stringify({ username: 'retry@example.test', password: 'retry-password' }) })
    await repository.upsertInstance({
      id: 'jobright-retry', connectorId: 'jobright.resolver', connectorVersion: '0.8.0',
      displayName: 'Jobright retry', enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'retry-credentials' }],
      config: { discoveryCount: 2, maxRequestsPerRun: 10 }, filters: { maxResolutionCount: 2 },
      createdAt: clock,
    })

    const first = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-retry', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: clock,
    })
    expect(first.retryHints).toMatchObject({ state: 'scheduled', reason: 'server_failure' })
    expect(database.select().from(retryWork).all()).toEqual([
      expect.objectContaining({ kind: 'normalization', resolverId: 'jobright.authenticated-destination', state: 'scheduled' }),
    ])
    const callsBeforeEarlyTrigger = fetchImpl.mock.calls.length
    const early = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-retry', mode: 'manual', executionIntent: 'deferred_refresh', coverageEndedAt: clock,
    })
    expect(early).toMatchObject({ status: 'skipped', retryHints: { state: 'not_due' } })
    expect(fetchImpl).toHaveBeenCalledTimes(callsBeforeEarlyTrigger)

    clock = first.retryHints!.nextAttemptAt!
    await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-retry', mode: 'manual', executionIntent: 'deferred_refresh', coverageEndedAt: clock,
    })
    const urls = fetchImpl.mock.calls.map(([request]) => typeof request === 'string' ? request : request instanceof URL ? request.href : request.url)
    expect(urls.filter((url) => url.includes('/swan/recommend/visitor-list/jobs'))).toHaveLength(1)
    expect(urls.filter((url) => url.endsWith('/swan/share/job/job-success'))).toHaveLength(1)
    expect(urls.filter((url) => url.endsWith('/swan/share/job/job-retry'))).toHaveLength(2)
    const revisions = database.select().from(rawSourceRevisions).all()
    const attempts = database.select().from(normalizationAttempts).all()
    const outcomes = database.select().from(normalizationFieldOutcomes).all()
    const successfulRevisionIds = revisions.filter(({ providerRecordId }) => providerRecordId === 'job-success').map(({ id }) => id)
    const retriedRevisionIds = revisions.filter(({ providerRecordId }) => providerRecordId === 'job-retry').map(({ id }) => id)
    expect(retriedRevisionIds).toHaveLength(1)
    const retriedAuthAttempts = attempts.filter(({ rawRevisionId, resolverId }) =>
      retriedRevisionIds.includes(rawRevisionId) && resolverId === 'jobright.authenticated-destination')
    expect(attempts.filter(({ rawRevisionId, resolverId }) => successfulRevisionIds.includes(rawRevisionId) && resolverId === 'jobright.authenticated-destination')).toHaveLength(1)
    expect(retriedAuthAttempts).toHaveLength(2)
    const retriedAttemptIds = new Set(retriedAuthAttempts.map(({ id }) => id))
    expect(outcomes.filter(({ attemptId, field, status }) =>
      retriedAttemptIds.has(attemptId)
      && field === 'destinationUrl'
      && status === 'resolved')).toHaveLength(1)
    expect(database.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')).toEqual([
      expect.objectContaining({
        kind: 'normalization',
        rawRevisionId: retriedRevisionIds[0],
        resolverId: 'jobright.authenticated-destination',
        state: 'completed',
        acquiredAt: null,
        acquisitionToken: null,
        acquisitionRunId: null,
      }),
    ])
    expect(database.select().from(rawSourceOccurrences).all()).toHaveLength(2)
    sqlite.close()
  })

  it('executes only the acquired Jobright v5 retry identity when multiple detail retries are due', async () => {
    const sqlitePath = createTempSqlitePath()
    let clock = '2026-07-11T12:00:00.000Z'
    const detailCalls = new Map<string, number>()
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/swan/auth/login/pwd')) return new Response(JSON.stringify({ success: true, result: {} }), {
        status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'SESSION_ID=multi-session; Path=/' },
      })
      if (url.includes('/swan/auth/newinfo')) return new Response(JSON.stringify({ success: true, result: { logined: true } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
      if (url.includes('/swan/recommend/visitor-list/jobs')) return new Response(JSON.stringify({
        success: true,
        result: { jobNum: 2, jobList: [
          { jobResult: { jobId: 'job-a', jobTitle: 'Intern A', companyName: 'Alpha Co' }, companyResult: { companyName: 'Alpha Co' } },
          { jobResult: { jobId: 'job-b', jobTitle: 'Intern B', companyName: 'Beta Co' }, companyResult: { companyName: 'Beta Co' } },
        ] },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
      const detailMatch = url.match(/\/swan\/share\/job\/(job-[ab])$/)
      if (detailMatch) {
        const jobId = detailMatch[1]!
        const count = (detailCalls.get(jobId) ?? 0) + 1
        detailCalls.set(jobId, count)
        return count === 1
          ? new Response(JSON.stringify({ success: false }), { status: 503, headers: { 'content-type': 'application/json' } })
          : jobrightDetailResponse(jobId)
      }
      throw new Error(`Unexpected multi-due fixture request: ${url}`)
    }) as typeof fetch
    const connector = createJobrightConnector({
      fetch: fetchImpl, now: () => clock, nowEpochMs: () => Date.parse(clock), random: () => 0,
    })
    const secretCodec = { decrypt: (value: string) => value.replace(/^enc:/, ''), encrypt: (value: string) => `enc:${value}` }
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      connectorRuntime: { delay: { async wait() { return 0 } } },
      now: () => new Date(clock), secretCodec, seedDataMode: 'none', sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const profiles = createSqliteProfileRepository(database, secretCodec)
    await profiles.upsertSecret({ key: 'multi-credentials', kind: 'password', label: 'Multi credentials', value: JSON.stringify({ username: 'multi@example.test', password: 'multi-password' }) })
    await repository.upsertInstance({
      id: 'jobright-multi', connectorId: 'jobright.resolver', connectorVersion: '0.8.0',
      displayName: 'Jobright multi', enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'multi-credentials' }],
      config: { discoveryCount: 2, maxRequestsPerRun: 10 }, filters: { maxResolutionCount: 2 },
      createdAt: clock,
    })

    // Jobright stops after the first retryable detail, so only job-a becomes due
    // naturally. Seed a second due normalization identity for job-b against its
    // already-captured raw revision and checkpoint eligibility.
    const first = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-multi', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: clock,
    })
    expect(first.retryHints).toMatchObject({ state: 'scheduled', reason: 'server_failure' })
    expect(detailCalls.get('job-a')).toBe(1)
    expect(detailCalls.get('job-b') ?? 0).toBe(0)
    const revisions = database.select().from(rawSourceRevisions).all()
    const jobARevision = revisions.find(({ providerRecordId }) => providerRecordId === 'job-a')
    const jobBRevision = revisions.find(({ providerRecordId }) => providerRecordId === 'job-b')
    expect(jobARevision).toBeTruthy()
    expect(jobBRevision).toBeTruthy()
    const [jobARetry] = database.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')
    expect(jobARetry).toMatchObject({
      rawRevisionId: jobARevision!.id,
      resolverId: 'jobright.authenticated-destination',
      state: 'scheduled',
    })
    const filterSignature = 'provider-state:jobright.resolver@0.8.0'
    const checkpointAfterFirst = await repository.getCheckpoint({
      connectorInstanceId: 'jobright-multi',
      filterSignature,
    })
    expect(checkpointAfterFirst).toMatchObject({
      schemaVersion: 'jobright-resolution-checkpoint@5',
      checkpoint: {
        retryState: [expect.objectContaining({ sourceId: 'jobright.public:job-a' })],
        seenSourceIds: expect.arrayContaining(['jobright.public:job-a', 'jobright.public:job-b']),
      },
    })
    const jobAAdvice = (
      checkpointAfterFirst!.checkpoint as { retryState: Array<{ sourceId: string; advice: Record<string, unknown> }> }
    ).retryState[0]!.advice
    const jobBAdvice = { ...jobAAdvice }
    const jobBNextAttemptAt = String(jobAAdvice.nextAttemptAt)
    database.insert(retryWork).values({
      id: crypto.randomUUID(),
      kind: 'normalization',
      connectorInstanceId: null,
      filterSignature: null,
      checkpointSchemaVersion: null,
      checkpointGeneration: null,
      rawRevisionId: jobBRevision!.id,
      resolverId: 'jobright.authenticated-destination',
      resolverVersion: 'jobright-authenticated-destination@1',
      inputHash: 'sha256:seeded-job-b-authenticated-destination',
      reason: 'server_failure',
      attempt: Number(jobAAdvice.attempt),
      maxAttempts: Number(jobAAdvice.maxAttempts),
      lastAttemptAt: String(jobAAdvice.lastAttemptAt),
      computedDelayMs: Number(jobAAdvice.computedDelayMs),
      serverMinimumDelayMs: null,
      nextAttemptAt: jobBNextAttemptAt,
      horizonAt: String(jobAAdvice.horizonAt),
      state: 'scheduled',
      ownerVersion: 'jobright-authenticated-destination@1',
      lineageJson: JSON.stringify({
        normalizationRunId: null,
        triggerOccurrenceId: null,
        connectorInstanceId: 'jobright-multi',
        connectorRunId: null,
        acquiredRetryWorkId: null,
        acquisitionRunId: null,
      }),
      acquiredAt: null,
      acquisitionToken: null,
      acquisitionRunId: null,
      skippedRunId: null,
      createdAt: '2026-07-11T12:00:00.500Z',
      updatedAt: '2026-07-11T12:00:00.500Z',
      deletedAt: null,
    }).run()
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-multi',
      filterSignature,
      savedAt: clock,
      coverage: {
        start: checkpointAfterFirst!.coverageStartedAt ?? '2026-07-11T11:00:00.000Z',
        end: checkpointAfterFirst!.coverageEndedAt ?? clock,
      },
      checkpoint: {
        schemaVersion: checkpointAfterFirst!.schemaVersion,
        checkpoint: {
          ...(checkpointAfterFirst!.checkpoint as Record<string, unknown>),
          pendingDetailRetries: [
            {
              sourceId: 'jobright.public:job-a',
              ownership: 'active',
              generationId: (checkpointAfterFirst!.checkpoint as { generationId?: string }).generationId ?? 'gen-multi',
              posting: { inclusion: 'included', kind: 'unknown', raw: null },
              advice: jobAAdvice,
            },
            {
              sourceId: 'jobright.public:job-b',
              ownership: 'active',
              generationId: (checkpointAfterFirst!.checkpoint as { generationId?: string }).generationId ?? 'gen-multi',
              posting: { inclusion: 'included', kind: 'unknown', raw: null },
              advice: jobBAdvice,
            },
          ],
          retryState: [
            {
              sourceId: 'jobright.public:job-a',
              advice: jobAAdvice,
            },
            {
              sourceId: 'jobright.public:job-b',
              advice: jobBAdvice,
            },
          ],
        },
      },
    })
    const dueRows = database.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')
    expect(dueRows).toHaveLength(2)
    expect(dueRows.every(({ state }) => state === 'scheduled')).toBe(true)
    const checkpointBefore = await repository.getCheckpoint({
      connectorInstanceId: 'jobright-multi',
      filterSignature,
    })
    const retryStateBefore = (checkpointBefore!.checkpoint as { retryState: Array<{ sourceId: string; advice: unknown }> }).retryState
      .slice()
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
    expect(retryStateBefore).toEqual([
      expect.objectContaining({ sourceId: 'jobright.public:job-a' }),
      expect.objectContaining({ sourceId: 'jobright.public:job-b' }),
    ])

    clock = first.retryHints!.nextAttemptAt!
    await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-multi', mode: 'manual', executionIntent: 'deferred_refresh', coverageEndedAt: clock,
    })

    // Only the earlier due identity (job-a) may be acquired and detailed again.
    expect(detailCalls.get('job-a')).toBe(2)
    expect(detailCalls.get('job-b') ?? 0).toBe(0)
    const attempts = database.select().from(normalizationAttempts).all()
    expect(attempts.filter(({ rawRevisionId, resolverId }) =>
      rawRevisionId === jobARevision!.id && resolverId === 'jobright.authenticated-destination')).toHaveLength(2)
    expect(attempts.filter(({ rawRevisionId, resolverId }) =>
      rawRevisionId === jobBRevision!.id && resolverId === 'jobright.authenticated-destination')).toHaveLength(0)

    const retryRows = database.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')
    expect(retryRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rawRevisionId: jobARevision!.id,
        state: 'completed',
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
      expect.objectContaining({
        rawRevisionId: jobBRevision!.id,
        state: 'scheduled',
        nextAttemptAt: jobBNextAttemptAt,
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
    ]))

    const checkpointAfter = await repository.getCheckpoint({
      connectorInstanceId: 'jobright-multi',
      filterSignature,
    })
    const retryStateAfter = (checkpointAfter!.checkpoint as { retryState: Array<{ sourceId: string; advice: unknown }> }).retryState
    expect(retryStateAfter.some(({ sourceId }) => sourceId === 'jobright.public:job-a')).toBe(false)
    expect(retryStateAfter).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'jobright.public:job-b' }),
    ]))
    const untouchedBefore = retryStateBefore.find(({ sourceId }) => sourceId === 'jobright.public:job-b')
    const untouchedAfter = retryStateAfter.find(({ sourceId }) => sourceId === 'jobright.public:job-b')
    expect(untouchedAfter).toEqual(untouchedBefore)
    expect(database.select().from(rawSourceOccurrences).all()).toHaveLength(2)
    sqlite.close()
  })

  it('releases acquired Jobright v5 retry work without false completion when exact persistence fails', async () => {
    const sqlitePath = createTempSqlitePath()
    let clock = '2026-07-11T12:00:00.000Z'
    let detailCalls = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/swan/auth/login/pwd')) return new Response(JSON.stringify({ success: true, result: {} }), {
        status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'SESSION_ID=fail-session; Path=/' },
      })
      if (url.includes('/swan/auth/newinfo')) return new Response(JSON.stringify({ success: true, result: { logined: true } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
      if (url.includes('/swan/recommend/visitor-list/jobs')) return new Response(JSON.stringify({
        success: true,
        result: {
          jobNum: 1,
          jobList: [
            { jobResult: { jobId: 'job-fail', jobTitle: 'Fail Intern', companyName: 'Fail Co' }, companyResult: { companyName: 'Fail Co' } },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/swan/share/job/job-fail')) {
        detailCalls += 1
        if (detailCalls === 1) {
          return new Response(JSON.stringify({ success: false }), { status: 503, headers: { 'content-type': 'application/json' } })
        }
        throw new Error('Synthetic Jobright detail transport failure before exact persistence')
      }
      throw new Error(`Unexpected failure-fixture request: ${url}`)
    }) as typeof fetch
    const connector = createJobrightConnector({
      fetch: fetchImpl, now: () => clock, nowEpochMs: () => Date.parse(clock), random: () => 0,
    })
    const secretCodec = { decrypt: (value: string) => value.replace(/^enc:/, ''), encrypt: (value: string) => `enc:${value}` }
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      connectorRuntime: { delay: { async wait() { return 0 } } },
      now: () => new Date(clock), secretCodec, seedDataMode: 'none', sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const profiles = createSqliteProfileRepository(database, secretCodec)
    await profiles.upsertSecret({ key: 'fail-credentials', kind: 'password', label: 'Fail credentials', value: JSON.stringify({ username: 'fail@example.test', password: 'fail-password' }) })
    await repository.upsertInstance({
      id: 'jobright-fail', connectorId: 'jobright.resolver', connectorVersion: '0.8.0',
      displayName: 'Jobright fail', enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'fail-credentials' }],
      config: { discoveryCount: 1, maxRequestsPerRun: 10 }, filters: { maxResolutionCount: 1 },
      createdAt: clock,
    })

    const first = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-fail', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: clock,
    })
    expect(first.retryHints).toMatchObject({ state: 'scheduled', reason: 'server_failure' })
    const revisionIds = database.select().from(rawSourceRevisions).all()
      .filter(({ providerRecordId }) => providerRecordId === 'job-fail')
      .map(({ id }) => id)
    expect(revisionIds).toHaveLength(1)
    expect(database.select().from(normalizationAttempts).all().filter(({ rawRevisionId, resolverId }) =>
      revisionIds.includes(rawRevisionId) && resolverId === 'jobright.authenticated-destination')).toHaveLength(1)

    clock = first.retryHints!.nextAttemptAt!
    const second = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-fail', mode: 'manual', executionIntent: 'deferred_refresh', coverageEndedAt: clock,
    })
    // Jobright treats transport failures as retryable connector outcomes; the run
    // may finish without throwing. Exact successful persistence must not occur,
    // and acquisition must be released to a truthful retryable state.
    expect(detailCalls).toBe(2)
    expect(second.status).not.toBe('completed')
    expect(database.select().from(normalizationFieldOutcomes).all().filter(({ field, status, attemptId }) => {
      const attempt = database.select().from(normalizationAttempts).all()
        .find(({ id, rawRevisionId, resolverId }) =>
          id === attemptId
          && revisionIds.includes(rawRevisionId)
          && resolverId === 'jobright.authenticated-destination')
      return Boolean(attempt) && field === 'destinationUrl' && status === 'resolved'
    })).toHaveLength(0)
    expect(database.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')).toEqual([
      expect.objectContaining({
        rawRevisionId: revisionIds[0],
        resolverId: 'jobright.authenticated-destination',
        state: 'scheduled',
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
    ])
    expect(database.select().from(retryWork).all().some(({ state }) => state === 'completed')).toBe(false)
    expect(database.select().from(rawSourceOccurrences).all()).toHaveLength(1)
    sqlite.close()
  })

})

function jobrightDetailResponse(jobId: string) {
  return new Response(JSON.stringify({
    success: true,
    result: {
      logined: true,
      jobDetail: {
        jobResult: {
          applyLink: `https://jobs.lever.co/example/${jobId}`,
          originalUrl: `https://jobright.ai/jobs/info/${jobId}`,
          jobTitle: jobId === 'job-success' ? 'Success Intern' : 'Retry Intern',
          companyName: jobId === 'job-success' ? 'Success Co' : 'Retry Co',
          isCompanySiteLink: true,
        },
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
