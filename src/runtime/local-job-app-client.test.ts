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
  workflowRunSteps,
} from '../db/schema'
import { createDrizzleDatabase, createFileDatabase, migrateDatabase } from '../db/sqlite'
import { createLocalJobAppClient } from './local-job-app-client'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'job-app-client-')), 'job-app.sqlite')
}

describe('runtime local job app client', () => {
  const originalReferenceTrackerPath = process.env.JOB_APP_REFERENCE_TRACKER_PATH

  beforeEach(() => {
    process.env.JOB_APP_REFERENCE_TRACKER_PATH = path.join(
      os.tmpdir(),
      'job-app-missing-reference-tracker.md',
    )
  })

  afterEach(() => {
    if (originalReferenceTrackerPath === undefined) {
      delete process.env.JOB_APP_REFERENCE_TRACKER_PATH
    } else {
      process.env.JOB_APP_REFERENCE_TRACKER_PATH = originalReferenceTrackerPath
    }
  })

  it('lists seeded applications with query filters and pagination', async () => {
    const client = createLocalJobAppClient({ sqlitePath: createTempSqlitePath() })

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
    const client = createLocalJobAppClient({ sqlitePath: createTempSqlitePath() })

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
    const client = createLocalJobAppClient({ sqlitePath: createTempSqlitePath() })

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
    const client = createLocalJobAppClient({ sqlitePath })

    await client.scores.record({
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
    const client = createLocalJobAppClient({ sqlitePath: createTempSqlitePath() })

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
    const client = createLocalJobAppClient({ sqlitePath: createTempSqlitePath() })

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
    const client = createLocalJobAppClient({ sqlitePath: createTempSqlitePath() })
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

  it('seeds sourcing findings when an existing local database has applications but no findings', async () => {
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

    const client = createLocalJobAppClient({ sqlitePath })

    const findings = await client.sourcing.findings.list()

    expect(findings.total).toBe(3)
    expect(findings.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          companyName: 'Delta Labs',
          mergeStatus: 'new',
        }),
      ]),
    )
  })

  it('backfills the Astranis verification receipt attempt into an existing local database', async () => {
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

    const client = createLocalJobAppClient({ sqlitePath })

    const attempts = await client.applications.attempts.list({
      applicationId: 'application-astranis-backend',
    })
    const seededSqlite = createFileDatabase(sqlitePath)
    const seededDatabase = createDrizzleDatabase(seededSqlite)

    expect(attempts).toMatchObject({
      total: 1,
      items: [
        {
          outcome: 'needs_user_info',
          steps: [
            { type: 'attempt_started' },
            { type: 'resume_uploaded' },
            { type: 'verification_receipt' },
            { type: 'attempt_completed' },
          ],
        },
      ],
    })
    expect(
      seededDatabase
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, 'workflow-run-application-attempt-astranis-verification'))
        .all(),
    ).toHaveLength(1)
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
    ).toHaveLength(4)
    seededSqlite.close()
  })
})
