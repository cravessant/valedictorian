import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { sources, workflowRuns, workflowRunSteps } from '../../db/schema'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../../db/pglite'
import { createPgliteWorkflowRunRepository } from './workflow-run.repository'

async function openMigratedWorkflowRunDb(dataDir?: string) {
  const client = await createPgliteClient(dataDir ? { dataDir } : {})
  const database = await migratePgliteDatabase(client)
  return {
    client,
    database,
    repository: createPgliteWorkflowRunRepository(database),
  }
}

async function closeClient(client: PgliteClient) {
  await client.close()
}

async function seedLinkedInSource(database: PgliteDatabase) {
  const now = '2026-06-04T16:00:00.000Z'
  await database.insert(sources).values({
    id: 'source-linkedin',
    name: 'LinkedIn',
    accountHint: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

describe('PGlite workflow run repository', () => {
  it('starts, steps, completes, and lists sourcing workflow runs', async () => {
    const { client, database, repository } = await openMigratedWorkflowRunDb()
    try {
      await seedLinkedInSource(database)

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

      await expect(repository.listRuns({ source: 'linkedin' })).resolves.toMatchObject({
        total: 1,
        items: [{ id: run.id, sourceName: 'LinkedIn' }],
      })
    } finally {
      await closeClient(client)
    }
  })

  it('returns get-through list behavior with exact step sequence and source linkage', async () => {
    const { client, database, repository } = await openMigratedWorkflowRunDb()
    try {
      await seedLinkedInSource(database)

      const run = await repository.startRun({
        runType: 'sourcing',
        actorType: 'agent',
        actorName: 'codex',
        sourceId: 'source-linkedin',
        input: { query: 'backend' },
        summary: 'Started.',
        metadata: { wave: 1 },
      })

      expect(run.sourceId).toBe('source-linkedin')
      expect(run.sourceName).toBe('LinkedIn')
      expect(run.steps).toEqual([
        expect.objectContaining({
          sequence: 1,
          type: 'run_started',
          actor: 'agent:codex',
          payloadJson: expect.stringContaining('"runType":"sourcing"'),
        }),
      ])
      expect(JSON.parse(run.inputJson)).toEqual({ query: 'backend' })
      expect(JSON.parse(run.metadataJson)).toEqual({ wave: 1 })

      const mid = await repository.createRunStep({
        workflowRunId: run.id,
        type: 'page_scanned',
        message: 'Scanned page 1.',
        payload: { page: 1 },
      })
      expect(mid).toMatchObject({
        workflowRunId: run.id,
        sequence: 2,
        type: 'page_scanned',
        payloadJson: '{"page":1}',
        actor: 'agent',
      })

      const completed = await repository.completeRun({
        workflowRunId: run.id,
        status: 'completed',
        outcome: 'partial_coverage',
        summary: 'Done.',
      })

      expect(completed.steps.map((step) => ({ sequence: step.sequence, type: step.type }))).toEqual([
        { sequence: 1, type: 'run_started' },
        { sequence: 2, type: 'page_scanned' },
        { sequence: 3, type: 'run_completed' },
      ])

      const listed = await repository.listRuns({
        runType: 'sourcing',
        status: 'completed',
        sourceId: 'source-linkedin',
      })
      expect(listed).toMatchObject({
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
        items: [
          {
            id: run.id,
            sourceId: 'source-linkedin',
            sourceName: 'LinkedIn',
            status: 'completed',
            outcome: 'partial_coverage',
            steps: [
              { sequence: 1, type: 'run_started' },
              { sequence: 2, type: 'page_scanned' },
              { sequence: 3, type: 'run_completed' },
            ],
          },
        ],
      })
    } finally {
      await closeClient(client)
    }
  })

  it('rolls back all startRun writes when a later insert fails', async () => {
    const { client, database, repository } = await openMigratedWorkflowRunDb()
    try {
      await client.exec(`
        create or replace function fail_workflow_run_step_insert() returns trigger as $$
        begin
          raise exception 'workflow run step insert failed';
        end;
        $$ language plpgsql;

        create trigger fail_workflow_run_steps_insert
        before insert on workflow_run_steps
        for each row execute function fail_workflow_run_step_insert();
      `)

      let thrown: unknown
      try {
        await repository.startRun({
          runType: 'sourcing',
          actorType: 'agent',
          actorName: 'codex',
          sourceName: 'Handshake',
          summary: 'Should roll back.',
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect(String(thrown)).toMatch(/Failed query: insert into "workflow_run_steps"/)
      expect(
        thrown instanceof Error && 'cause' in thrown
          ? String((thrown as Error & { cause?: unknown }).cause)
          : '',
      ).toMatch(/workflow run step insert failed/)

      expect(await database.select().from(sources)).toHaveLength(0)
      expect(await database.select().from(workflowRuns)).toHaveLength(0)
      expect(await database.select().from(workflowRunSteps)).toHaveLength(0)
    } finally {
      await closeClient(client)
    }
  })

  it('rolls back completeRun update and terminal step when the step insert fails', async () => {
    const { client, database, repository } = await openMigratedWorkflowRunDb()
    try {
      await seedLinkedInSource(database)
      const run = await repository.startRun({
        runType: 'sourcing',
        actorType: 'agent',
        actorName: 'codex',
        sourceId: 'source-linkedin',
        summary: 'Started.',
      })

      await client.exec(`
        create or replace function fail_workflow_run_step_insert() returns trigger as $$
        begin
          raise exception 'workflow run step insert failed';
        end;
        $$ language plpgsql;

        create trigger fail_workflow_run_steps_insert
        before insert on workflow_run_steps
        for each row execute function fail_workflow_run_step_insert();
      `)

      await expect(
        repository.completeRun({
          workflowRunId: run.id,
          status: 'completed',
          outcome: 'full_coverage',
          summary: 'Should roll back.',
        }),
      ).rejects.toThrow(/Failed query: insert into "workflow_run_steps"/)

      const [persisted] = await database
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, run.id))
      expect(persisted).toMatchObject({
        status: 'in_progress',
        outcome: null,
        completedAt: null,
        summary: 'Started.',
      })
      expect(await database.select().from(workflowRunSteps)).toHaveLength(1)
    } finally {
      await closeClient(client)
    }
  })

  it('creates one source and two runs for concurrent starts with the same new sourceName', async () => {
    const { client, database, repository } = await openMigratedWorkflowRunDb()
    try {
      const [first, second] = await Promise.all([
        repository.startRun({
          runType: 'sourcing',
          actorType: 'agent',
          actorName: 'codex',
          sourceName: 'Wellfound',
          summary: 'Concurrent start A.',
        }),
        repository.startRun({
          runType: 'sourcing',
          actorType: 'agent',
          actorName: 'codex',
          sourceName: 'Wellfound',
          summary: 'Concurrent start B.',
        }),
      ])

      expect(first.sourceId).toBeTruthy()
      expect(second.sourceId).toBe(first.sourceId)
      expect(first.sourceName).toBe('Wellfound')
      expect(second.sourceName).toBe('Wellfound')
      expect(first.id).not.toBe(second.id)

      const persistedSources = await database.select().from(sources)
      expect(persistedSources).toHaveLength(1)
      expect(persistedSources[0]).toMatchObject({
        id: first.sourceId,
        name: 'Wellfound',
      })

      const persistedRuns = await database.select().from(workflowRuns)
      expect(persistedRuns).toHaveLength(2)
      expect(new Set(persistedRuns.map((row) => row.sourceId))).toEqual(new Set([first.sourceId]))
      expect(await database.select().from(workflowRunSteps)).toHaveLength(2)
    } finally {
      await closeClient(client)
    }
  })

  it('persists runs across on-disk close and reopen', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-run-pglite-'))
    try {
      let runId = ''
      const first = await openMigratedWorkflowRunDb(dataDir)
      try {
        await seedLinkedInSource(first.database)
        const run = await first.repository.startRun({
          runType: 'sourcing',
          actorType: 'agent',
          actorName: 'codex',
          sourceId: 'source-linkedin',
          summary: 'Persisted start.',
        })
        runId = run.id
        await first.repository.completeRun({
          workflowRunId: run.id,
          status: 'completed',
          outcome: 'full_coverage',
          summary: 'Persisted complete.',
        })
      } finally {
        await closeClient(first.client)
      }

      const second = await openMigratedWorkflowRunDb(dataDir)
      try {
        await expect(second.repository.listRuns({ sourceId: 'source-linkedin' })).resolves.toMatchObject({
          total: 1,
          items: [
            {
              id: runId,
              sourceName: 'LinkedIn',
              status: 'completed',
              outcome: 'full_coverage',
              steps: [
                { sequence: 1, type: 'run_started' },
                { sequence: 2, type: 'run_completed' },
              ],
            },
          ],
        })
      } finally {
        await closeClient(second.client)
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('preserves missing run and source error contracts', async () => {
    const { client, repository } = await openMigratedWorkflowRunDb()
    try {
      await expect(
        repository.startRun({
          runType: 'sourcing',
          actorType: 'agent',
          actorName: 'codex',
          sourceId: 'source-missing',
        }),
      ).rejects.toThrow('Source not found: source-missing')

      await expect(
        repository.createRunStep({
          workflowRunId: 'run-missing',
          type: 'note',
          message: 'missing',
        }),
      ).rejects.toThrow('Workflow run not found: run-missing')

      await expect(
        repository.completeRun({
          workflowRunId: 'run-missing',
          status: 'completed',
        }),
      ).rejects.toThrow('Workflow run not found: run-missing')
    } finally {
      await closeClient(client)
    }
  })
})
