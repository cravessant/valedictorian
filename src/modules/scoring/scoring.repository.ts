import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { ScoreInput, ScoreRecord } from 'sparxie'
import { applications } from '../../db/schema'
import { insertApplicationScores, updateApplications } from '../applications/application.cross-writes'
import type { PgliteRepositoryDatabase } from '../../db/pglite'

export type { ScoreInput } from 'sparxie'

export interface ScoringRepository {
  recordScore: (input: ScoreInput) => Promise<ScoreRecord>
}

export function createPgliteScoringRepository(database: PgliteRepositoryDatabase): ScoringRepository {
  return {
    async recordScore(input) {
      const createdAt = new Date().toISOString()
      const id = randomUUID()

      await database.transaction(async (tx) => {
        await insertApplicationScores(tx).values({
          id,
          applicationId: input.applicationId,
          score: input.score,
          band: input.band,
          roleRelevance: input.roleRelevance,
          careerSignal: input.careerSignal,
          cityWorkMode: input.cityWorkMode,
          compensationLogistics: input.compensationLogistics,
          penaltiesJson: JSON.stringify(input.penalties),
          rationale: input.rationale,
          rubricVersion: input.rubricVersion,
          createdAt,
        })

        await updateApplications(tx)
          .set({
            currentPriorityScore: input.score,
            currentPriorityBand: input.band,
            updatedAt: createdAt,
          })
          .where(eq(applications.id, input.applicationId))
      })

      return {
        ...input,
        id,
        createdAt,
      }
    },
  }
}
