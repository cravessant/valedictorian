import { randomUUID } from 'node:crypto'
import type { ScoreInput, ScoreRecord } from '@sparxie/sdk'
import type { PgliteRepositoryDatabase } from '../../db/pglite'
import { persistApplicationScore } from '../applications/application-score.persistence'

export type { ScoreInput } from '@sparxie/sdk'

export interface ScoringRepository {
  recordScore: (input: ScoreInput) => Promise<ScoreRecord>
}

export function createPgliteScoringRepository(database: PgliteRepositoryDatabase): ScoringRepository {
  return {
    async recordScore(input) {
      const createdAt = new Date().toISOString()
      const id = randomUUID()

      await persistApplicationScore(database, {
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

      return {
        ...input,
        id,
        createdAt,
      }
    },
  }
}
