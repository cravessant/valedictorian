import { describe, expect, it } from 'vitest'
import { sources, workflowRuns, workflowRunSteps } from '../../db/schema'
import {
  type PgliteDatabase,
} from '../../db/pglite'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { createPgliteWorkflowRunRepository } from './workflow-run.repository'

const resettableOwner = useResettablePgliteTestOwner()

async function openMigratedWorkflowRunDb() {
  const { database } = resettableOwner()
  return {
    close: async () => {},
    database,
    repository: createPgliteWorkflowRunRepository(database),
  }
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

describe.sequential('PGlite workflow run repository', () => {
  it('starts, steps, completes, and lists sourcing workflow runs', async () => {
    const { close, database, repository } = await openMigratedWorkflowRunDb()
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
      await close()
    }
  })

  it('returns get-through list behavior with exact step sequence and source linkage', async () => {
    const { close, database, repository } = await openMigratedWorkflowRunDb()
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
      await close()
    }
  })

  it('creates one source and two runs for concurrent starts with the same new sourceName', async () => {
    const { close, database, repository } = await openMigratedWorkflowRunDb()
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
      await close()
    }
  })

  it('preserves deterministic source slug conflicts for distinct names', async () => {
    const { close, database, repository } = await openMigratedWorkflowRunDb()
    try {
      const first = await repository.startRun({
        runType: 'sourcing',
        actorType: 'agent',
        sourceName: 'A-B',
        summary: 'First source name.',
      })

      await expect(repository.startRun({
        runType: 'sourcing',
        actorType: 'agent',
        sourceName: 'A B',
        summary: 'Colliding source name.',
      })).rejects.toThrow('Source ID conflict: source-a-b belongs to A-B, not A B')

      expect(await database.select().from(sources)).toEqual([
        expect.objectContaining({ id: first.sourceId, name: 'A-B' }),
      ])
      expect(await database.select().from(workflowRuns)).toHaveLength(1)
      expect(await database.select().from(workflowRunSteps)).toHaveLength(1)
    } finally {
      await close()
    }
  })

  it('preserves missing run and source error contracts', async () => {
    const { close, repository } = await openMigratedWorkflowRunDb()
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
      await close()
    }
  })
})
