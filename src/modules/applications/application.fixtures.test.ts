import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  applicationLinks,
  applicationScores,
  applications,
  opportunities,
  workflowRuns,
  workflowRunSteps,
} from '../../db/schema'
import { createPgliteClient, migratePgliteDatabase } from '../../db/pglite'
import {
  parseReferenceTrackerApplications,
  seedReferenceTrackerApplications,
  seedSampleApplications,
  seedSampleSourcingFindings,
} from './application.fixtures'
import { createPgliteApplicationRepository } from './application.repository'

async function createTestDatabase() {
  const client = await createPgliteClient()
  onTestFinished(() => client.close())
  return migratePgliteDatabase(client)
}

describe('sample applications seed', () => {
  it('creates sample tracker applications with links and scores', async () => {
    const database = await createTestDatabase()

    await seedSampleApplications(database)

    const rows = await database.select().from(applications)
    const links = await database.select().from(applicationLinks)
    const scores = await database.select().from(applicationScores)

    expect(rows).toHaveLength(3)
    expect(links).toHaveLength(3)
    expect(scores).toHaveLength(3)
    expect(rows.map((row) => row.status)).toEqual(
      expect.arrayContaining(['needs_user_info', 'queued', 'not_fit']),
    )
    expect(
      await database.select().from(applicationScores).where(eq(applicationScores.score, 8)).limit(1).then(([row]) => row),
    ).toBeDefined()
  })

  it('creates sample sourcing runs and findings for the Sourcing UI', async () => {
    const database = await createTestDatabase()

    await seedSampleApplications(database)
    await seedSampleSourcingFindings(database)

    expect(await database.select().from(workflowRuns).where(eq(workflowRuns.runType, 'sourcing'))).toHaveLength(1)
    expect(
      await database
        .select()
        .from(workflowRunSteps)
        .where(eq(workflowRunSteps.workflowRunId, 'workflow-run-sourcing-sample-linkedin'))
        ,
    ).toHaveLength(3)
    expect(await database.select().from(opportunities)).toMatchObject([
      {
        companyName: 'Delta Labs',
        mergeStatus: 'new',
        priorityScore: 7,
      },
      {
        companyName: 'Northstar Robotics',
        mergeStatus: 'below_cutoff',
        priorityScore: 4,
      },
      {
        companyName: 'Summit Cloud',
        mergeStatus: 'blocked',
      },
    ])
  })

  it('creates an Astranis application attempt with a failed verification receipt', async () => {
    const database = await createTestDatabase()

    await seedSampleApplications(database)

    const runId = 'workflow-run-application-attempt-astranis-verification'
    const run = await database.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1).then(([row]) => row)
    const steps = (await database
      .select()
      .from(workflowRunSteps)
      .where(eq(workflowRunSteps.workflowRunId, runId)))
      .sort((left, right) => left.sequence - right.sequence)
    const receiptStep = steps.find((step) => step.type === 'verification_receipt')

    expect(run).toMatchObject({
      id: runId,
      runType: 'application_attempt',
      status: 'completed',
      actorType: 'agent',
      actorName: 'codex',
      subjectApplicationId: 'application-astranis-backend',
      outcome: 'needs_user_info',
    })
    expect(steps.map((step) => step.type)).toEqual([
      'attempt_started',
      'resume_uploaded',
      'verification_receipt',
      'attempt_completed',
    ])
    expect(receiptStep).toMatchObject({
      message: 'Final review failed because Fall availability answers are still missing.',
    })
    expect(JSON.parse(receiptStep?.payloadJson ?? '{}')).toEqual({
      version: 1,
      scope: 'final_review',
      status: 'failed',
      verified: ['resume_attachment', 'contact_info', 'education', 'work_authorization'],
      unresolved: [
        'Fall 2026 exact start date',
        'Fall 2026 exact end date',
        'Astranis onsite 5 days/week availability',
      ],
      evidence:
        'Application was reviewed up to the submit boundary; availability answers were still missing.',
    })
  })

  it('keeps sample application and receipt attempt seeding idempotent', async () => {
    const database = await createTestDatabase()

    await seedSampleApplications(database)
    await seedSampleApplications(database)

    const runId = 'workflow-run-application-attempt-astranis-verification'

    expect(await database.select().from(applications)).toHaveLength(3)
    expect(await database.select().from(applicationLinks)).toHaveLength(3)
    expect(await database.select().from(applicationScores)).toHaveLength(3)
    expect(await database.select().from(workflowRuns).where(eq(workflowRuns.id, runId))).toHaveLength(1)
    expect(
      await database
        .select()
        .from(workflowRunSteps)
        .where(eq(workflowRunSteps.workflowRunId, runId))
        ,
    ).toHaveLength(4)
  })

  it('parses reference tracker markdown rows into seedable applications', async () => {
    const trackerMarkdown = `
| 2026-06-04 | Astranis Space Technologies | Software Engineer- Backend Intern (Fall 2026) | San Francisco, CA / Onsite | Fall 2026 internship | [official](https://jobs.example.test/remediated/f60a3102c158cd7c?gh_src=602966e76us) | N |  | needs_user_info | Source: LinkedIn. Priority score: high/8. Tailored resume uploaded. |
| 2026-04-22 | Vantage | Software Engineering Intern (Summer 2026) | New York, NY | Intern (Summer 2026) | [link](https://jobs.example.test/remediated/909841a95a81579b) | Y | 2026-04-22 | submitted | Ashby confirmation shows success. |
| YYYY-MM-DD | CompanyName | Role Title | City, ST | Intern (Summer 2026) / New Grad / FT | [link](URL) | N |  | todo | Short note |
`

    expect(parseReferenceTrackerApplications(trackerMarkdown)).toMatchObject([
      {
        companyName: 'Astranis Space Technologies',
        currentPriorityBand: 'high',
        currentPriorityScore: 8,
        hasApplied: false,
        linkLabel: 'official',
        linkUrl: 'https://jobs.example.test/remediated/f60a3102c158cd7c?gh_src=602966e76us',
        locationRaw: 'San Francisco, CA / Onsite',
        roleTitle: 'Software Engineer- Backend Intern (Fall 2026)',
        sourceName: 'LinkedIn',
        status: 'needs_user_info',
        term: 'Fall 2026 internship',
      },
      {
        companyName: 'Vantage',
        hasApplied: true,
        status: 'submitted',
      },
    ])
  })

  it('seeds applications from a reference tracker when it has many rows', async () => {
    const database = await createTestDatabase()
    const rows = Array.from(
      { length: 101 },
      (_, index) =>
        `| 2026-06-04 | Company ${index} | Backend Intern ${index} | Remote | Internship | [source](https://example.com/jobs/${index}) | N |  | queued | Priority score: medium/6. |`,
    ).join('\n')

    await seedReferenceTrackerApplications(database, rows)

    expect(await database.select().from(applications)).toHaveLength(101)
    expect(await database.select().from(applicationLinks)).toHaveLength(101)
    expect(await database.select().from(applicationScores)).toHaveLength(101)
  })

  it('keeps fixture rows visible after an on-disk close and reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'valedictorian-applications-'))

    try {
      const firstClient = await createPgliteClient({ dataDir: directory })
      try {
        const database = await migratePgliteDatabase(firstClient)
        await seedSampleApplications(database)
      } finally {
        await firstClient.close()
      }

      const reopenedClient = await createPgliteClient({ dataDir: directory })
      try {
        const database = await migratePgliteDatabase(reopenedClient)
        const repository = createPgliteApplicationRepository(database)
        await expect(repository.listApplications()).resolves.toMatchObject({ total: 3 })
      } finally {
        await reopenedClient.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
