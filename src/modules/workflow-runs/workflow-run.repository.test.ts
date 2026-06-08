import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { seedSampleApplications } from '../applications/application.fixtures'
import { createSqliteWorkflowRunRepository } from './workflow-run.repository'

describe('SQLite workflow run repository', () => {
  it('starts, steps, completes, and lists sourcing workflow runs', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    const repository = createSqliteWorkflowRunRepository(database)

    const run = await repository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      actorName: 'codex',
      sourceId: 'source-linkedin',
      coverageStartedAt: '2026-06-06T10:00:00.000Z',
      coverageEndedAt: '2026-06-06T12:00:00.000Z',
      timezone: 'America/Denver',
      input: { query: 'software engineer intern' },
      summary: 'Started LinkedIn sourcing.',
      metadata: { inspectedCount: 0 },
    })

    expect(run).toMatchObject({
      runType: 'sourcing',
      status: 'in_progress',
      sourceId: 'source-linkedin',
      sourceName: 'LinkedIn',
      coverageStartedAt: '2026-06-06T10:00:00.000Z',
      steps: [{ sequence: 1, type: 'run_started' }],
    })

    const step = await repository.createRunStep({
      workflowRunId: run.id,
      type: 'source_frontier_reached',
      message: 'Reached the two-hour frontier.',
      payload: { inspectedCount: 12 },
      actor: 'agent:codex',
    })

    expect(step).toMatchObject({
      sequence: 2,
      type: 'source_frontier_reached',
      payloadJson: '{"inspectedCount":12}',
    })

    const completed = await repository.completeRun({
      workflowRunId: run.id,
      status: 'completed',
      outcome: 'full_coverage',
      summary: 'Completed LinkedIn sourcing.',
      metadata: { inspectedCount: 12 },
    })

    expect(completed).toMatchObject({
      id: run.id,
      status: 'completed',
      outcome: 'full_coverage',
      completedAt: expect.any(String),
      steps: [
        { sequence: 1, type: 'run_started' },
        { sequence: 2, type: 'source_frontier_reached' },
        { sequence: 3, type: 'run_completed' },
      ],
    })

    await repository.completeRun({
      workflowRunId: (
        await repository.startRun({
          runType: 'sourcing',
          actorType: 'agent',
          actorName: 'codex',
          sourceName: 'Jobright',
          summary: 'Started Jobright sourcing.',
        })
      ).id,
      status: 'completed',
      outcome: 'full_coverage',
      summary: 'Completed Jobright sourcing.',
    })

    await expect(
      repository.listRuns({ runType: 'sourcing', sourceId: run.sourceId ?? '' }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ id: run.id, sourceName: 'LinkedIn', status: 'completed' }],
    })
  })
})
