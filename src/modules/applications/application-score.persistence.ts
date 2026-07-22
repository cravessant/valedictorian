import { applicationScores } from '../application/application.schema'
import type { PgliteRepositoryDatabase } from '../../db/pglite'

export interface PersistApplicationScoreInput {
  id: string
  applicationId: string
  score: number
  band: string
  roleRelevance: number
  careerSignal: number
  cityWorkMode: number
  compensationLogistics: number
  penaltiesJson: string
  rationale: string
  rubricVersion: string
  createdAt: string
}

/** Application-owned write port for immutable score observations. */
export async function persistApplicationScore(
  database: PgliteRepositoryDatabase,
  input: PersistApplicationScoreInput,
) {
  await database.transaction(async (transaction) => {
    await transaction.insert(applicationScores).values(input)
  })
}
