import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import {
  applicationScores,
  applications,
  companies,
  sources,
  workflowRuns,
  workflowRunSteps,
} from '../db/schema'
import { createDrizzleDatabase, createFileDatabase, migrateDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import { createSqliteProfileRepository } from '../modules/profile/profile.repository'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'

function createLocalValedictorianClient(options: Parameters<typeof createRuntimeLocalValedictorianClient>[0]) {
  return createRuntimeLocalValedictorianClient({
    seedDataMode: 'sample',
    ...options,
  })
}

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
    connectorVersion: '0.4.1',
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
  const serialized = JSON.stringify({ run, runs, status })

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
    run,
    runs,
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

  it('starts with an empty application list by default', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({ sqlitePath })

    await expect(client.applications.list()).resolves.toMatchObject({
      items: [],
      total: 0,
    })

    const sqlite = createFileDatabase(sqlitePath)
    const migrationRows = sqlite
      .prepare('select created_at from __drizzle_migrations order by created_at')
      .all()
    sqlite.close()

    expect(migrationRows.length).toBeGreaterThan(0)
  })

  it('requires an explicit path for reference tracker seeding', () => {
    expect(() =>
      createRuntimeLocalValedictorianClient({
        seedDataMode: 'reference-tracker',
        sqlitePath: createTempSqlitePath(),
      }),
    ).toThrow('VALEDICTORIAN_REFERENCE_TRACKER_PATH')
  })

  it('lists seeded applications with query filters and pagination', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() })

    await expect(
      client.applications.list({
        limit: 1,
        minScore: 6,
        status: 'needs_user_info',
      }),
    ).resolves.toMatchObject({
      hasMore: false,
      items: [
        {
          companyName: 'Astranis Space Technologies',
          currentPriorityScore: 8,
          status: 'needs_user_info',
        },
      ],
      limit: 1,
      offset: 0,
      total: 1,
    })
  })

  it('gets and updates application status through the local client', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() })

    await expect(client.applications.get('application-astranis-backend')).resolves.toMatchObject({
      companyName: 'Astranis Space Technologies',
      primaryLink: {
        label: 'official',
      },
    })

    await expect(
      client.applications.updateStatus({
        applicationId: 'application-versant-platform',
        notes: 'Submitted from the local runtime client.',
        status: 'submitted',
      }),
    ).resolves.toMatchObject({
      id: 'application-versant-platform',
      notes: 'Submitted from the local runtime client.',
      status: 'submitted',
    })
  })

  it('starts and lists application attempts through the local client', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() })

    const attempt = await (client.applications as typeof client.applications & {
      attempts: {
        start(input: {
          applicationId: string
          actorType: string
          actorName?: string
          summary?: string
        }): Promise<{ id: string; status: string; steps: Array<{ type: string }> }>
        list(input: {
          applicationId: string
        }): Promise<{ total: number; items: Array<{ id: string; steps: Array<{ type: string }> }> }>
      }
    }).attempts.start({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      summary: 'Started from local client.',
    })

    expect(attempt).toMatchObject({
      status: 'in_progress',
      steps: [{ type: 'attempt_started' }],
    })
    await expect(
      (client.applications as typeof client.applications & {
        attempts: {
          list(input: {
            applicationId: string
          }): Promise<{ total: number; items: Array<{ id: string }> }>
        }
      }).attempts.list({ applicationId: 'application-versant-platform' }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ id: attempt.id }],
    })
  })

  it('records scores and updates the current application score', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createLocalValedictorianClient({ sqlitePath })

    await expect(client.scores.record({
      applicationId: 'application-jobster-analytics',
      band: 'high',
      careerSignal: 2,
      cityWorkMode: 1,
      compensationLogistics: 1,
      penalties: [],
      rationale: 'Now looks relevant after a closer review.',
      roleRelevance: 3,
      rubricVersion: 'test-rubric',
      score: 7,
    })).resolves.toMatchObject({
      applicationId: 'application-jobster-analytics',
      band: 'high',
      careerSignal: 2,
      cityWorkMode: 1,
      compensationLogistics: 1,
      penalties: [],
      rationale: 'Now looks relevant after a closer review.',
      roleRelevance: 3,
      rubricVersion: 'test-rubric',
      score: 7,
      id: expect.any(String) as string,
      createdAt: expect.any(String) as string,
    })

    await expect(client.applications.get('application-jobster-analytics')).resolves.toMatchObject({
      currentPriorityBand: 'high',
      currentPriorityScore: 7,
    })

    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)

    expect(database.select().from(applicationScores).all()).toHaveLength(4)
    sqlite.close()
  })

  it('persists profile data and returns non-secret agent context', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() })

    await client.profile.update({
      answers: [
        {
          answer: 'LinkedIn',
          includeInAgentContext: true,
          key: 'how_heard',
          label: 'How I heard about the role',
          questionPattern: 'How did you hear about us?',
        },
        {
          answer: 'Private value.',
          includeInAgentContext: false,
          key: 'private',
          label: 'Private',
          questionPattern: 'Sensitive question',
        },
      ],
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
    })

    await expect(client.profile.get()).resolves.toMatchObject({
      answers: [
        expect.objectContaining({ key: 'how_heard' }),
        expect.objectContaining({ key: 'private' }),
      ],
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
    })
    await expect(client.profile.agentContext.get()).resolves.toEqual({
      answers: [
        {
          answer: 'LinkedIn',
          category: null,
          includeInAgentContext: true,
          key: 'how_heard',
          label: 'How I heard about the role',
          questionPattern: 'How did you hear about us?',
        },
      ],
      basics: {
        email: 'kenny@example.com',
        fullName: 'Kenny Lin',
      },
      education: [],
    })
  })

  it('starts workflow runs and promotes sourcing findings through the local client', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() })

    const run = await client.runs.start({
      runType: 'sourcing',
      actorType: 'agent',
      actorName: 'codex',
      sourceName: 'LinkedIn',
      summary: 'Started sourcing.',
    })
    const finding = await client.sourcing.findings.create({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      officialUrl: 'https://jobs.example.com/delta',
      priorityScore: 7,
      priorityBand: 'high',
    })

    await expect(client.runs.list({ runType: 'sourcing', status: 'in_progress' })).resolves.toMatchObject({
      total: 1,
      items: [{ id: run.id }],
    })
    await expect(client.sourcing.findings.promote({ findingId: finding.id })).resolves.toMatchObject({
      mergeStatus: 'merged',
      mergedApplicationId: expect.any(String),
    })
  })

  it('processes sourcing candidates through the local client', async () => {
    const client = createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() })
    const run = await client.runs.start({
      runType: 'sourcing',
      actorType: 'agent',
      actorName: 'codex',
      sourceId: 'source-linkedin',
      summary: 'Started sourcing.',
    })

    await expect(
      client.sourcing.candidates.process({
        workflowRunId: run.id,
        sourceId: 'source-linkedin',
        companyName: 'Echo Health',
        roleTitle: 'Data Engineering Intern',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        officialUrl: 'https://jobs.example.com/echo',
        score: {
          score: 8,
          band: 'high',
          roleRelevance: 3,
          careerSignal: 2,
          cityWorkMode: 2,
          compensationLogistics: 1,
          penalties: [],
          rationale: 'Strong fit.',
          rubricVersion: 'local-client-test',
        },
        cutoffScore: 7,
      }),
    ).resolves.toMatchObject({
      mergeStatus: 'merged',
      mergedApplicationId: expect.any(String),
    })
  })

  it('does not seed sourcing findings when an existing local database already has applications', async () => {
    const sqlitePath = createTempSqlitePath()
    const sqlite = createFileDatabase(sqlitePath)
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const now = '2026-06-04T16:00:00.000Z'

    database
      .insert(companies)
      .values({
        id: 'company-existing',
        name: 'Existing Co',
        normalizedName: 'existing co',
        websiteUrl: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .run()
    database
      .insert(sources)
      .values({
        id: 'source-existing',
        name: 'Existing Source',
        accountHint: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .run()
    database
      .insert(applications)
      .values({
        id: 'application-existing',
        companyId: 'company-existing',
        sourceId: 'source-existing',
        roleTitle: 'Existing Role',
        roleKind: 'internship',
        term: null,
        city: null,
        region: null,
        country: 'US',
        workMode: 'remote',
        locationRaw: 'Remote',
        status: 'queued',
        hasApplied: false,
        currentPriorityScore: null,
        currentPriorityBand: null,
        currentResumeVariant: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .run()
    sqlite.close()

    const client = createLocalValedictorianClient({ sqlitePath })

    const findings = await client.sourcing.findings.list()

    expect(findings.total).toBe(0)
    expect(findings.items).toEqual([])
  })

  it('does not backfill sample attempts into an existing local database', async () => {
    const sqlitePath = createTempSqlitePath()
    const sqlite = createFileDatabase(sqlitePath)
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const now = '2026-06-04T16:00:00.000Z'

    database
      .insert(companies)
      .values({
        id: 'company-astranis',
        name: 'Astranis Space Technologies',
        normalizedName: 'astranis space technologies',
        websiteUrl: 'https://jobs.example.test/remediated/3b584e866326a6d1',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .run()
    database
      .insert(sources)
      .values({
        id: 'source-linkedin',
        name: 'LinkedIn',
        accountHint: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .run()
    database
      .insert(applications)
      .values({
        id: 'application-astranis-backend',
        companyId: 'company-astranis',
        sourceId: 'source-linkedin',
        roleTitle: 'Software Engineer- Backend Intern (Fall 2026)',
        roleKind: 'internship',
        term: 'Fall 2026 internship',
        city: 'San Francisco',
        region: 'CA',
        country: 'US',
        workMode: 'onsite',
        locationRaw: 'San Francisco, CA / Onsite',
        status: 'needs_user_info',
        hasApplied: false,
        currentPriorityScore: 8,
        currentPriorityBand: 'high',
        currentResumeVariant: 'bachelor_dec_2027',
        notes: 'Existing DB seeded before receipts were added.',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .run()
    sqlite.close()

    const client = createLocalValedictorianClient({ sqlitePath })

    const attempts = await client.applications.attempts.list({
      applicationId: 'application-astranis-backend',
    })
    const seededSqlite = createFileDatabase(sqlitePath)
    const seededDatabase = createDrizzleDatabase(seededSqlite)

    expect(attempts).toMatchObject({
      items: [],
      total: 0,
    })
    expect(
      seededDatabase
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, 'workflow-run-application-attempt-astranis-verification'))
        .all(),
    ).toHaveLength(0)
    expect(
      seededDatabase
        .select()
        .from(workflowRunSteps)
        .where(
          eq(
            workflowRunSteps.workflowRunId,
            'workflow-run-application-attempt-astranis-verification',
          ),
        )
        .all(),
    ).toHaveLength(0)
    seededSqlite.close()
  })

  it('lists connector status summaries through the local client', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({ sqlitePath }) as ReturnType<
      typeof createRuntimeLocalValedictorianClient
    > & {
      connectors: {
        list(): Promise<{
          items: Array<{ auth: Array<{ configured: boolean; id: string; mode: string }>; id: string }>
        }>
        inspect(connectorInstanceId: string): Promise<{
          actionRequired: Array<{ kind: string }>
          auth: Array<{ configured: boolean; id: string; mode: string }>
          status: string
        }>
        runs: {
          list(input: { connectorInstanceId: string; limit?: number }): Promise<{
            items: Array<{ id: string; status: string }>
            total: number
          }>
          trigger(input: {
            connectorInstanceId: string
            coverageStartedAt?: string | null
            coverageEndedAt?: string | null
            filterSignature?: string | null
            mode?: 'manual'
          }): Promise<{ connectorInstanceId: string; status: string }>
        }
        checkpoints: {
          list(input: { connectorInstanceId: string; filterSignature?: string }): Promise<{
            items: Array<{ checkpoint: unknown; filterSignature: string }>
          }>
        }
        observations: {
          list(input: { connectorInstanceId: string; limit?: number }): Promise<{
            items: Array<{ companyName: string; roleTitle: string }>
            total: number
          }>
        }
        status: {
          list(): Promise<{
            available: boolean
            items: Array<{ displayName: string; status: string; summary: string }>
          }>
        }
      }
    }
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
          mode: 'browser_session',
          sessionKey: 'fixture-session-123',
        },
      ],
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    await connectorRepository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'catch_up',
      startedAt: '2026-07-08T17:00:00.000Z',
      completedAt: '2026-07-08T17:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        coverage: {
          start: '2026-07-08T16:00:00.000Z',
          end: '2026-07-08T17:00:00.000Z',
        },
        nextCheckpoint: {
          checkpoint: { cursor: 'latest-cursor' },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [
          {
            connectorId: 'fixture.jobs',
            connectorVersion: '0.1.0',
            sourceRecordKey: 'fixture.jobs:delta-labs',
            observedAt: '2026-07-08T16:30:00.000Z',
            companyName: 'Delta Labs',
            roleTitle: 'Software Engineering Intern',
            links: {
              source: 'https://fixture.example/jobs/delta',
              intermediary: 'https://fixture.example/redirect/delta',
              official: 'https://jobs.example.com/delta',
            },
            resolution: {
              status: 'resolved',
              method: 'browser_session',
              reason: null,
            },
            dedupeKeys: ['official:https://jobs.example.com/delta'],
            evidence: [
              {
                type: 'source_api',
                capturedAt: '2026-07-08T16:30:00.000Z',
                sourceUrl: 'https://fixture.example/jobs/delta',
              },
            ],
          },
        ],
        retryHints: {
          reason: 'auth_required',
          sessionKey: 'fixture-session-123',
        },
        stats: {
          observations: 0,
        },
        status: 'partial_success',
        warnings: [
          {
            code: 'auth.expired_session',
            message: 'Expired browser session fixture-session-123.',
          },
        ],
      },
    })

    const status = await client.connectors.status.list()
    const instances = await client.connectors.list()
    const inspected = await client.connectors.inspect('connector-instance-fixture')
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
      limit: 10,
    })
    const checkpoints = await client.connectors.checkpoints.list({
      connectorInstanceId: 'connector-instance-fixture',
      filterSignature: 'filters:{}',
    })
    const observations = await client.connectors.observations.list({
      connectorInstanceId: 'connector-instance-fixture',
      limit: 10,
    })
    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        filterSignature: 'filters:{}',
        mode: 'manual',
      }),
    ).rejects.toThrow('Unsupported connector id: fixture.jobs')

    expect(status).toMatchObject({
      items: [
        {
          displayName: 'Fixture Jobs',
          status: 'auth_required',
          summary: 'Reconnect the connector session to continue refreshes.',
        },
      ],
    })
    expect(instances.items).toMatchObject([
      {
        auth: [{ configured: true, id: 'fixture-session', mode: 'browser_session' }],
        id: 'connector-instance-fixture',
      },
    ])
    expect(inspected).toMatchObject({
      actionRequired: [{ kind: 'auth' }],
      auth: [{ configured: true, id: 'fixture-session', mode: 'browser_session' }],
      status: 'auth_required',
    })
    expect(runs).toMatchObject({
      items: [
        {
          status: 'partial_success',
          warnings: [
            {
              code: 'auth.expired_session',
              label: 'Expired session',
              message: 'Connector auth expired.',
              severity: 'blocked',
            },
          ],
        },
      ],
      total: 1,
    })
    expect(checkpoints.items).toMatchObject([
      {
        checkpoint: { cursor: 'latest-cursor' },
        filterSignature: 'filters:{}',
      },
    ])
    expect(observations).toMatchObject({
      items: [{ companyName: 'Delta Labs', roleTitle: 'Software Engineering Intern' }],
      total: 1,
    })
    expect(JSON.stringify(status)).not.toContain('fixture-session-123')
    expect(JSON.stringify(instances)).not.toContain('fixture-session-123')
    expect(JSON.stringify(inspected)).not.toContain('fixture-session-123')
    expect(JSON.stringify(runs)).not.toContain('fixture-session-123')
    sqlite.close()
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
          mode: 'browser_session',
          sessionKey: 'fixture-session-123',
        },
      ],
      filters: { roleKeywords: ['intern'] },
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    await connectorRepository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'catch_up',
      startedAt: '2026-07-08T17:00:00.000Z',
      completedAt: '2026-07-08T17:00:01.000Z',
      config: {},
      filters: { roleKeywords: ['intern'] },
      filterSignature: 'filters:{"roleKeywords":["intern"]}',
      result: {
        coverage: {
          start: '2026-07-08T16:00:00.000Z',
          end: '2026-07-08T17:00:00.000Z',
        },
        nextCheckpoint: {
          checkpoint: { cursor: 'latest-cursor' },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        retryHints: {
          reason: 'auth_required',
        },
        stats: {
          observations: 0,
        },
        status: 'partial_success',
        warnings: [
          {
            code: 'auth.expired_session',
            message: 'Expired browser session fixture-session-123.',
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
        status: 'skipped',
      },
      status: 'skipped',
    })
    expect(runs.items).toEqual([
      expect.objectContaining({
        retryHints: {
          reason: 'user_skipped_auth_required_run',
          skippedBy: 'user',
        },
        status: 'skipped',
      }),
      expect.objectContaining({
        status: 'partial_success',
      }),
    ])
    expect(status.items).toMatchObject([
      {
        actions: [],
        status: 'skipped',
        summary: 'Latest run was skipped.',
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
          mode: 'browser_session',
          sessionKey: 'fixture-session-123',
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

  it('migrates a legacy Jobright 0.3.x browser_session instance to 0.4.1 username_password', async () => {
    const sqlitePath = createTempSqlitePath()
    const secretCodec = {
      decrypt: (value: string) => value.replace(/^enc:/, ''),
      encrypt: (value: string) => `enc:${value}`,
    }
    const client = createRuntimeLocalValedictorianClient({
      secretCodec,
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'jobright-legacy',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.3.0',
      displayName: 'Jobright public jobs',
      enabled: true,
      auth: [
        {
          id: 'jobright',
          label: 'Jobright browser session',
          mode: 'browser_session',
          sessionKey: 'legacy-jobright-session',
        },
      ],
      config: {},
      filters: {
        maxResolutionCount: 10,
        roleTerms: ['intern'],
      },
      createdAt: '2026-07-09T15:00:00.000Z',
    })

    await expect(client.connectors.update({
      connectorInstanceId: 'jobright-legacy',
      auth: [
        {
          id: 'jobright',
          label: 'Jobright username and password',
          mode: 'username_password',
          secretKey: 'connector_jobright_credentials_jobright_legacy',
        },
      ],
    })).rejects.toThrow(/Connector version mismatch/)

    const migrated = await client.connectors.update({
      connectorInstanceId: 'jobright-legacy',
      connectorVersion: '0.4.1',
      auth: [
        {
          id: 'jobright',
          label: 'Jobright username and password',
          mode: 'username_password',
          secretKey: 'connector_jobright_credentials_jobright_legacy',
        },
      ],
    })

    expect(migrated).toMatchObject({
      id: 'jobright-legacy',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.1',
      auth: [
        {
          configured: true,
          id: 'jobright',
          label: 'Jobright username and password',
          mode: 'username_password',
        },
      ],
    })
    expect(JSON.stringify(migrated)).not.toContain('legacy-jobright-session')
    expect(JSON.stringify(migrated)).not.toContain('connector_jobright_credentials_jobright_legacy')
    expect(JSON.stringify(migrated)).not.toContain('sessionKey')
    expect(JSON.stringify(migrated)).not.toContain('secretKey')

    const persisted = await connectorRepository.getInstance('jobright-legacy')
    expect(persisted).toMatchObject({
      connectorVersion: '0.4.1',
      auth: [
        {
          id: 'jobright',
          mode: 'username_password',
          secretKey: 'connector_jobright_credentials_jobright_legacy',
        },
      ],
    })
    expect(JSON.stringify(persisted)).not.toContain('legacy-jobright-session')
    expect(JSON.stringify(persisted)).not.toContain('browser_session')

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
    const profileRepository = createSqliteProfileRepository(database, secretCodec)

    await profileRepository.upsertSecret({
      key: 'connector_jobright_credentials_jobright_default',
      kind: 'password',
      label: 'Jobright username and password',
      value: secretValue,
    })
    await connectorRepository.upsertInstance({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.1',
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

  it('runs Jobright API-only discovery and detail through the local client with fake responses', async () => {
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
    const officialApplyUrl = 'https://careers.example.com/jobs/software-engineering-intern'
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
            jobNum: 2,
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
            ],
          },
        }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }

      if (url.includes('/swan/share/job/job-resolved-1')) {
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

      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch
    const { createJobrightConnector } = await import('@sparxie/valedictorian-connectors-jobright')
    const { createStaticConnectorRegistry } = await import('../modules/connectors/connector.registry')
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
      workspaceId: 'workspace-jobright-api',
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
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
      connectorVersion: '0.4.1',
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
        discoveryCount: 2,
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

    expect(run).toMatchObject({
      connectorInstanceId: 'jobright-api',
      status: 'completed',
      observationCount: 2,
      stats: {
        attempted: 2,
        discovered: 2,
        observations: 2,
        resolved: 1,
      },
    })
    expect(runs.total).toBe(1)
    expect(runs.items).toHaveLength(1)
    expect(runs.items[0]).toMatchObject({
      status: 'completed',
      observationCount: 2,
      stats: {
        attempted: 2,
        discovered: 2,
        observations: 2,
        resolved: 1,
      },
    })
    expect(observations.total).toBe(2)
    expect(observations.items).toHaveLength(2)
    expect(checkpoints.items).toHaveLength(1)
    expect(checkpoints.items[0]).toMatchObject({
      checkpoint: {
        attempted: 2,
        discovered: 2,
        resolved: 1,
      },
    })

    const resolvedObservation = observations.items.find((item) =>
      item.companyName === 'Example Robotics'
      && item.roleTitle === 'Software Engineering Intern',
    )
    const unresolvedObservation = observations.items.find((item) =>
      item.companyName === 'Intermediary Co'
      && item.roleTitle === 'Platform Intern',
    )
    expect(resolvedObservation).toMatchObject({
      links: {
        official: officialApplyUrl,
      },
      resolution: {
        status: 'resolved',
      },
    })
    expect(unresolvedObservation).toMatchObject({
      links: {
        official: null,
      },
      resolution: {
        status: 'unresolved',
        reason: 'jobright_application_url_missing',
      },
    })

    expect(findings.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: 'Example Robotics',
        roleTitle: 'Software Engineering Intern',
        officialUrl: officialApplyUrl,
      }),
    ]))
    expect(findings.items.filter((finding) => finding.officialUrl === officialApplyUrl)).toHaveLength(1)
    expect(findings.items.every((finding) =>
      finding.officialUrl === null || !finding.officialUrl.includes('jobright.ai'),
    )).toBe(true)

    const fetchUrls = fetchImpl.mock.calls.map((call) => {
      const input = call[0]
      return typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    })
    expect(fetchUrls).toHaveLength(5)
    expect(fetchUrls.filter((url) => url.includes('/swan/auth/login/pwd'))).toHaveLength(1)
    expect(fetchUrls.filter((url) => url.includes('/swan/auth/newinfo'))).toHaveLength(1)
    expect(fetchUrls.filter((url) => url.includes('/swan/recommend/visitor-list/jobs'))).toHaveLength(1)
    expect(fetchUrls.filter((url) => url.includes('/swan/share/job/job-resolved-1'))).toHaveLength(1)
    expect(fetchUrls.filter((url) => url.includes('/swan/share/job/job-intermediary-only'))).toHaveLength(1)

    const serialized = JSON.stringify({ run, runs, observations, checkpoints, findings })
    expect(serialized).toContain(officialApplyUrl)
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
          code: 'jobright_auth_failed',
          label: 'Jobright auth failed',
          message: 'Jobright authentication failed. Validate credentials and retry this run.',
          severity: 'blocked',
        },
      ],
      retryHints: {
        authRequired: 0,
        captcha: 0,
        parserChanged: 0,
        rateLimited: 0,
        recommended: false,
        retryableFailures: 0,
        source: 'jobright',
      },
    })
    expect(authFailed.runs.items).toHaveLength(1)
    expect(authFailed.runs.items[0]).toMatchObject({
      warnings: authFailed.run.warnings,
      retryHints: authFailed.run.retryHints,
    })
    expect(authFailed.status).toMatchObject({
      status: 'blocked',
      warnings: authFailed.run.warnings,
    })
    expect(authFailed.fetchUrls).toHaveLength(1)

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
      retryHints: {
        authRequired: 0,
        captcha: 0,
        parserChanged: 0,
        rateLimited: 0,
        recommended: false,
        retryableFailures: 0,
        source: 'jobright',
      },
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
      retryHints: {
        actions: ['update_jobright_parser'],
        authRequired: 0,
        captcha: 0,
        parserChanged: 1,
        rateLimited: 0,
        recommended: true,
        retryableFailures: 0,
        source: 'jobright',
      },
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
      retryHints: {
        actions: ['review_jobright_results'],
        authRequired: 0,
        captcha: 0,
        parserChanged: 0,
        rateLimited: 0,
        recommended: true,
        retryableFailures: 0,
        source: 'jobright',
      },
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
      for (const sensitiveValue of fixture.sensitiveValues) {
        expect(fixture.serialized).not.toContain(sensitiveValue)
      }
    }
  })

  it('creates and updates connector instances through the local client', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
    })

    const created = await client.connectors.create({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      auth: [
        {
          id: 'fixture-session',
          label: 'Fixture session',
          mode: 'browser_session',
          sessionKey: 'fixture-session-123',
        },
      ],
      config: {
        publicFeedUrl: 'https://fixture.example/feed.json',
      },
      filters: {
        roleKeywords: ['intern'],
      },
    })
    const updated = await client.connectors.update({
      connectorInstanceId: 'connector-instance-fixture',
      displayName: 'Fixture Internships',
      enabled: false,
      filters: {
        roleKeywords: ['new grad'],
      },
    })
    const instances = await client.connectors.list()

    expect(created).toMatchObject({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      auth: [{ configured: true, id: 'fixture-session', mode: 'browser_session' }],
      config: {
        publicFeedUrl: 'https://fixture.example/feed.json',
      },
      filters: {
        roleKeywords: ['intern'],
      },
    })
    expect(updated).toMatchObject({
      id: 'connector-instance-fixture',
      displayName: 'Fixture Internships',
      enabled: false,
      config: {
        publicFeedUrl: 'https://fixture.example/feed.json',
      },
      filters: {
        roleKeywords: ['new grad'],
      },
    })
    expect(instances.items).toMatchObject([
      {
        id: 'connector-instance-fixture',
        displayName: 'Fixture Internships',
        enabled: false,
      },
    ])
  })

  it('executes registered connector runs through the local client', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-fixture',
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const run = await client.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual',
    })
    const observations = await client.connectors.observations.list({
      connectorInstanceId: 'connector-instance-fixture',
      connectorRunId: run.id,
    })
    const findings = await client.sourcing.findings.list({
      source: 'fixture.jobs',
    })
    const checkpoints = await client.connectors.checkpoints.list({
      connectorInstanceId: 'connector-instance-fixture',
      filterSignature: 'filters:{}',
    })

    expect(run).toMatchObject({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      observationCount: 1,
      stats: {
        observations: 1,
        projected: 1,
      },
      status: 'completed',
    })
    expect(observations).toMatchObject({
      items: [
        {
          companyName: 'Example Robotics',
          roleTitle: 'Software Engineering Intern',
          sourcingFindingId: expect.any(String),
        },
      ],
      total: 1,
    })
    expect(findings).toMatchObject({
      items: [
        {
          companyName: 'Example Robotics',
          officialUrl: 'https://jobs.example.com/apply/software-engineering-intern',
          roleTitle: 'Software Engineering Intern',
          sourceName: 'fixture.jobs',
        },
      ],
      total: 1,
    })
    expect(checkpoints.items).toMatchObject([
      {
        checkpoint: {
          cursor: 'fixture:2026-07-08T18:00:00.000Z',
        },
        coverage: {
          end: '2026-07-08T18:00:00.000Z',
          start: '2026-07-08T17:00:00.000Z',
        },
      },
    ])
    sqlite.close()
  })

  it('persists one running row before refresh settles and completes that same run', async () => {
    const sqlitePath = createTempSqlitePath()
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
              waitForRefresh: refreshGate,
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-fixture',
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const pendingRun = client.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual',
    })
    let runningRunId: string | undefined

    await vi.waitFor(async () => {
      const runs = await client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      })

      expect(runs).toMatchObject({
        items: [
          {
            completedAt: null,
            status: 'running',
          },
        ],
        total: 1,
      })
      runningRunId = runs.items[0]?.id
    })

    releaseRefresh?.()
    const completedRun = await pendingRun
    const persistedRuns = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })

    expect(completedRun).toMatchObject({
      id: runningRunId,
      status: 'completed',
    })
    expect(persistedRuns).toMatchObject({
      items: [
        {
          id: runningRunId,
          status: 'completed',
        },
      ],
      total: 1,
    })
    sqlite.close()
  })

  it('recovers an interrupted running row as an explicit cancelled result on reopen', async () => {
    const sqlitePath = createTempSqlitePath()
    const sqlite = createFileDatabase(sqlitePath)
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    const requestedRun = await connectorRepository.recordRunRequest({
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual',
      startedAt: '2026-07-08T18:00:00.000Z',
    })
    await connectorRepository.markRunRunning({
      connectorRunId: requestedRun.id,
      startedAt: '2026-07-08T18:00:00.000Z',
    })
    await connectorRepository.recordRefreshResult({
      connectorRunId: requestedRun.id,
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-08T18:00:00.000Z',
      completedAt: '2026-07-08T18:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      checkpointPersistence: 'deferred',
      result: {
        coverage: {
          start: '2026-07-08T17:00:00.000Z',
          end: '2026-07-08T18:00:00.000Z',
        },
        nextCheckpoint: {
          checkpoint: { cursor: 'not-yet-committed' },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        stats: { observations: 0 },
        warnings: [{
          code: 'source.rate_limited',
          message: 'Sensitive raw rate-limit details.',
        }],
        status: 'partial_success',
      },
    })
    sqlite.close()

    const reopenedClient = createRuntimeLocalValedictorianClient({
      now: () => new Date('2026-07-08T19:00:00.000Z'),
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-fixture',
    })

    await expect(reopenedClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })).resolves.toMatchObject({
      items: [
        {
          completedAt: '2026-07-08T19:00:00.000Z',
          id: requestedRun.id,
          retryHints: {
            reason: 'connector_run_interrupted',
          },
          status: 'cancelled',
          warningCount: 2,
          warnings: [
            {
              code: 'source.rate_limited',
              label: 'Rate limited',
            },
            {
              code: 'connector.interrupted',
              label: 'Run interrupted',
            },
          ],
        },
      ],
      total: 1,
    })
  })

  it('rejects unsupported connector run triggers instead of queueing them', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get() {
          return null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'manual',
      }),
    ).rejects.toThrow('Unsupported connector id: fixture.jobs')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 0,
    })
    sqlite.close()
  })

  it('rejects dry-run connector triggers before executing registered connectors', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        dryRun: true,
        mode: 'manual',
      }),
    ).rejects.toThrow('dryRun connector triggers are not supported')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 0,
    })
    sqlite.close()
  })

  it('requires explicit coverage for manual connector execution', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        mode: 'manual',
      }),
    ).rejects.toThrow('coverageStartedAt and coverageEndedAt are required for manual connector runs')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 0,
    })
    sqlite.close()
  })

  it('rejects per-run filter overrides before executing registered connectors', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        filters: { roleKeywords: ['intern'] },
        mode: 'manual',
      }),
    ).rejects.toThrow('Per-run connector filter overrides are not supported')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 0,
    })
    sqlite.close()
  })

  it('records failed runs when registered connectors throw', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
              throwOnRefresh: true,
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'manual',
      }),
    ).rejects.toThrow('Fixture connector refresh failed')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          retryHints: {
            reason: 'connector_execution_failed',
          },
          stats: {
            failures: 1,
            running: false,
          },
          status: 'failed',
        },
      ],
      total: 1,
    })
    sqlite.close()
  })

  it('marks connector runs failed when observation projection fails', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              companyName: '',
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    await connectorRepository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        coverage: {
          start: '2026-07-08T15:00:00.000Z',
          end: '2026-07-08T16:00:00.000Z',
        },
        nextCheckpoint: {
          checkpoint: {
            cursor: 'previous-successful-cursor',
          },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        stats: {
          observations: 0,
        },
        warnings: [],
      },
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'manual',
      }),
    ).rejects.toThrow('companyName is required')
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })

    expect(runs.total).toBe(2)
    expect(runs.items[0]).toMatchObject({
      retryHints: {
        reason: 'projection_failed',
      },
      status: 'failed',
    })
    await expect(
      client.connectors.checkpoints.list({
        connectorInstanceId: 'connector-instance-fixture',
        filterSignature: 'filters:{}',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          checkpoint: {
            cursor: 'previous-successful-cursor',
          },
          coverage: {
            end: '2026-07-08T16:00:00.000Z',
            start: '2026-07-08T15:00:00.000Z',
          },
        },
      ],
    })
    sqlite.close()
  })

  it('keeps catch-up checkpoints unchanged until every observation projects', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              additionalCompanyNames: [''],
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    await connectorRepository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'catch_up',
      startedAt: '2026-07-08T16:00:00.000Z',
      completedAt: '2026-07-08T16:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        coverage: {
          start: '2026-07-08T15:00:00.000Z',
          end: '2026-07-08T16:00:00.000Z',
        },
        nextCheckpoint: {
          checkpoint: {
            cursor: 'previous-successful-cursor',
          },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        stats: {
          observations: 0,
        },
        warnings: [],
      },
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'catch_up',
      }),
    ).rejects.toThrow('companyName is required')
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })
    const observations = await client.connectors.observations.list({
      connectorInstanceId: 'connector-instance-fixture',
      limit: 10,
    })

    expect(runs.total).toBe(2)
    expect(runs.items[0]).toMatchObject({
      coverage: {
        end: '2026-07-08T18:00:00.000Z',
        start: '2026-07-08T15:30:00.000Z',
      },
      mode: 'catch_up',
      observationCount: 2,
      retryHints: {
        reason: 'projection_failed',
      },
      status: 'failed',
    })
    expect(observations.total).toBe(2)
    await expect(
      client.connectors.checkpoints.list({
        connectorInstanceId: 'connector-instance-fixture',
        filterSignature: 'filters:{}',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          checkpoint: {
            cursor: 'previous-successful-cursor',
          },
          coverage: {
            end: '2026-07-08T16:00:00.000Z',
            start: '2026-07-08T15:00:00.000Z',
          },
        },
      ],
    })
    sqlite.close()
  })

  it('runs one startup catch-up pass for enabled registered connector instances', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-09T15:30:00.000Z',
            })
            : null
        },
      },
      now: () => new Date('2026-07-09T16:00:00.000Z'),
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-enabled',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Enabled Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    await connectorRepository.upsertInstance({
      id: 'connector-instance-disabled',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Disabled Fixture Jobs',
      enabled: false,
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    await connectorRepository.upsertInstance({
      id: 'connector-instance-unsupported',
      connectorId: 'fixture.unsupported',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Unsupported Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const result = await client.connectors.runs.startupCatchUp()
    const enabledRuns = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-enabled',
    })
    const disabledRuns = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-disabled',
    })

    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]).toMatchObject({
      connectorInstanceId: 'connector-instance-enabled',
      coverage: {
        end: '2026-07-09T16:00:00.000Z',
        start: '2026-07-01T15:00:00.000Z',
      },
      mode: 'catch_up',
      status: 'completed',
    })
    expect(result.skipped).toEqual([
      {
        connectorInstanceId: 'connector-instance-disabled',
        reason: 'disabled',
      },
      {
        connectorInstanceId: 'connector-instance-unsupported',
        reason: 'unsupported_connector',
      },
    ])
    expect(enabledRuns.total).toBe(1)
    expect(disabledRuns.total).toBe(0)
    sqlite.close()
  })

  it('does not duplicate startup catch-up work when the startup hook is invoked twice', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-09T15:30:00.000Z',
            })
            : null
        },
      },
      now: () => new Date('2026-07-09T16:00:00.000Z'),
      seedDataMode: 'none',
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const first = await client.connectors.runs.startupCatchUp()
    const second = await client.connectors.runs.startupCatchUp()
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })

    expect(first.runs).toHaveLength(1)
    expect(second).toEqual(first)
    expect(runs.total).toBe(1)
    sqlite.close()
  })
})

