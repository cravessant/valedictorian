import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { opportunities, sources, workflowRuns } from '../../db/schema'
import { createPgliteTestDatabase } from '../../test/pglite-test-owner'
import {
  CANONICAL_PROJECTION_TEST_NOW as NOW,
  seedPassedCanonicalCandidate,
} from './canonical-candidate.projection.pglite-test-helpers'
import { createCanonicalCandidateProjectionService } from './canonical-candidate.projection'

describe('canonical candidate projection schema failures', () => {
  it('rolls back the complete projection when an injected write failure aborts the transaction', async () => {
    const database = await createPgliteTestDatabase()
    const persisted = await seedPassedCanonicalCandidate(database, 'rollback')
    const service = createCanonicalCandidateProjectionService(() => new Date(NOW))
    await database.execute(sql.raw(`
      CREATE FUNCTION reject_canonical_projection() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected canonical projection failure';
      END;
      $$;
    `))
    await database.execute(sql.raw(`
      CREATE TRIGGER reject_canonical_projection_insert
        BEFORE INSERT ON opportunities
        FOR EACH ROW EXECUTE FUNCTION reject_canonical_projection();
    `))

    await expect(database.transaction((transaction) =>
      service.projectPersisted(transaction, persisted.candidateId, persisted.rawRevisionId)))
      .rejects.toThrow('Failed query: insert into "opportunities"')
    await expect(database.select().from(opportunities)).resolves.toEqual([])
    await expect(database.select().from(sources)).resolves.toEqual([])
    await expect(database.select().from(workflowRuns)).resolves.toEqual([])
  })
})
