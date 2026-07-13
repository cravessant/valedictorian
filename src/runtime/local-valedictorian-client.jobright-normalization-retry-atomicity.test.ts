import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import { connectorOverviewListResultSchema } from 'sparxie'
import {
  connectorCheckpoints,
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationRuns,
  rawSourceOccurrences,
  rawSourceRevisions,
  retryWork,
} from '../db/schema'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import { createSqliteProfileRepository } from '../modules/profile/profile.repository'
import { createSqliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'
import {
  publicConnectorRunsListResult,
  publicConnectorRunSummary,
} from './local-connector-public-run'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-client-')), 'valedictorian.sqlite')
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
          jobTitle: 'Retry Intern',
          companyName: 'Retry Co',
          isCompanySiteLink: true,
        },
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('runtime Jobright normalization retry atomicity', () => {
  it('does not acquire Jobright exact work when the v5 pending entry is missing', async () => {
    const sqlitePath = createTempSqlitePath()
    let clock = '2026-07-11T12:00:00.000Z'
    let detailCalls = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/swan/auth/login/pwd')) return new Response(JSON.stringify({ success: true, result: {} }), {
        status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'SESSION_ID=prep-session; Path=/' },
      })
      if (url.includes('/swan/auth/newinfo')) return new Response(JSON.stringify({ success: true, result: { logined: true } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
      if (url.includes('/swan/recommend/visitor-list/jobs')) return new Response(JSON.stringify({
        success: true,
        result: {
          jobNum: 1,
          jobList: [
            { jobResult: { jobId: 'job-prep', jobTitle: 'Prep Intern', companyName: 'Prep Co' }, companyResult: { companyName: 'Prep Co' } },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/swan/share/job/job-prep')) {
        detailCalls += 1
        return new Response(JSON.stringify({ success: false }), { status: 503, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected prep-failure fixture request: ${url}`)
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
    await profiles.upsertSecret({ key: 'prep-credentials', kind: 'password', label: 'Prep', value: JSON.stringify({ username: 'prep@example.test', password: 'prep-password' }) })
    await repository.upsertInstance({
      id: 'jobright-prep', connectorId: 'jobright.resolver', connectorVersion: '0.11.0',
      displayName: 'Jobright prep', enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'prep-credentials' }],
      config: { discoveryCount: 1 }, filters: {},
      createdAt: clock,
    })

    await client.connectors.status.reconnect({ connectorInstanceId: 'jobright-prep' })
    const first = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-prep', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: clock,
    })
    expect(first.retryHints).toMatchObject({ state: 'scheduled', reason: 'server_failure' })
    const filterSignature = 'provider-state:jobright.resolver@0.11.0'
    const checkpoint = await repository.getCheckpoint({ connectorInstanceId: 'jobright-prep', filterSignature })
    expect(checkpoint).toBeTruthy()
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-prep',
      filterSignature,
      savedAt: clock,
      coverage: {
        start: checkpoint!.coverageStartedAt ?? '2026-07-11T11:00:00.000Z',
        end: checkpoint!.coverageEndedAt ?? clock,
      },
      checkpoint: {
        schemaVersion: checkpoint!.schemaVersion,
        checkpoint: {
          ...(checkpoint!.checkpoint as Record<string, unknown>),
          pendingDetailRetries: [],
          retryState: [],
        },
      },
    })

    clock = first.retryHints!.nextAttemptAt!
    const second = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-prep', mode: 'manual', executionIntent: 'deferred_refresh', coverageEndedAt: clock,
    })
    expect(second.coverage.start).toBe('2026-07-04T00:00:00.000Z')
    expect(database.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')).toEqual([
      expect.objectContaining({
        state: 'scheduled',
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
    ])
    expect(database.select().from(retryWork).all().some(({ state }) => state === 'acquired')).toBe(false)
    sqlite.close()
  })

  it('does not leave completed retry work with an old checkpoint when finalization fails after exact success', async () => {
    const sqlitePath = createTempSqlitePath()
    let clock = '2026-07-11T12:00:00.000Z'
    let detailCalls = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/swan/auth/login/pwd')) return new Response(JSON.stringify({ success: true, result: {} }), {
        status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'SESSION_ID=final-session; Path=/' },
      })
      if (url.includes('/swan/auth/newinfo')) return new Response(JSON.stringify({ success: true, result: { logined: true } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
      if (url.includes('/swan/recommend/visitor-list/jobs')) return new Response(JSON.stringify({
        success: true,
        result: {
          jobNum: 1,
          jobList: [
            { jobResult: { jobId: 'job-final', jobTitle: 'Final Intern', companyName: 'Final Co' }, companyResult: { companyName: 'Final Co' } },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/swan/share/job/job-final')) {
        detailCalls += 1
        return detailCalls === 1
          ? new Response(JSON.stringify({ success: false }), { status: 503, headers: { 'content-type': 'application/json' } })
          : jobrightDetailResponse('job-final')
      }
      throw new Error(`Unexpected finalization-failure fixture request: ${url}`)
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
    await profiles.upsertSecret({ key: 'final-credentials', kind: 'password', label: 'Final', value: JSON.stringify({ username: 'final@example.test', password: 'final-password' }) })
    await repository.upsertInstance({
      id: 'jobright-final', connectorId: 'jobright.resolver', connectorVersion: '0.11.0',
      displayName: 'Jobright final', enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'final-credentials' }],
      config: { discoveryCount: 1 }, filters: {},
      createdAt: clock,
    })

    await client.connectors.status.reconnect({ connectorInstanceId: 'jobright-final' })
    const first = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-final', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: clock,
    })
    expect(first.retryHints).toMatchObject({ state: 'scheduled', reason: 'server_failure' })
    const filterSignature = 'provider-state:jobright.resolver@0.11.0'
    const checkpointBefore = await repository.getCheckpoint({ connectorInstanceId: 'jobright-final', filterSignature })
    expect((checkpointBefore!.checkpoint as { retryState: unknown[] }).retryState).toEqual([
      expect.objectContaining({ sourceId: 'jobright.public:job-final' }),
    ])

    sqlite.exec(`
      create trigger inject_checkpoint_finalization_failure
      before update on connector_checkpoints
      begin
        select raise(abort, 'injected checkpoint finalization failure');
      end;
    `)

    clock = first.retryHints!.nextAttemptAt!
    await expect(client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-final', mode: 'manual', executionIntent: 'deferred_refresh', coverageEndedAt: clock,
    })).rejects.toThrow(/injected checkpoint finalization failure|Canonical sourcing projection failed|Connector execution failed/i)

    expect(detailCalls).toBe(2)
    sqlite.close()
    const verifySqlite = createFileDatabase(sqlitePath)
    const verifyDb = createDrizzleDatabase(verifySqlite)
    const verifyRepository = createSqliteConnectorRepository(verifyDb)
    const revisionId = verifyDb.select().from(rawSourceRevisions).all()
      .find(({ providerRecordId }) => providerRecordId === 'job-final')!.id
    expect(verifyDb.select().from(normalizationAttempts).all().filter(({ rawRevisionId, resolverId }) =>
      rawRevisionId === revisionId && resolverId === 'jobright.authenticated-destination').length).toBeGreaterThanOrEqual(2)
    expect(verifyDb.select().from(normalizationFieldOutcomes).all().some(({ field, status }) =>
      field === 'destinationUrl' && status === 'resolved')).toBe(true)

    const retryRows = verifyDb.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')
    expect(retryRows).toEqual([
      expect.objectContaining({
        rawRevisionId: revisionId,
        state: 'scheduled',
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
    ])
    expect(retryRows.some(({ state }) => state === 'completed')).toBe(false)
    const checkpointAfter = await verifyRepository.getCheckpoint({ connectorInstanceId: 'jobright-final', filterSignature })
    expect((checkpointAfter!.checkpoint as { retryState: Array<{ sourceId: string }> }).retryState).toEqual([
      expect.objectContaining({ sourceId: 'jobright.public:job-final' }),
    ])
    expect(verifyDb.select().from(connectorCheckpoints).all()).toHaveLength(1)
    verifySqlite.close()
  })

  it('recovers persisted exact Jobright success without another provider detail request', async () => {
    const sqlitePath = createTempSqlitePath()
    let clock = '2026-07-11T12:00:00.000Z'
    let detailCalls = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/swan/auth/login/pwd')) return new Response(JSON.stringify({ success: true, result: {} }), {
        status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'SESSION_ID=recover-session; Path=/' },
      })
      if (url.includes('/swan/auth/newinfo')) return new Response(JSON.stringify({ success: true, result: { logined: true } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
      if (url.includes('/swan/recommend/visitor-list/jobs')) return new Response(JSON.stringify({
        success: true,
        result: {
          jobNum: 1,
          jobList: [
            { jobResult: { jobId: 'job-recover', jobTitle: 'Recover Intern', companyName: 'Recover Co' }, companyResult: { companyName: 'Recover Co' } },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/swan/share/job/job-recover')) {
        detailCalls += 1
        return detailCalls === 1
          ? new Response(JSON.stringify({ success: false }), { status: 503, headers: { 'content-type': 'application/json' } })
          : jobrightDetailResponse('job-recover')
      }
      throw new Error(`Unexpected recovery fixture request: ${url}`)
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
    await profiles.upsertSecret({ key: 'recover-credentials', kind: 'password', label: 'Recover', value: JSON.stringify({ username: 'recover@example.test', password: 'recover-password' }) })
    await repository.upsertInstance({
      id: 'jobright-recover', connectorId: 'jobright.resolver', connectorVersion: '0.11.0',
      displayName: 'Jobright recover', enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'recover-credentials' }],
      config: { discoveryCount: 1 }, filters: {},
      createdAt: clock,
    })

    await client.connectors.status.reconnect({ connectorInstanceId: 'jobright-recover' })
    const first = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-recover', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: clock,
    })
    expect(first.retryHints).toMatchObject({ state: 'scheduled', reason: 'server_failure' })
    const filterSignature = 'provider-state:jobright.resolver@0.11.0'
    sqlite.exec(`
      create trigger inject_checkpoint_recovery_failure
      before update on connector_checkpoints
      begin
        select raise(abort, 'injected checkpoint recovery failure');
      end;
    `)
    clock = first.retryHints!.nextAttemptAt!
    await expect(client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-recover', mode: 'manual', executionIntent: 'deferred_refresh', coverageEndedAt: clock,
    })).rejects.toThrow(/injected checkpoint recovery failure|Canonical sourcing projection failed|Connector execution failed/i)
    expect(detailCalls).toBe(2)
    sqlite.close()
    const midSqlite = createFileDatabase(sqlitePath)
    const midDb = createDrizzleDatabase(midSqlite)
    expect(midDb.select().from(retryWork).all()).toEqual([
      expect.objectContaining({ state: 'scheduled', acquisitionRunId: null }),
    ])

    midSqlite.exec('drop trigger inject_checkpoint_recovery_failure')
    const detailCallsBeforeRecovery = detailCalls
    const revisionId = midDb.select().from(rawSourceRevisions).all()
      .find(({ providerRecordId }) => providerRecordId === 'job-recover')!.id
    const retryBeforeRecovery = midDb.select().from(retryWork).all()
      .find(({ rawRevisionId }) => rawRevisionId === revisionId)!
    const authAttempts = midDb.select().from(normalizationAttempts).all()
      .filter(({ rawRevisionId, resolverId }) =>
        rawRevisionId === revisionId && resolverId === 'jobright.authenticated-destination')
    const authAttemptsBefore = authAttempts.length
    const currentWindowSuccess = authAttempts.find(({ status, completedAt }) =>
      status === 'completed'
      && completedAt != null
      && completedAt > retryBeforeRecovery.lastAttemptAt)
    expect(currentWindowSuccess).toBeTruthy()

    clock = new Date(Date.parse(clock) + 1_000).toISOString()
    midDb.update(retryWork).set({ nextAttemptAt: clock }).run()
    midSqlite.close()

    const recovered = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-recover', mode: 'manual', executionIntent: 'deferred_refresh', coverageEndedAt: clock,
    })

    expect(detailCalls).toBe(detailCallsBeforeRecovery)
    expect(publicConnectorRunSummary(recovered)).toMatchObject({
      status: 'completed',
      outcome: { kind: 'yielded', reason: 'invocation_budget' },
      lifecycleCounts: { source: 'frozen_terminal' },
    })
    expect(publicConnectorRunsListResult(await client.connectors.runs.list({
      connectorInstanceId: 'jobright-recover', limit: 1,
    })).items[0]).toMatchObject({
      status: 'completed',
      outcome: { kind: 'yielded', reason: 'invocation_budget' },
    })
    expect(connectorOverviewListResultSchema.parse(
      await client.connectors.overview.list({ enabled: true }),
    ).items[0]).toMatchObject({
      id: 'jobright-recover',
      health: { status: 'skipped' },
      latestRun: { status: 'completed', outcome: 'yielded' },
    })
    const verifySqlite = createFileDatabase(sqlitePath)
    const verifyDb = createDrizzleDatabase(verifySqlite)
    const verifyRepository = createSqliteConnectorRepository(verifyDb)
    expect(verifyDb.select().from(normalizationAttempts).all().filter(({ rawRevisionId, resolverId }) =>
      rawRevisionId === revisionId && resolverId === 'jobright.authenticated-destination')).toHaveLength(authAttemptsBefore)
    expect(verifyDb.select().from(retryWork).all()).toEqual([
      expect.objectContaining({
        rawRevisionId: revisionId,
        state: 'completed',
        acquisitionRunId: null,
        acquiredAt: null,
        acquisitionToken: null,
      }),
    ])
    const checkpointAfter = await verifyRepository.getCheckpoint({ connectorInstanceId: 'jobright-recover', filterSignature })
    expect((checkpointAfter!.checkpoint as { retryState: unknown[] }).retryState).toEqual([])
    expect(verifyDb.select().from(rawSourceOccurrences).all()).toHaveLength(1)
    verifySqlite.close()
  })

  it('does not recover a prior exact success across a later reopened Jobright retry window', async () => {
    const sqlitePath = createTempSqlitePath()
    let clock = '2026-07-11T12:00:00.000Z'
    let detailCalls = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/swan/auth/login/pwd')) return new Response(JSON.stringify({ success: true, result: {} }), {
        status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'SESSION_ID=reopen-session; Path=/' },
      })
      if (url.includes('/swan/auth/newinfo')) return new Response(JSON.stringify({ success: true, result: { logined: true } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
      if (url.includes('/swan/recommend/visitor-list/jobs')) return new Response(JSON.stringify({
        success: true,
        result: {
          jobNum: 1,
          jobList: [
            { jobResult: { jobId: 'job-reopen', jobTitle: 'Reopen Intern', companyName: 'Reopen Co' }, companyResult: { companyName: 'Reopen Co' } },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/swan/share/job/job-reopen')) {
        detailCalls += 1
        return new Response(JSON.stringify({ success: false }), { status: 503, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected reopen-window fixture request: ${url}`)
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
    await profiles.upsertSecret({ key: 'reopen-credentials', kind: 'password', label: 'Reopen', value: JSON.stringify({ username: 'reopen@example.test', password: 'reopen-password' }) })
    await repository.upsertInstance({
      id: 'jobright-reopen', connectorId: 'jobright.resolver', connectorVersion: '0.11.0',
      displayName: 'Jobright reopen', enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'reopen-credentials' }],
      config: { discoveryCount: 1 }, filters: {},
      createdAt: clock,
    })

    await client.connectors.status.reconnect({ connectorInstanceId: 'jobright-reopen' })
    const first = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-reopen', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: clock,
    })
    expect(first.retryHints).toMatchObject({ state: 'scheduled', reason: 'server_failure' })
    expect(detailCalls).toBe(1)
    const filterSignature = 'provider-state:jobright.resolver@0.11.0'
    sqlite.close()

    const midSqlite = createFileDatabase(sqlitePath)
    const midDb = createDrizzleDatabase(midSqlite)
    const revisionId = midDb.select().from(rawSourceRevisions).all()
      .find(({ providerRecordId }) => providerRecordId === 'job-reopen')!.id
    const retryRow = midDb.select().from(retryWork).all().find(({ rawRevisionId }) => rawRevisionId === revisionId)!
    expect(retryRow).toMatchObject({
      state: 'scheduled',
      resolverId: 'jobright.authenticated-destination',
      inputHash: expect.any(String),
      lastAttemptAt: expect.any(String),
    })

    // Prior-window success for the same identity cardinality key must not satisfy
    // recovery for the currently outstanding retry window (lastAttemptAt).
    const priorSuccessAt = new Date(Date.parse(retryRow.lastAttemptAt) - 60_000).toISOString()
    const rawRecordId = midDb.select().from(rawSourceRevisions).all()
      .find(({ id }) => id === revisionId)!.rawRecordId
    midDb.insert(normalizationRuns).values({
      id: 'normalization-run-prior-success',
      rawRecordId,
      rawRevisionId: revisionId,
      triggerOccurrenceId: null,
      triggerConnectorInstanceId: null,
      triggerConnectorRunId: null,
      inputHash: 'sha256:prior-success-run',
      resolverSetHash: 'sha256:resolver-set',
      canonicalSchemaVersion: 'canonical-candidate@1',
      gatePolicyVersion: 'normalization-gate@1',
      triggerKind: 'intake',
      triggerId: null,
      status: 'completed',
      createdAt: priorSuccessAt,
      updatedAt: priorSuccessAt,
    }).run()
    midDb.insert(normalizationAttempts).values({
      id: 'attempt-prior-success',
      runId: 'normalization-run-prior-success',
      rawRevisionId: revisionId,
      sequence: 0,
      resolverId: retryRow.resolverId!,
      resolverVersion: retryRow.resolverVersion!,
      inputHash: retryRow.inputHash!,
      declarationJson: JSON.stringify({
        id: retryRow.resolverId,
        version: retryRow.resolverVersion,
        outputFields: ['destinationUrl'],
      }),
      applicabilityJson: '[]',
      status: 'completed',
      startedAt: priorSuccessAt,
      completedAt: priorSuccessAt,
    }).run()
    midDb.insert(normalizationFieldOutcomes).values({
      id: 'outcome-prior-success',
      runId: 'normalization-run-prior-success',
      attemptId: 'attempt-prior-success',
      sequence: 0,
      attemptSequence: 0,
      outcomeIndex: 0,
      field: 'destinationUrl',
      status: 'resolved',
      resolverId: retryRow.resolverId!,
      resolverVersion: retryRow.resolverVersion!,
      inputHash: retryRow.inputHash!,
      outcomeJson: JSON.stringify({
        resolverId: retryRow.resolverId,
        resolverVersion: retryRow.resolverVersion,
        field: 'destinationUrl',
        inputHash: retryRow.inputHash,
        status: 'resolved',
        value: 'https://jobs.lever.co/example/prior-success',
        confidence: 1,
      }),
    }).run()

    const probeNormalization = createSqliteNormalizationRepository(midDb)
    expect(probeNormalization.hasExactSuccessfulNormalizationAttempt({
      rawRevisionId: revisionId,
      resolverId: retryRow.resolverId!,
      resolverVersion: retryRow.resolverVersion!,
      inputHash: retryRow.inputHash!,
      retryWindowStartedAt: retryRow.lastAttemptAt,
    })).toBe(false)
    midSqlite.close()

    const detailCallsBeforeDueAcquisition = detailCalls
    clock = first.retryHints!.nextAttemptAt!
    await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-reopen', mode: 'manual', executionIntent: 'deferred_refresh', coverageEndedAt: clock,
    })

    expect(detailCalls).toBeGreaterThan(detailCallsBeforeDueAcquisition)
    const verifySqlite = createFileDatabase(sqlitePath)
    const verifyDb = createDrizzleDatabase(verifySqlite)
    const verifyRepository = createSqliteConnectorRepository(verifyDb)
    expect(verifyDb.select().from(retryWork).all().filter(({ kind }) => kind === 'normalization')).toEqual([
      expect.objectContaining({
        rawRevisionId: revisionId,
        state: 'scheduled',
        acquisitionRunId: null,
      }),
    ])
    const checkpointAfter = await verifyRepository.getCheckpoint({ connectorInstanceId: 'jobright-reopen', filterSignature })
    expect((checkpointAfter!.checkpoint as { retryState: Array<{ sourceId: string }> }).retryState).toEqual([
      expect.objectContaining({ sourceId: 'jobright.public:job-reopen' }),
    ])
    verifySqlite.close()
  })
})
