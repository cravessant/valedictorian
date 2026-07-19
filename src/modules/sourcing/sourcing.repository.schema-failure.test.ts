import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createPgliteTestDatabase } from '../../test/pglite-test-owner'
import { seedSampleApplications } from '../applications/application.fixtures'
import { createPgliteWorkflowRunRepository } from '../workflow-runs/workflow-run.repository'
import { createPgliteSourcingRepository } from './sourcing.repository'

describe('PGlite sourcing repository schema failures', () => {
  it('rolls back create when reclassification fails', async () => {
    const database = await createPgliteTestDatabase()
    const run = await createPgliteWorkflowRunRepository(database).startRun({
      runType: 'sourcing', actorType: 'agent', sourceName: 'Rollback Board',
      summary: 'Rollback proof.',
    })
    await database.execute(sql.raw(`
      CREATE FUNCTION reject_opportunity_update() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'reclassification failed';
      END;
      $$;
    `))
    await database.execute(sql.raw(`
      CREATE TRIGGER fail_opportunity_update
        BEFORE UPDATE ON opportunities
        FOR EACH ROW EXECUTE FUNCTION reject_opportunity_update();
    `))
    const repository = createPgliteSourcingRepository(database)

    await expect(repository.createFinding({
      workflowRunId: run.id, sourceName: 'Rollback Board', companyName: 'Rollback Co',
      roleTitle: 'Backend Intern', roleKind: 'internship', country: 'US',
      workMode: 'remote', officialUrl: 'https://jobs.example.com/rollback/backend',
    })).rejects.toThrow('Failed query: update "opportunities"')
    await expect(repository.listFindings()).resolves.toMatchObject({ total: 0 })
  })

  it('rolls back update patches when reclassification fails', async () => {
    const database = await createPgliteTestDatabase()
    await seedSampleApplications(database)
    const run = await createPgliteWorkflowRunRepository(database).startRun({
      runType: 'sourcing', actorType: 'agent', sourceName: 'Rollback Board',
      summary: 'Update rollback proof.',
    })
    const repository = createPgliteSourcingRepository(database)
    const finding = await repository.createFinding({
      workflowRunId: run.id, sourceName: 'Rollback Board', companyName: 'Versant Media',
      roleTitle: 'Academic Year Internships: Platform Engineering', roleKind: 'internship',
      country: 'US', workMode: 'remote',
      sourceUrl: 'https://linkedin.com/jobs/view/versant-platform',
    })
    await database.execute(sql.raw(`
      CREATE FUNCTION reject_duplicate_reclassification() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.duplicate_notes IS NOT NULL THEN
          RAISE EXCEPTION 'duplicate reclassification failed';
        END IF;
        RETURN NEW;
      END;
      $$;
    `))
    await database.execute(sql.raw(`
      CREATE TRIGGER fail_duplicate_reclassification
        BEFORE UPDATE ON opportunities
        FOR EACH ROW EXECUTE FUNCTION reject_duplicate_reclassification();
    `))

    await expect(repository.updateFinding({
      findingId: finding.id,
      officialUrl: 'https://jobs.example.test/remediated/41581ba03bdcb93e',
    })).rejects.toThrow('Failed query: update "opportunities"')
    await expect(repository.getFinding(finding.id)).resolves.toMatchObject({
      officialUrl: null, mergeStatus: 'new',
    })
  })
})
