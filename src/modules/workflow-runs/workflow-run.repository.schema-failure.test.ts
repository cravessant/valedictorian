import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { sources, workflowRuns, workflowRunSteps } from '@sparxie/valedictorian-local-runtime/testing/db/schema'
import type { PgliteDatabase } from '@sparxie/valedictorian-local-runtime/database'
import { createPgliteTestOwner } from '../../test/pglite-test-owner'
import { createPgliteWorkflowRunRepository } from '@sparxie/valedictorian-local-runtime/testing/modules/workflow-runs/workflow-run.repository'

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

describe('PGlite workflow run repository schema failures', () => {
  it('rolls back all startRun writes when a later insert fails', async () => {
    const { client, database } = await createPgliteTestOwner()
    const repository = createPgliteWorkflowRunRepository(database)
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
  })

  it('rolls back completeRun update and terminal step when the step insert fails', async () => {
    const { client, database } = await createPgliteTestOwner()
    const repository = createPgliteWorkflowRunRepository(database)
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

    await expect(repository.completeRun({
      workflowRunId: run.id,
      status: 'completed',
      outcome: 'full_coverage',
      summary: 'Should roll back.',
    })).rejects.toThrow(/Failed query: insert into "workflow_run_steps"/)

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
  })
})
