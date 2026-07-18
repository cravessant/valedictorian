import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applicationScores,
  applications,
  companies,
  sources,
  workflowRuns,
  workflowRunSteps
} from '../db/schema'
import { createDrizzleDatabase, createFileDatabase, migrateDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { completedConnectorRefreshContract } from '../modules/connectors/connector-refresh-result.test-helpers'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'
import { resolveDatabaseFilePath } from '../workspace/workspace.paths'

function createLocalValedictorianClient(options: Parameters<typeof createRuntimeLocalValedictorianClient>[0]) {
  return createRuntimeLocalValedictorianClient({
    seedDataMode: 'sample',
    ...options,
  })
}

function createTempDatabasePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-client-')), 'pglite')
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
    const pgliteDataPath = createTempDatabasePath()
    const client = createRuntimeLocalValedictorianClient({ pgliteDataPath })

    await expect(client.applications.list()).resolves.toMatchObject({
      items: [],
      total: 0,
    })

    const sqlite = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
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
        pgliteDataPath: createTempDatabasePath(),
      }),
    ).toThrow('VALEDICTORIAN_REFERENCE_TRACKER_PATH')
  })

  it('lists seeded applications with query filters and pagination', async () => {
    const client = createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() })

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
    const client = createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() })

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
    const client = createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() })

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
    const pgliteDataPath = createTempDatabasePath()
    const client = createLocalValedictorianClient({ pgliteDataPath })

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

    const sqlite = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
    const database = createDrizzleDatabase(sqlite)

    expect(database.select().from(applicationScores).all()).toHaveLength(4)
    sqlite.close()
  })

  it('persists profile data and returns non-secret agent context', async () => {
    const client = createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() })

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
    const client = createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() })

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
    const client = createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() })
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
    const pgliteDataPath = createTempDatabasePath()
    const sqlite = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
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

    const client = createLocalValedictorianClient({ pgliteDataPath })

    const findings = await client.sourcing.findings.list()

    expect(findings.total).toBe(0)
    expect(findings.items).toEqual([])
  })

  it('does not backfill sample attempts into an existing local database', async () => {
    const pgliteDataPath = createTempDatabasePath()
    const sqlite = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
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

    const client = createLocalValedictorianClient({ pgliteDataPath })

    const attempts = await client.applications.attempts.list({
      applicationId: 'application-astranis-backend',
    })
    const seededSqlite = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
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
    const pgliteDataPath = createTempDatabasePath()
    const client = createRuntimeLocalValedictorianClient({ pgliteDataPath }) as ReturnType<
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
    const sqlite = createFileDatabase(resolveDatabaseFilePath(pgliteDataPath))
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
    await connectorRepository.recordRefreshResult({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-08T17:00:00.000Z',
      completedAt: '2026-07-08T17:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
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
              method: 'api_key',
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
        retryHints: null,
        stats: {
          observations: 0,
        },
        status: 'completed',
        warnings: [
          {
            code: 'auth.expired_session',
            message: 'Expired API key fixture-session-123.',
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
          status: 'caught_up',
          summary: 'Newest jobs, historical backfill, and pending link resolution are caught up.',
        },
      ],
    })
    expect(instances.items).toMatchObject([
      {
        auth: [{ configured: true, id: 'fixture-session', mode: 'api_key' }],
        id: 'connector-instance-fixture',
      },
    ])
    expect(inspected).toMatchObject({
      actionRequired: [],
      auth: [{ configured: true, id: 'fixture-session', mode: 'api_key' }],
      status: 'caught_up',
    })
    expect(runs).toMatchObject({
      items: [
        {
          status: 'completed',
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

})