function fixtureConnector({
  additionalCompanyNames = [],
  companyName = 'Example Robotics',
  observedAt,
  throwOnRefresh = false,
  waitForRefresh,
}: {
  additionalCompanyNames?: string[]
  companyName?: string
  observedAt: string
  throwOnRefresh?: boolean
  waitForRefresh?: Promise<void>
}): AppJobConnector {
  return {
    definition: {
      id: 'fixture.jobs',
      version: '0.0.0-fixture',
    },
    async refresh(input) {
      await waitForRefresh

      if (throwOnRefresh) {
        throw new Error('Fixture connector refresh failed')
      }
      const observations = [companyName, ...additionalCompanyNames].map((observationCompanyName, index) => {
        const slug = index === 0
          ? 'software-engineering-intern'
          : `software-engineering-intern-${index + 1}`

        return {
          connectorId: 'fixture.jobs',
          connectorVersion: '0.0.0-fixture',
          sourceRecordKey: `fixture.jobs:${slug}`,
          observedAt,
          companyName: observationCompanyName,
          roleTitle: 'Software Engineering Intern',
          locationRaw: 'Remote',
          descriptionText: 'Build fixture robots and connector proofs.',
          pay: null,
          links: {
            source: `https://example.test/jobs/${slug}`,
            intermediary: null,
            official: `https://jobs.example.com/apply/${slug}`,
          },
          resolution: {
            status: 'resolved',
            method: 'fixture',
            reason: null,
          },
          dedupeKeys: [`official:https://jobs.example.com/apply/${slug}`],
          sourceMetadata: {
            fixture: true,
          },
          evidence: [
            {
              type: 'fixture',
              capturedAt: observedAt,
              sourceUrl: `https://example.test/jobs/${slug}`,
            },
          ],
        }
      })

      return {
        coverage: input.coverage,
        nextCheckpoint: {
          checkpoint: {
            cursor: `fixture:${observedAt}`,
          },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations,
        stats: {
          observations: observations.length,
        },
        warnings: [],
      }
    },
  }
}
