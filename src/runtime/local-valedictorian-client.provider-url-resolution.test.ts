import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import { describe, expect, it, vi } from 'vitest'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createSourceExecutionGovernor } from '../modules/source-execution/source-execution-governor'
import { createProviderUrlResolutionRuntime } from '../modules/sourcing/provider-url-resolution.runtime'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../db/sqlite'
import type {
  AppConnectorRuntime,
  AppJobConnector,
} from '../modules/connectors/connector.runner'
import type { ProviderUrlResolverResult } from '../modules/sourcing/provider-url-resolution.outcome'
import type { LocalScheduledWorkSource } from './local-scheduler'
import { createLocalValedictorianClient } from './local-valedictorian-client'

interface ProviderUrlResolverConnector extends AppJobConnector {
  providerUrlResolver: {
    id: string
    version: string
    resolve(
      input: {
        connectorInstanceId: string
        executionScopeId: string
        providerRecordId: string
        workspaceId: string
      },
      runtime: Pick<AppConnectorRuntime, 'auth' | 'cancellation'>,
    ): Promise<ProviderUrlResolverResult>
  }
}

describe('runtime provider URL resolution', () => {
  it('does not invoke a disabled connector provider resolver', async () => {
    const fixture = await createProviderRuntimeFixture(false)
    const result = await fixture.runtime(fixture.work)

    expect(result).toEqual({ status: 'terminal', reason: 'provider_url_connector_disabled' })
    expect(fixture.resolve).not.toHaveBeenCalled()
    fixture.sqlite.close()
  })

  it('does not invoke a provider resolver while its source scope is cooling down', async () => {
    const fixture = await createProviderRuntimeFixture(true)
    fixture.governor.blockScope(fixture.scopeId, {
      now: fixture.now,
      serverMinimumDelayMs: 60_000,
      random: () => 0,
    })

    const result = await fixture.runtime(fixture.work)

    expect(result).toMatchObject({
      status: 'retryable', reason: 'source_scope_cooldown', retryReason: 'rate_limit', serverMinimumDelayMs: 60_000,
    })
    expect(fixture.resolve).not.toHaveBeenCalled()
    fixture.sqlite.close()
  })

  it('propagates provider Retry-After into the shared source governor', async () => {
    const fixture = await createProviderRuntimeFixture(true)
    fixture.resolve.mockResolvedValue({
      status: 'retryable', reason: 'provider_rate_limited',
      retryReason: 'rate_limit', serverMinimumDelayMs: 120_000,
    })

    const result = await fixture.runtime(fixture.work)

    expect(result).toMatchObject({ status: 'retryable', retryReason: 'rate_limit' })
    expect(fixture.governor.getScope(fixture.scopeId)).toMatchObject({
      status: 'cooldown', blockedUntil: '2026-07-16T12:02:00.000Z',
    })
    fixture.sqlite.close()
  })

  it('runs the published Jobright 0.14 connector as Capture then scheduled provider resolution', async () => {
    const clock = new Date('2026-07-17T07:00:00.000Z')
    const destinationUrl = 'https://careers.example.com/openings/software-engineer?source=jobright&ref=a%2Bb'
    const registeredSources: LocalScheduledWorkSource[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      if (url.includes('/swan/auth/login/pwd')) {
        return new Response(JSON.stringify({ success: true, result: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'SESSION_ID=published-connector-session; Path=/',
          },
        })
      }
      if (url.includes('/swan/auth/newinfo')) {
        return new Response(JSON.stringify({ success: true, result: { logined: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/swan/recommend/search')) {
        const position = Number(new URL(url).searchParams.get('position'))
        return new Response(JSON.stringify({
          success: true,
          result: {
            jobNum: 1,
            jobList: position === 0 ? [{
              jobResult: {
                jobId: 'published-job',
                jobTitle: 'Software Engineer',
                companyName: 'Example',
                publishTime: '2026-07-16T12:00:00.000Z',
              },
              companyResult: { companyName: 'Example' },
            }] : [],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.endsWith('/swan/share/job/published-job')) {
        return new Response(JSON.stringify({
          success: true,
          result: {
            logined: true,
            jobDetail: {
              jobResult: {
                applyLink: destinationUrl,
                originalUrl: 'https://jobright.ai/jobs/info/published-job',
                jobTitle: 'Software Engineer',
                companyName: 'Example',
                isCompanySiteLink: true,
              },
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected published connector request: ${url}`)
    }) as typeof fetch
    const connector = createJobrightConnector({
      fetch: fetchImpl,
      now: () => clock.toISOString(),
      nowEpochMs: () => clock.getTime(),
      nowMs: () => clock.getTime(),
      random: () => 0,
    })
    const pgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'published-provider-url-'))
    const secretCodec = {
      encrypt: (value: string) => `enc:${value}`,
      decrypt: (value: string) => value.replace(/^enc:/, ''),
    }
    const client = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      connectorRuntime: { delay: { async wait() { return 0 } } },
      now: () => clock,
      registerScheduledWorkSource: (source) => registeredSources.push(source),
      secretCodec,
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: 'workspace-published-provider-url',
    })
    await client.secrets.upsert({
      key: 'published-jobright-credentials',
      kind: 'password',
      label: 'Published Jobright credentials',
      value: JSON.stringify({ username: 'fixture@example.test', password: 'fixture-password' }),
    })
    await client.connectors.create({
      id: 'published-jobright',
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      displayName: 'Published Jobright',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        secretKey: 'published-jobright-credentials',
      }],
      config: { discoveryCount: 1 },
      filters: {
        jobTaxonomyList: [{
          taxonomyId: 'software-engineering',
          title: 'Software Engineering',
        }],
      },
      earliestBackfillDate: '2026-07-01',
    })
    await client.connectors.status.reconnect({ connectorInstanceId: 'published-jobright' })

    const run = await client.connectors.runs.trigger({
      connectorInstanceId: 'published-jobright',
      mode: 'manual',
      coverageEndedAt: clock.toISOString(),
    })

    expect(run.status).toBe('completed')
    expect(fetchImpl.mock.calls.some(([request]) => requestUrl(request).includes('/swan/share/job/')))
      .toBe(false)
    const source = registeredSources.find(({ id }) => id === 'provider-url-resolution')
    expect(source).toBeDefined()
    expect(await source!.nextDueAt()).toBe(clock.toISOString())

    await source!.runDue()

    expect(fetchImpl.mock.calls.filter(([request]) =>
      requestUrl(request).endsWith('/swan/share/job/published-job'))).toHaveLength(1)
    const captures = await client.sourcing.rawRecords.list({
      connectorInstanceId: 'published-jobright',
      limit: 10,
    })
    expect(captures.items).toHaveLength(1)
    const normalization = await client.sourcing.rawRecords.normalization.get(captures.items[0]!.id)
    expect(normalization.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'destinationUrl',
        resolverId: 'jobright.provider-url',
        status: 'resolved',
        value: {
          class: 'employer_or_ats',
          intermediaryUrl: 'https://jobright.ai/jobs/info/published-job',
          url: destinationUrl,
        },
      }),
    ]))
    expect(normalization.canonicalCandidate).toMatchObject({
      companyName: 'Example',
      roleTitle: 'Software Engineer',
      destination: { url: destinationUrl },
    })
  })

  it('acknowledges Capture and completes backfill before scheduled provider resolution runs', async () => {
    const clock = new Date('2026-07-16T12:00:00.000Z')
    const registeredSources: LocalScheduledWorkSource[] = []
    const resolve = vi.fn(async (
      input: {
        connectorInstanceId: string
        executionScopeId: string
        providerRecordId: string
        workspaceId: string
      },
      runtime: Pick<AppConnectorRuntime, 'auth' | 'cancellation'>,
    ): Promise<ProviderUrlResolverResult> => {
      expect(await runtime.auth.resolve({ id: 'anonymous', mode: 'none' }))
        .toMatchObject({ status: 'ready' })
      return {
        status: 'resolved',
        url: 'https://jobs.lever.co/example/opening-1?utm_source=jobright&ref=a%2Bb',
        method: 'fixture_provider_detail',
      }
    })
    const connector: ProviderUrlResolverConnector = {
      definition: {
        id: 'jobright.resolver',
        version: '0.14.0',
        displayName: 'Jobright fixture',
        capabilities: {
          fetchesPublicPages: false,
          resolvesIntermediaryLinks: true,
          supportsFiltering: false,
          supportsIncrementalRefresh: true,
        },
        checkpoint: { schemaVersion: 'jobright-capture-checkpoint@1' },
      },
      providerUrlResolver: {
        id: 'jobright.provider-url',
        version: 'jobright-provider-url@1',
        resolve,
      },
      async refresh(input, runtime) {
        await runtime.rawSourceIntake?.capture({
          observedAt: clock.toISOString(),
          providerRecordId: 'provider-one',
          providerSchema: 'jobright-authenticated-search@1',
          reportedOrigin: {
            kind: 'aggregator',
            name: 'Jobright',
            providerId: 'jobright',
          },
          payload: { companyName: 'Example', roleTitle: 'Engineer' },
          evidence: [{
            kind: 'provider_api_record',
            label: 'Jobright fixture row',
            value: { providerRecordId: 'provider-one' },
          }],
        })
        return {
          coverage: input.coverage,
          nextCheckpoint: {
            checkpoint: { cursor: 'capture-complete' },
            schemaVersion: 'jobright-capture-checkpoint@1',
          },
          observations: [],
          operationOutcome: null,
          stats: { captures: 1, observations: 0 },
          status: 'completed',
          synchronization: {
            newestFrontier: { state: 'caught_up' },
            historicalBackfill: {
              state: 'boundary_reached',
              boundary: { earliestDate: input.coverage.start.slice(0, 10) },
            },
            pendingResolutionCount: 1,
            outcome: { kind: 'boundary_exhausted' },
          },
          warnings: [],
        }
      },
    }
    const pgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-url-runtime-'))
    const client = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      now: () => clock,
      registerScheduledWorkSource: (source) => registeredSources.push(source),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: 'workspace-provider-url',
    })
    await client.connectors.create({
      id: 'jobright-one',
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      displayName: 'Jobright fixture',
      enabled: true,
      earliestBackfillDate: '2026-07-01',
    })

    const run = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-one',
      mode: 'manual',
      coverageEndedAt: clock.toISOString(),
    })

    expect(run.status).toBe('completed')
    expect(resolve).not.toHaveBeenCalled()
    const source = registeredSources.find(({ id }) => id === 'provider-url-resolution')
    expect(source).toBeDefined()
    expect(await source!.nextDueAt()).toBe(clock.toISOString())

    await source!.runDue()

    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorInstanceId: 'jobright-one',
        providerRecordId: 'provider-one',
        workspaceId: 'workspace-provider-url',
      }),
      expect.objectContaining({ auth: expect.any(Object) }),
    )
    const captures = await client.sourcing.rawRecords.list({
      connectorInstanceId: 'jobright-one',
      limit: 10,
    })
    const normalization = await client.sourcing.rawRecords.normalization.get(
      captures.items[0]!.id,
    )
    const projection = await client.sourcing.rawRevisions.projection.get(
      captures.items[0]!.latestRevision.id,
    )
    expect(normalization.fieldOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'destinationUrl',
        status: 'resolved',
        value: {
          class: 'employer_or_ats',
          intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
          url: 'https://jobs.lever.co/example/opening-1?utm_source=jobright&ref=a%2Bb',
        },
      }),
    ]))
    expect(normalization.canonicalCandidate).toMatchObject({
      companyName: 'Example',
      roleTitle: 'Engineer',
      destination: {
        url: 'https://jobs.lever.co/example/opening-1?utm_source=jobright&ref=a%2Bb',
      },
    })
    expect(projection).toMatchObject({
      status: 'projected',
      normalizationStatus: 'completed',
      gateStatus: 'passed',
      finding: expect.objectContaining({ id: expect.any(String) }),
    })
  })

  it('redacts resolver evidence and reasons before persisting terminal outcomes', async () => {
    const clock = new Date('2026-07-16T12:00:00.000Z')
    const registeredSources: LocalScheduledWorkSource[] = []
    const secretCodec = {
      encrypt: (value: string) => `enc:${value}`,
      decrypt: (value: string) => value.replace(/^enc:/, ''),
    }
    const resolve = vi.fn(async (
      _input: {
        connectorInstanceId: string
        executionScopeId: string
        providerRecordId: string
        workspaceId: string
      },
      runtime: Pick<AppConnectorRuntime, 'auth' | 'cancellation'>,
    ): Promise<ProviderUrlResolverResult> => {
      const grant = await runtime.auth.resolve({ id: 'provider-key', mode: 'api_key' })
      return {
        status: 'terminal',
        reason: `upstream_${grant.value ?? 'missing'}`,
        evidence: [{ kind: 'upstream_response', value: grant.value }],
      }
    })
    const connector: ProviderUrlResolverConnector = {
      definition: {
        id: 'jobright.resolver',
        version: '0.14.0',
        displayName: 'Jobright fixture',
        auth: { requirements: [{ id: 'provider-key', mode: 'api_key' }] },
        capabilities: {
          fetchesPublicPages: false,
          resolvesIntermediaryLinks: true,
          supportsFiltering: false,
          supportsIncrementalRefresh: true,
        },
        checkpoint: { schemaVersion: 'jobright-capture-checkpoint@1' },
      },
      providerUrlResolver: {
        id: 'jobright.provider-url',
        version: 'jobright-provider-url@1',
        resolve,
      },
      async refresh(input, runtime) {
        await runtime.rawSourceIntake?.capture({
          observedAt: clock.toISOString(),
          providerRecordId: 'provider-secret',
          providerSchema: 'jobright-authenticated-search@1',
          reportedOrigin: { kind: 'aggregator', name: 'Jobright', providerId: 'jobright' },
          payload: { companyName: 'Example', roleTitle: 'Engineer' },
          evidence: [],
        })
        return {
          coverage: input.coverage,
          nextCheckpoint: {
            checkpoint: { cursor: 'capture-complete' },
            schemaVersion: 'jobright-capture-checkpoint@1',
          },
          observations: [],
          operationOutcome: null,
          stats: { captures: 1, observations: 0 },
          status: 'completed',
          synchronization: {
            newestFrontier: { state: 'caught_up' },
            historicalBackfill: {
              state: 'boundary_reached',
              boundary: { earliestDate: input.coverage.start.slice(0, 10) },
            },
            pendingResolutionCount: 1,
            outcome: { kind: 'boundary_exhausted' },
          },
          warnings: [],
        }
      },
    }
    const pgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-url-redaction-'))
    const client = createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      now: () => clock,
      registerScheduledWorkSource: (source) => registeredSources.push(source),
      secretCodec,
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: 'workspace-provider-url-redaction',
    })
    await client.secrets.upsert({
      key: 'provider-secret', kind: 'token', label: 'Provider key', value: 'super-secret',
    })
    await client.connectors.create({
      id: 'jobright-secret',
      connectorId: connector.definition.id,
      connectorVersion: connector.definition.version,
      displayName: 'Jobright fixture',
      enabled: true,
      auth: [{ id: 'provider-key', mode: 'api_key', secretKey: 'provider-secret' }],
      earliestBackfillDate: '2026-07-01',
    })

    const run = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-secret',
      mode: 'manual',
      coverageEndedAt: clock.toISOString(),
    })
    expect(run.status).toBe('completed')
    const source = registeredSources.find(({ id }) => id === 'provider-url-resolution')
    expect(source).toBeDefined()
    await source!.runDue()

    const captures = await client.sourcing.rawRecords.list({
      connectorInstanceId: 'jobright-secret',
      limit: 10,
    })
    const normalization = await client.sourcing.rawRecords.normalization.get(
      captures.items[0]!.id,
    )
    const terminalOutcome = normalization.fieldOutcomes.find(({ field }) => field === 'destinationUrl')
    expect(terminalOutcome).toMatchObject({
      status: 'blocked',
      reason: 'upstream_[redacted-secret]',
      evidence: [{ kind: 'upstream_response', value: '[redacted-secret]' }],
    })
    expect(JSON.stringify(terminalOutcome)).not.toContain('super-secret')
  })
})

async function createProviderRuntimeFixture(enabled: boolean) {
  const now = '2026-07-16T12:00:00.000Z'
  const sqlite = createInMemoryDatabase()
  migrateDatabase(sqlite)
  const database = createDrizzleDatabase(sqlite)
  const connectorRepository = createSqliteConnectorRepository(database)
  const resolve = vi.fn(async (): Promise<ProviderUrlResolverResult> => ({
    status: 'resolved',
    url: 'https://jobs.lever.co/example/opening-1',
    method: 'fixture_provider_detail',
  }))
  const connector: ProviderUrlResolverConnector = {
    definition: {
      id: 'jobright.resolver', version: '0.14.0', displayName: 'Jobright fixture',
      capabilities: {
        fetchesPublicPages: false, resolvesIntermediaryLinks: true,
        supportsFiltering: false, supportsIncrementalRefresh: true,
      },
      checkpoint: { schemaVersion: 'jobright-capture-checkpoint@1' },
    },
    providerUrlResolver: { id: 'jobright.provider-url', version: 'jobright-provider-url@1', resolve },
    async refresh() { throw new Error('not used') },
  }
  const instance = await connectorRepository.upsertInstance({
    id: 'provider-runtime', connectorId: connector.definition.id,
    connectorVersion: connector.definition.version, displayName: 'Provider runtime', enabled,
    createdAt: now,
  })
  const governor = createSourceExecutionGovernor(database)
  const runtime = createProviderUrlResolutionRuntime({
    connectorRegistry: createStaticConnectorRegistry([connector]),
    connectorRepository,
    governor,
    now: () => new Date(now),
    workspaceId: 'provider-runtime-workspace',
  })
  const work = {
    acquisitionToken: 'runtime-token', attempt: 1, captureEvidenceVersionId: 'missing-revision',
    connectorInstanceId: instance.id, executionScopeId: instance.executionScopeId,
    inputHash: 'sha256:provider-runtime', horizonAt: '2026-07-17T12:00:00.000Z',
    intermediaryUrl: 'https://jobright.ai/jobs/info/provider-runtime', maxAttempts: 3,
    providerRecordId: 'jobright.public:provider-runtime', resolverId: 'jobright.provider-url',
    resolverVersion: 'jobright-provider-url@1', serverMinimumDelayMs: null, retryWorkId: 'runtime-work',
  }
  return { database, governor, now, resolve, runtime, scopeId: instance.executionScopeId, sqlite, work }
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url
}
