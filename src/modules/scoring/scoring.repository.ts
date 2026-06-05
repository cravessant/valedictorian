import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { ScoreInput } from 'job-app-sdk'
import { applicationScores, applications } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'

export type { ScoreInput } from 'job-app-sdk'

export interface ScoringRepository {
  recordScore(input: ScoreInput): Promise<void>
}

export const scoreInputKeys = [
  'applicationId',
  'score',
  'band',
  'roleRelevance',
  'careerSignal',
  'cityWorkMode',
  'compensationLogistics',
  'penalties',
  'rationale',
  'rubricVersion',
]

export function createSqliteScoringRepository(database: DrizzleDatabase): ScoringRepository {
  return {
    async recordScore(input) {
      const createdAt = new Date().toISOString()

      database
        .insert(applicationScores)
        .values({
          id: randomUUID(),
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
        .run()

      database
        .update(applications)
        .set({
          currentPriorityScore: input.score,
          currentPriorityBand: input.band,
          updatedAt: createdAt,
        })
        .where(eq(applications.id, input.applicationId))
        .run()
    },
  }
}
