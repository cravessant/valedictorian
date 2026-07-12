import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'
import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import {
  normalizationAttempts,
  normalizationRuns,
  rawSourceOccurrences,
  rawSourceRevisions,
  retryWork,
} from '../db/schema'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createSqliteProfileRepository } from '../modules/profile/profile.repository'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-client-')), 'valedictorian.sqlite')
}

type JobrightFailureFixtureKind =
  | 'auth_failed'
  | 'discovery_failed'
  | 'parser_changed'
  | 'zero_useful_results'

async function runJobrightFailureFixture(kind: JobrightFailureFixtureKind) {
  const sqlitePath = createTempSqlitePath()
  const username = 'fixture.user@example.test'
  const password = 'fixture-password'
  const sessionCookie = 'fixture-session-cookie'
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
    const headers = new Headers(init?.headers)
    const cookie = headers.get('cookie') ?? ''

    if (url.includes('/swan/auth/login/pwd')) {
      if (kind === 'auth_failed') {
        throw new Error('Synthetic Jobright login transport failure')
      }

      return new Response(JSON.stringify({ success: true, result: {} }), {
        headers: {
          'content-type': 'application/json',
          'set-cookie': `SESSION_ID=${sessionCookie}; Path=/`,
        },
        status: 200,
      })
    }

    if (url.includes('/swan/auth/newinfo')) {
      expect(cookie).toContain(`SESSION_ID=${sessionCookie}`)
      return new Response(JSON.stringify({
        success: true,
        result: { logined: true },
      }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    }

    if (url.includes('/swan/recommend/visitor-list/jobs')) {
      expect(cookie).toContain(`SESSION_ID=${sessionCookie}`)

      if (kind === 'discovery_failed') {
        return new Response(JSON.stringify({ success: false }), {
          headers: { 'content-type': 'application/json' },
          status: 400,
        })
      }

      if (kind === 'parser_changed') {
        return new Response(JSON.stringify({
          success: true,
          result: { changedRecords: [] },
        }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }

      return new Response(JSON.stringify({
        success: true,
        result: {
          jobNum: 1,
          jobList: [
            {
              jobResult: {
                jobId: 'job-no-external-url',
                jobTitle: 'Software Engineering Intern',
                companyName: 'Fixture Robotics',
              },
              companyResult: {
                companyName: 'Fixture Robotics',
              },
            },
          ],
        },
      }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    }

    if (url.includes('/swan/share/job/job-no-external-url') && kind === 'zero_useful_results') {
      expect(cookie).toContain(`SESSION_ID=${sessionCookie}`)
      return new Response(JSON.stringify({
        success: true,
        result: {
          logined: true,
          jobDetail: {
            jobResult: {
              applyLink: 'https://jobright.ai/jobs/info/job-no-external-url',
              originalUrl: 'https://swan-api.jobright.ai/jobs/job-no-external-url',
            },
          },
        },
      }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    }

    throw new Error(`Unexpected fixture request: ${url}`)
  }) as typeof fetch
  const client = createRuntimeLocalValedictorianClient({
    connectorRegistry: createStaticConnectorRegistry([
      createJobrightConnector({
        fetch: fetchImpl,
        now: () => '2026-07-09T18:00:00.000Z',
      }),
    ]),
    connectorRuntime: {
      delay: {
        async wait() {
          return 0
        },
      },
    },
    now: () => new Date('2026-07-09T18:00:00.000Z'),
    secretCodec,
    seedDataMode: 'none',
    sqlitePath,
    workspaceId: `workspace-${kind}`,
  })
  const sqlite = createFileDatabase(sqlitePath)
  const database = createDrizzleDatabase(sqlite)
  const connectorRepository = createSqliteConnectorRepository(database)
  const profileRepository = createSqliteProfileRepository(database, secretCodec)
  const connectorInstanceId = `jobright-${kind}`
  const secretKey = `connector_jobright_credentials_${kind}`

  await profileRepository.upsertSecret({
    key: secretKey,
    kind: 'password',
    label: 'Jobright username and password',
    value: JSON.stringify({ username, password }),
  })
  await connectorRepository.upsertInstance({
    id: connectorInstanceId,
    connectorId: 'jobright.resolver',
    connectorVersion: '0.8.0',
    displayName: 'Jobright internslist',
    enabled: true,
    auth: [
      {
        id: 'jobright',
        label: 'Jobright username and password',
        mode: 'username_password',
        secretKey,
      },
    ],
    config: {
      discoveryCount: 1,
      maxRequestsPerRun: 3,
    },
    filters: {
      maxResolutionCount: 1,
      roleTerms: ['intern'],
    },
    createdAt: '2026-07-09T15:00:00.000Z',
  })

  const run = await client.connectors.runs.trigger({
    connectorInstanceId,
    mode: 'manual',
    coverageStartedAt: '2026-07-09T17:00:00.000Z',
    coverageEndedAt: '2026-07-09T18:00:00.000Z',
  })
  const runs = await client.connectors.runs.list({
    connectorInstanceId,
    limit: 10,
  })
  const status = await client.connectors.status.list()
  const findings = await client.sourcing.findings.list()
  const retryItems = database.select().from(retryWork).all()
  const serialized = JSON.stringify({ findings, run, runs, status })

  sqlite.close()

  return {
    fetchUrls: fetchImpl.mock.calls.map((call) => {
      const input = call[0]
      return typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    }),
    findings,
    run,
    runs,
    retryItems,
    serialized,
    status: status.items.find((item) => item.id === connectorInstanceId),
    sensitiveValues: [username, password, sessionCookie],
  }
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

  it('routes Jobright captures through raw intake and trusted normalization before detail work', async () => {
    const sqlitePath = createTempSqlitePath()
    const secretValue = JSON.stringify({
      username: 'demo@example.com',
      password: 'synthetic-password',
    })
    const secretCodec = {
      decrypt: (value: string) => value.replace(/^enc:/, ''),
      encrypt: (value: string) => `enc:${value}`,
    }
    const sessionCookie = 'synthetic-session-cookie'
    const officialApplyUrl = 'https://jobs.lever.co/example/software-engineering-intern'
    const rejectedJobrightUrl = 'https://jobright.ai/jobs/info/job-intermediary-only'
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      const headers = new Headers(init?.headers)
      const cookie = headers.get('cookie') ?? ''
      const body = typeof init?.body === 'string' ? init.body : ''

      if (url.includes('/swan/auth/login/pwd')) {
        expect(body).toContain('demo@example.com')
        expect(body).toContain('synthetic-password')
        return new Response(JSON.stringify({ success: true, result: {} }), {
          headers: {
            'content-type': 'application/json',
            'set-cookie': `SESSION_ID=${sessionCookie}; Path=/`,
          },
          status: 200,
        })
      }

      if (url.includes('/swan/auth/newinfo')) {
        expect(cookie).toContain(`SESSION_ID=${sessionCookie}`)
        return new Response(JSON.stringify({
          success: true,
          result: { logined: true },
        }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }

      if (url.includes('/swan/recommend/visitor-list/jobs')) {
        expect(cookie).toContain(`SESSION_ID=${sessionCookie}`)
        expect(init?.method).toBe('POST')
        expect(body).toContain('Internslist')
        return new Response(JSON.stringify({
          success: true,
          result: {
            jobNum: 20,
            jobList: [
              {
                jobResult: {
                  jobId: 'job-resolved-1',
                  jobTitle: 'Software Engineering Intern',
                  companyName: 'Example Robotics',
                },
                companyResult: {
                  companyName: 'Example Robotics',
                },
              },
              {
                jobResult: {
                  jobId: 'job-intermediary-only',
                  jobTitle: 'Platform Intern',
                  companyName: 'Intermediary Co',
                },
                companyResult: {
                  companyName: 'Intermediary Co',
                },
              },
              ...Array.from({ length: 18 }, (_, index) => ({
                jobResult: {
                  jobId: `job-pending-${index + 1}`,
                  jobTitle: `Pending Provider Role ${index + 1}`,
                  companyName: `Pending Company ${index + 1}`,
                },
                companyResult: {
                  companyName: `Pending Company ${index + 1}`,
                },
              })),
            ],
          },
        }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }

      if (url.includes('/swan/share/job/job-resolved-1')) {
        expect(database.select().from(rawSourceOccurrences).all()).toHaveLength(20)
        expect(cookie).toContain(`SESSION_ID=${sessionCookie}`)
        return new Response(JSON.stringify({
          success: true,
          result: {
            logined: true,
            jobDetail: {
              jobResult: {
                applyLink: officialApplyUrl,
                originalUrl: rejectedJobrightUrl,
                jobTitle: 'Software Engineering Intern',
                companyName: 'Example Robotics',
              },
            },
          },
        }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }

      if (url.includes('/swan/share/job/job-intermediary-only')) {
        expect(database.select().from(rawSourceOccurrences).all()).toHaveLength(20)
        expect(cookie).toContain(`SESSION_ID=${sessionCookie}`)
        return new Response(JSON.stringify({
          success: true,
          result: {
            logined: true,
            jobDetail: {
              jobResult: {
                applyLink: rejectedJobrightUrl,
                originalUrl: 'https://jobright.ai/jobs/info/job-intermediary-only',
                jobTitle: 'Platform Intern',
                companyName: 'Intermediary Co',
              },
            },
          },
        }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }

      if (url.includes('/swan/share/job/job-pending-')) {
        expect(database.select().from(rawSourceOccurrences).all().length).toBeGreaterThanOrEqual(20)
        const jobId = url.split('/').at(-1)
        return new Response(JSON.stringify({
          success: true,
          result: {
            logined: true,
            jobDetail: {
              jobResult: {
                applyLink: `https://jobs.example.test/${jobId}`,
                companyName: 'Pending Company',
              },
            },
          },
        }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch
    const publishedConnector = createJobrightConnector({
      fetch: fetchImpl,
      now: () => '2026-07-09T18:00:00.000Z',
    })
    let firstProviderNormalization = true
    let database: ReturnType<typeof createDrizzleDatabase>
    const tracedConnector: AppJobConnector = {
      ...publishedConnector,
      async refresh(input, runtime) {
        const normalization = runtime.normalization
        return publishedConnector.refresh(input, {
          ...runtime,
          ...(normalization
            ? {
                normalization: {
                  async run(normalizationInput) {
                    if (
                      firstProviderNormalization
                      && normalizationInput.resolver.id === 'jobright.provider-fields'
                    ) {
                      firstProviderNormalization = false
                      expect(database.select().from(rawSourceOccurrences).all()).toHaveLength(20)
                    }
                    return normalization.run(normalizationInput)
                  },
                },
              }
            : {}),
        })
      },
    }
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        tracedConnector,
      ]),
      connectorRuntime: {
        delay: {
          async wait() {
            return 0
          },
        },
      },
      now: () => new Date('2026-07-09T18:00:00.000Z'),
      secretCodec,
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-jobright-api',
    })
    const sqlite = createFileDatabase(sqlitePath)
    database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)
    const profileRepository = createSqliteProfileRepository(database, secretCodec)

    await profileRepository.upsertSecret({
      key: 'connector_jobright_credentials_jobright_api',
      kind: 'password',
      label: 'Jobright username and password',
      value: secretValue,
    })
    await connectorRepository.upsertInstance({
      id: 'jobright-api',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.8.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [
        {
          id: 'jobright',
          label: 'Jobright username and password',
          mode: 'username_password',
          secretKey: 'connector_jobright_credentials_jobright_api',
        },
      ],
      config: {
        discoveryCount: 20,
        maxRequestsPerRun: 5,
      },
      filters: {
        maxResolutionCount: 2,
        roleTerms: ['intern'],
      },
      createdAt: '2026-07-09T15:00:00.000Z',
    })

    const run = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-api',
      mode: 'manual',
      coverageStartedAt: '2026-07-09T17:00:00.000Z',
      coverageEndedAt: '2026-07-09T18:00:00.000Z',
    })
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'jobright-api',
      limit: 10,
    })
    const observations = await client.connectors.observations.list({
      connectorInstanceId: 'jobright-api',
      limit: 10,
    })
    const checkpoints = await client.connectors.checkpoints.list({
      connectorInstanceId: 'jobright-api',
    })
    const findings = await client.sourcing.findings.list()
    const occurrences = database.select().from(rawSourceOccurrences).all()
    const revisions = database.select().from(rawSourceRevisions).all()
    const attempts = database.select().from(normalizationAttempts).all()
    const resolvedRevision = revisions.find(({ providerRecordId }) => providerRecordId === 'job-resolved-1')!
    const resolvedNormalization = await client.sourcing.rawRecords.normalization.get(
      resolvedRevision.rawRecordId,
    )

    expect(run).toMatchObject({
      connectorInstanceId: 'jobright-api',
      stats: {
        lifecycleCounts: {
          source: 'frozen_terminal',
          scope: { kind: 'connector_run', connectorRunId: run.id },
          provider: { returnedRows: 20, capturedRecords: 20 },
          destination: {
            normalized: 1,
            resolvedEmployerOrAts: 1,
            pending: 18,
            unresolved: 1,
            gateRejected: 0,
          },
          sourcing: { actionableReview: 1 },
        },
      },
    })
    expect(run.warnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'jobright_raw_intake_unavailable' }),
      expect.objectContaining({ code: 'jobright_normalization_unavailable' }),
    ]))
    expect(runs.total).toBe(1)
    expect(occurrences).toHaveLength(20)
    expect(revisions).toHaveLength(20)
    expect(occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ connectorInstanceId: 'jobright-api', connectorRunId: run.id }),
    ]))
    expect(attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolverId: 'jobright.provider-fields', resolverVersion: 'jobright-provider-fields@1' }),
      expect.objectContaining({ resolverId: 'jobright.authenticated-destination', resolverVersion: 'jobright-authenticated-destination@1' }),
    ]))
    expect(attempts.filter(({ rawRevisionId, resolverId }) =>
      rawRevisionId === resolvedRevision.id && resolverId === 'jobright.provider-fields')).toHaveLength(1)
    expect(attempts.filter(({ rawRevisionId, resolverId }) =>
      rawRevisionId === resolvedRevision.id && resolverId === 'deterministic.provider-identity')).toHaveLength(1)
    expect(attempts.filter(({ rawRevisionId, resolverId }) =>
      rawRevisionId === resolvedRevision.id && resolverId === 'jobright.authenticated-destination')).toHaveLength(1)
    const resolvedRuns = database.select().from(normalizationRuns).all()
      .filter(({ rawRevisionId }) => rawRevisionId === resolvedRevision.id)
    expect(resolvedRuns).toHaveLength(2)
    expect(resolvedRuns.every(({ triggerOccurrenceId }) =>
      triggerOccurrenceId === occurrences.find(({ rawRevisionId }) =>
        rawRevisionId === resolvedRevision.id)?.id)).toBe(true)
    expect(resolvedNormalization).toMatchObject({
      gate: { status: 'passed' },
      canonicalCandidate: {
        rawRecordId: resolvedRevision.rawRecordId,
        rawRevisionId: resolvedRevision.id,
        destination: {
          class: 'employer_or_ats',
          url: officialApplyUrl,
          intermediaryUrl: 'https://jobright.ai/jobs/info/job-resolved-1',
        },
      },
      fieldOutcomes: expect.arrayContaining([
        expect.objectContaining({
          field: 'destinationUrl',
          resolverId: 'jobright.authenticated-destination',
          resolverVersion: 'jobright-authenticated-destination@1',
        }),
      ]),
      triggerOccurrence: {
        rawRevisionId: resolvedRevision.id,
        capture: { connectorInstanceId: 'jobright-api', connectorRunId: run.id },
      },
    })
    expect(checkpoints.items).toHaveLength(1)
    expect(findings.items).toEqual([
      expect.objectContaining({
        rawRevisionId: resolvedRevision.id,
        canonicalCandidateId: resolvedNormalization.canonicalCandidate?.id,
        destination: {
          class: 'employer_or_ats',
          url: officialApplyUrl,
          intermediaryUrl: 'https://jobright.ai/jobs/info/job-resolved-1',
        },
        sourceName: 'Jobright',
        mergeStatus: 'blocked',
        policyBlocker: 'missing_country',
      }),
    ])
    expect(firstProviderNormalization).toBe(false)

    const fetchUrls = fetchImpl.mock.calls.map((call) => {
      const input = call[0]
      return typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    })
    expect(fetchUrls.filter((url) => url.includes('/swan/auth/login/pwd'))).toHaveLength(1)
    expect(fetchUrls.filter((url) => url.includes('/swan/auth/newinfo'))).toHaveLength(1)
    expect(fetchUrls.filter((url) => url.includes('/swan/recommend/visitor-list/jobs'))).toHaveLength(1)
    expect(fetchUrls.filter((url) => url.includes('/swan/share/job/'))).toHaveLength(2)

    const restartConnector = createJobrightConnector({
      fetch: fetchImpl,
      now: () => '2026-07-09T18:01:00.000Z',
    })
    let injectedNormalizationFailure = false
    const failingRestartConnector: AppJobConnector = {
      ...restartConnector,
      async refresh(input, runtime) {
        const normalization = runtime.normalization
        return restartConnector.refresh(input, {
          ...runtime,
          ...(normalization
            ? {
                normalization: {
                  async run(normalizationInput) {
                    if (
                      !injectedNormalizationFailure
                      && normalizationInput.resolver.id === 'jobright.provider-fields'
                    ) {
                      injectedNormalizationFailure = true
                      expect(database.select().from(rawSourceOccurrences).all()).toHaveLength(40)
                      throw new Error('Injected provider normalization persistence failure')
                    }
                    return normalization.run(normalizationInput)
                  },
                },
              }
            : {}),
        })
      },
    }
    const restartedClient = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        failingRestartConnector,
      ]),
      connectorRuntime: {
        delay: { async wait() { return 0 } },
      },
      now: () => new Date('2026-07-09T18:01:00.000Z'),
      secretCodec,
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-jobright-api',
    })
    const resumedRun = await restartedClient.connectors.runs.trigger({
      connectorInstanceId: 'jobright-api',
      mode: 'manual',
      coverageStartedAt: '2026-07-09T17:00:00.000Z',
      coverageEndedAt: '2026-07-09T18:01:00.000Z',
    })
    const afterRestartOccurrences = database.select().from(rawSourceOccurrences).all()
    const afterRestartRevisions = database.select().from(rawSourceRevisions).all()
    const detailUrlsAfterFailure = fetchImpl.mock.calls.map(([request]) =>
      typeof request === 'string'
        ? request
        : request instanceof URL
          ? request.href
          : request.url).filter((url) => url.includes('/swan/share/job/'))

    expect(afterRestartRevisions).toHaveLength(20)
    expect(afterRestartOccurrences).toHaveLength(40)
    expect(afterRestartOccurrences.filter(({ connectorRunId }) =>
      connectorRunId === resumedRun.id)).toHaveLength(20)
    expect(resumedRun.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'connector.warning' }),
    ]))
    expect(injectedNormalizationFailure).toBe(true)
    expect(detailUrlsAfterFailure.filter((url) => url.endsWith('/job-resolved-1'))).toHaveLength(1)
    expect(detailUrlsAfterFailure.filter((url) => url.endsWith('/job-intermediary-only'))).toHaveLength(1)
    expect(detailUrlsAfterFailure.filter((url) => url.includes('/job-pending-'))).toHaveLength(0)

    const recoveredClient = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        createJobrightConnector({
          fetch: fetchImpl,
          now: () => '2026-07-09T18:02:00.000Z',
        }),
      ]),
      connectorRuntime: { delay: { async wait() { return 0 } } },
      now: () => new Date('2026-07-09T18:02:00.000Z'),
      secretCodec,
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-jobright-api',
    })
    const recoveredRun = await recoveredClient.connectors.runs.trigger({
      connectorInstanceId: 'jobright-api',
      mode: 'manual',
      coverageStartedAt: '2026-07-09T17:00:00.000Z',
      coverageEndedAt: '2026-07-09T18:02:00.000Z',
    })
    const recoveredOccurrences = database.select().from(rawSourceOccurrences).all()
    const detailUrls = fetchImpl.mock.calls.map(([request]) =>
      typeof request === 'string'
        ? request
        : request instanceof URL
          ? request.href
          : request.url).filter((url) => url.includes('/swan/share/job/'))
    expect(recoveredOccurrences).toHaveLength(60)
    expect(recoveredOccurrences.filter(({ connectorRunId }) =>
      connectorRunId === recoveredRun.id)).toHaveLength(20)
    expect(detailUrls.filter((url) => url.endsWith('/job-resolved-1'))).toHaveLength(1)
    expect(detailUrls.filter((url) => url.endsWith('/job-intermediary-only'))).toHaveLength(1)
    expect(detailUrls.filter((url) => url.includes('/job-pending-'))).toHaveLength(2)
    await expect(restartedClient.sourcing.rawRecords.normalization.get(
      resolvedRevision.rawRecordId,
    )).resolves.toMatchObject({
      gate: { status: 'passed' },
      canonicalCandidate: { destination: { url: officialApplyUrl } },
    })
    await expect(restartedClient.sourcing.findings.list()).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({
        rawRevisionId: resolvedRevision.id,
        destinationUrl: officialApplyUrl,
        sourceName: 'Jobright',
      })],
    })

    const serialized = JSON.stringify({ run, runs, observations, checkpoints, findings, occurrences, revisions, attempts })
    expect(serialized).not.toContain(sessionCookie)
    expect(serialized).not.toContain('demo@example.com')
    expect(serialized).not.toContain('synthetic-password')
    sqlite.close()
  })

  it('preserves sanitized Jobright failure and retry guidance through public APIs', async () => {
    const authFailed = await runJobrightFailureFixture('auth_failed')

    expect(authFailed.run).toMatchObject({
      status: 'partial_success',
      observationCount: 0,
      warnings: [
        {
          code: 'jobright_auth_retryable',
          label: 'Jobright auth unavailable',
          message: 'Jobright authentication is temporarily unavailable. Retry later.',
          severity: 'warning',
        },
      ],
      retryHints: {
        state: 'scheduled', reason: 'network_interruption', attempt: 1, maxAttempts: 3,
        lastAttemptAt: '2026-07-09T18:00:00.000Z',
      },
    })
    expect(authFailed.runs.items).toHaveLength(1)
    expect(authFailed.runs.items[0]).toMatchObject({
      warnings: authFailed.run.warnings,
      retryHints: authFailed.run.retryHints,
    })
    expect(authFailed.status).toMatchObject({
      status: 'partial_success',
      warnings: authFailed.run.warnings,
    })
    expect(authFailed.fetchUrls).toHaveLength(1)
    expect(authFailed.retryItems).toEqual([
      expect.objectContaining({ kind: 'connector_capture', reason: 'network_interruption', state: 'scheduled' }),
    ])

    const discoveryFailed = await runJobrightFailureFixture('discovery_failed')

    expect(discoveryFailed.run).toMatchObject({
      status: 'partial_success',
      observationCount: 0,
      warnings: [
        {
          code: 'jobright_discovery_failed',
          label: 'Jobright discovery failed',
          message: 'Jobright discovery failed. Review API availability and retry this run.',
          severity: 'warning',
        },
      ],
      retryHints: null,
    })
    expect(discoveryFailed.runs.items).toHaveLength(1)
    expect(discoveryFailed.runs.items[0]).toMatchObject({
      warnings: discoveryFailed.run.warnings,
      retryHints: discoveryFailed.run.retryHints,
    })
    expect(discoveryFailed.status).toMatchObject({
      status: 'partial_success',
      warnings: discoveryFailed.run.warnings,
    })
    expect(discoveryFailed.fetchUrls).toHaveLength(3)

    const parserChanged = await runJobrightFailureFixture('parser_changed')

    expect(parserChanged.run).toMatchObject({
      status: 'partial_success',
      observationCount: 0,
      warnings: [
        {
          code: 'jobright_parser_changed',
          label: 'Jobright API changed',
          message: 'Update the Jobright API parser before retrying this run.',
          severity: 'warning',
        },
      ],
      retryHints: null,
    })
    expect(parserChanged.runs.items).toHaveLength(1)
    expect(parserChanged.runs.items[0]).toMatchObject({
      warnings: parserChanged.run.warnings,
      retryHints: parserChanged.run.retryHints,
    })
    expect(parserChanged.status).toMatchObject({
      status: 'partial_success',
      warnings: parserChanged.run.warnings,
    })
    expect(parserChanged.fetchUrls).toHaveLength(3)

    const zeroUsefulResults = await runJobrightFailureFixture('zero_useful_results')

    expect(zeroUsefulResults.run).toMatchObject({
      status: 'partial_success',
      observationCount: 1,
      stats: {
        attempted: 1,
        discovered: 1,
        observations: 1,
        resolved: 0,
      },
      warnings: [
        {
          code: 'jobright_zero_useful_results',
          label: 'No usable Jobright URLs',
          message: 'Review unresolved Jobright results before retrying this run.',
          severity: 'warning',
        },
      ],
      retryHints: null,
    })
    expect(zeroUsefulResults.runs.items).toHaveLength(1)
    expect(zeroUsefulResults.runs.items[0]).toMatchObject({
      warnings: zeroUsefulResults.run.warnings,
      retryHints: zeroUsefulResults.run.retryHints,
    })
    expect(zeroUsefulResults.status).toMatchObject({
      status: 'partial_success',
      warnings: zeroUsefulResults.run.warnings,
    })
    expect(zeroUsefulResults.fetchUrls).toHaveLength(4)

    for (const fixture of [authFailed, discoveryFailed, parserChanged, zeroUsefulResults]) {
      expect(fixture.findings.items).toEqual([])
      for (const sensitiveValue of fixture.sensitiveValues) {
        expect(fixture.serialized).not.toContain(sensitiveValue)
      }
    }
  })
})
